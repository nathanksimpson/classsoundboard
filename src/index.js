/**
 * Class Soundboard — standalone Cloudflare Worker.
 *
 *   /            the soundboard app (static files in /public), team password required
 *   /login       sign-in page
 *   /api/...     shared board + media (see soundboard.js)
 */
import * as Soundboard from './soundboard.js';
import {
    authConfigured,
    checkPassword,
    clearSessionCookie,
    createSessionCookie,
    isSignedIn
} from './auth.js';
import { dbOne, dbRun } from './db.js';

const MAX_BOARD_BODY_BYTES = 1000000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

const SECURITY_HEADERS = {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

function withHeaders(response, extra) {
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        if (!headers.has(k)) headers.set(k, v);
    }
    for (const [k, v] of Object.entries(extra || {})) headers.set(k, v);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(data, status = 200, extra = {}) {
    return withHeaders(new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    }), extra);
}

function redirect(location, extra = {}) {
    return withHeaders(new Response(null, { status: 303, headers: { Location: location } }), extra);
}

async function readJson(request, maxBytes) {
    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > maxBytes) {
        const err = new Error('Payload too large');
        err.status = 413;
        throw err;
    }
    const text = await request.text();
    if (text.length > maxBytes) {
        const err = new Error('Payload too large');
        err.status = 413;
        throw err;
    }
    try {
        return text ? JSON.parse(text) : {};
    } catch (_) {
        return {};
    }
}

function safeReturnPath(value) {
    const v = String(value || '/');
    return v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/login') ? v : '/';
}

// --- login rate limiting (per IP, stored in D1 so it holds across isolates) ---
let loginTableReady = null;
function ensureLoginTable(env) {
    if (!loginTableReady) {
        loginTableReady = dbRun(env, `CREATE TABLE IF NOT EXISTS login_failures (
            ip TEXT PRIMARY KEY, window_start INTEGER NOT NULL, failures INTEGER NOT NULL)`)
            .catch((err) => { loginTableReady = null; throw err; });
    }
    return loginTableReady;
}

async function tooManyFailures(env, ip) {
    await ensureLoginTable(env);
    const row = await dbOne(env, 'SELECT window_start, failures FROM login_failures WHERE ip = ?', ip);
    return !!(row && Date.now() - row.window_start < LOGIN_WINDOW_MS && row.failures >= LOGIN_MAX_FAILURES);
}

async function recordFailure(env, ip) {
    const now = Date.now();
    await dbRun(env, `INSERT INTO login_failures (ip, window_start, failures) VALUES (?, ?, 1)
        ON CONFLICT(ip) DO UPDATE SET
          failures = CASE WHEN ? - window_start > ? THEN 1 ELSE failures + 1 END,
          window_start = CASE WHEN ? - window_start > ? THEN ? ELSE window_start END`,
    ip, now, now, LOGIN_WINDOW_MS, now, LOGIN_WINDOW_MS, now);
}

async function handleLogin(request, env, secure) {
    const ct = (request.headers.get('Content-Type') || '').toLowerCase();
    let password = '';
    let returnTo = '/';
    if (ct.includes('application/json')) {
        const body = await readJson(request, 10000);
        password = body.password;
        returnTo = body.return;
    } else {
        const form = await request.formData();
        password = form.get('password');
        returnTo = form.get('return');
    }
    returnTo = safeReturnPath(returnTo);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (await tooManyFailures(env, ip)) {
        return redirect('/login?error=locked&return=' + encodeURIComponent(returnTo));
    }
    if (!(await checkPassword(env, password))) {
        await recordFailure(env, ip);
        return redirect('/login?error=wrong&return=' + encodeURIComponent(returnTo));
    }
    return redirect(returnTo, { 'Set-Cookie': await createSessionCookie(env, secure) });
}

async function handleApi(request, env, url, path) {
    if (path === '/api/soundboard' && request.method === 'GET') {
        return json(await Soundboard.getBoard(env, url.searchParams.get('since') || ''));
    }
    if (path === '/api/soundboard' && request.method === 'PUT') {
        try {
            const body = await readJson(request, MAX_BOARD_BODY_BYTES);
            return json(await Soundboard.saveBoard(env, body && body.board, 'team', body && body.baseUpdatedAt));
        } catch (err) {
            const status = err && err.status ? err.status : 500;
            if (err && err.body) return json(err.body, status);
            return json({ error: (err && err.message) || 'Could not save the sound board' }, status);
        }
    }
    if (path === '/api/soundboard/media' && request.method === 'PUT') {
        try {
            return json(await Soundboard.putMedia(env, request, 'team'));
        } catch (err) {
            const status = err && err.status ? err.status : 500;
            return json({ error: (err && err.message) || 'Could not upload the file' }, status);
        }
    }
    const mediaMatch = path.match(/^\/api\/soundboard\/media\/([a-f0-9]{64})$/);
    if (mediaMatch && request.method === 'GET') {
        return withHeaders(await Soundboard.getMediaResponse(env, mediaMatch[1]));
    }
    return json({ error: 'Not found' }, 404);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const secure = url.protocol === 'https:';

        if (path === '/healthz') {
            return json({ ok: true, auth: authConfigured(env) });
        }
        if (!authConfigured(env)) {
            return withHeaders(new Response(
                'The soundboard is not set up yet: add the TEAM_PASSWORD and SESSION_SECRET secrets (see README).',
                { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
            ));
        }

        if (path === '/login' || path === '/login.html') {
            if (request.method === 'POST') return handleLogin(request, env, secure);
            if (await isSignedIn(env, request)) return redirect(safeReturnPath(url.searchParams.get('return')));
            return withHeaders(await env.ASSETS.fetch(new Request(new URL('/login', url), request)), { 'Cache-Control': 'no-store' });
        }
        if (path === '/logout') {
            return redirect('/login', { 'Set-Cookie': clearSessionCookie(secure) });
        }

        const signedIn = await isSignedIn(env, request);
        if (path.startsWith('/api/')) {
            if (!signedIn) return json({ error: 'Not signed in' }, 401);
            return handleApi(request, env, url, path);
        }
        if (!signedIn) {
            return redirect('/login?return=' + encodeURIComponent(path + url.search));
        }
        return withHeaders(await env.ASSETS.fetch(request));
    }
};
