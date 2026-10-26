/**
 * Team-password sign-in.
 *
 * Everyone uses one password (the TEAM_PASSWORD secret). Signing in sets a
 * signed cookie that lasts SESSION_DAYS. The signature covers a fingerprint
 * of the password, so changing TEAM_PASSWORD signs every computer out.
 */
export const COOKIE_NAME = 'sb_session';
export const SESSION_DAYS = 180;

const enc = new TextEncoder();

function toHex(buf) {
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
    return toHex(await crypto.subtle.digest('SHA-256', enc.encode(String(text))));
}

async function hmacHex(secret, message) {
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Compare two strings without leaking where they differ. */
async function safeEqual(a, b) {
    const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
    let diff = 0;
    for (let i = 0; i < ha.length; i += 1) {
        diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
    }
    return diff === 0 && String(a).length === String(b).length;
}

export function authConfigured(env) {
    return !!(env.TEAM_PASSWORD && String(env.TEAM_PASSWORD).length >= 4 && env.SESSION_SECRET && String(env.SESSION_SECRET).length >= 16);
}

async function passwordFingerprint(env) {
    return (await sha256Hex('pw:' + env.TEAM_PASSWORD)).slice(0, 16);
}

export async function checkPassword(env, password) {
    if (!authConfigured(env)) return false;
    return safeEqual(String(password || ''), String(env.TEAM_PASSWORD));
}

export async function createSessionCookie(env, secure) {
    const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
    const fp = await passwordFingerprint(env);
    const sig = await hmacHex(env.SESSION_SECRET, expires + '.' + fp);
    return cookieHeader(expires + '.' + sig, SESSION_DAYS * 24 * 60 * 60, secure);
}

export function clearSessionCookie(secure) {
    return cookieHeader('', 0, secure);
}

function cookieHeader(value, maxAgeSec, secure) {
    return [
        COOKIE_NAME + '=' + value,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        secure ? 'Secure' : '',
        'Max-Age=' + maxAgeSec
    ].filter(Boolean).join('; ');
}

function readCookie(request, name) {
    const header = request.headers.get('Cookie') || '';
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
    return '';
}

export async function isSignedIn(env, request) {
    if (!authConfigured(env)) return false;
    const raw = readCookie(request, COOKIE_NAME);
    const m = raw.match(/^(\d{10,16})\.([a-f0-9]{64})$/);
    if (!m) return false;
    if (Number(m[1]) < Date.now()) return false;
    const fp = await passwordFingerprint(env);
    const expected = await hmacHex(env.SESSION_SECRET, m[1] + '.' + fp);
    return safeEqual(m[2], expected);
}
