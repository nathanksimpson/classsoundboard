/**
 * Run: node tests/worker.test.mjs
 * The whole Worker (src/index.js) against a SQLite-backed stand-in for D1:
 * sign-in, rate limiting, page gating, API, and the one-time ClassManager import.
 * Needs Node 22.5+ (built-in node:sqlite); skipped on older Node.
 */
import path from 'path';
import { fileURLToPath } from 'url';

let DatabaseSync;
try {
    ({ DatabaseSync } = await import('node:sqlite'));
} catch (_) {
    console.log('worker.test.mjs: skipped (needs Node 22.5+ for node:sqlite)');
    process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const worker = (await import(path.join(__dirname, '../src/index.js'))).default;

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

function d1(sqlite) {
    const conv = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v);
    const out = (row) => {
        if (!row) return null;
        const o = {};
        for (const [k, v] of Object.entries(row)) o[k] = v instanceof Uint8Array ? Array.from(v) : v;
        return o;
    };
    const stmt = (sql, p = []) => ({
        bind: (...q) => stmt(sql, q),
        first: async () => out(sqlite.prepare(sql).get(...p.map(conv))),
        all: async () => ({ results: sqlite.prepare(sql).all(...p.map(conv)).map(out) }),
        run: async () => {
            if (!p.length && /^\s*CREATE/i.test(sql)) { sqlite.exec(sql); return { meta: { changes: 0 } }; }
            return { meta: { changes: Number(sqlite.prepare(sql).run(...p.map(conv)).changes) } };
        }
    });
    return { prepare: (sql) => stmt(sql) };
}

// ClassManager's database as it is today (one board row, browser-only refs).
const legacy = new DatabaseSync(':memory:');
legacy.exec('CREATE TABLE soundboard_board (id TEXT PRIMARY KEY, board_json TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by_user_id TEXT)');
const legacyBoard = { schemaVersion: 2, name: 'From Blerp', sounds: [{ id: '65bcd687992ce75f00413024', title: 'oops', audioRef: 'blob:audio:65bcd687992ce75f00413024' }] };
legacy.prepare('INSERT INTO soundboard_board VALUES (?, ?, ?, ?)').run('team', JSON.stringify(legacyBoard), '2026-10-23T08:56:53.692Z', 'u');

const assetsSeen = [];
const env = {
    DB: d1(new DatabaseSync(':memory:')),
    LEGACY_DB: d1(legacy),
    TEAM_PASSWORD: 'simson-sounds',
    SESSION_SECRET: 'x'.repeat(40),
    ASSETS: { fetch: async (req) => { assetsSeen.push(new URL(req.url).pathname); return new Response('asset ' + new URL(req.url).pathname); } }
};

const BASE = 'https://classsoundboard.example.workers.dev';
const call = (p, init = {}) => worker.fetch(new Request(BASE + p, { redirect: 'manual', ...init }), env);
const form = (pw, ret = '/') => ({ method: 'POST', body: new URLSearchParams({ password: pw, return: ret }), headers: { 'CF-Connecting-IP': '203.0.113.9' } });

// Not set up yet
const bare = await worker.fetch(new Request(BASE + '/'), { ...env, TEAM_PASSWORD: '' });
assert(bare.status === 503, 'missing secrets → 503');

// Signed out
let r = await call('/');
assert(r.status === 303 && r.headers.get('Location') === '/login?return=%2F', 'pages redirect to sign-in');
r = await call('/media/images/x.png');
assert(r.status === 303, 'tile images need sign-in too');
r = await call('/api/soundboard');
assert(r.status === 401, 'API needs sign-in');
r = await call('/login');
assert(r.status === 200 && assetsSeen.includes('/login'), 'sign-in page is public');
assert(r.headers.get('X-Frame-Options') === 'DENY', 'security headers present');

// Wrong password, then right one
r = await call('/login', form('nope'));
assert(r.status === 303 && /error=wrong/.test(r.headers.get('Location')), 'wrong password');
assert(!r.headers.get('Set-Cookie'), 'no cookie on failure');
r = await call('/login', form('simson-sounds', '/?x=1'));
assert(r.status === 303 && r.headers.get('Location') === '/?x=1', 'returns to the page you wanted');
const cookie = r.headers.get('Set-Cookie');
assert(/sb_session=\d+\.[a-f0-9]{64}/.test(cookie) && /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Lax/.test(cookie), 'session cookie flags');
const sess = cookie.split(';')[0];
r = await call('/login', { ...form('simson-sounds', '//evil.example') });
assert(r.headers.get('Location') === '/', 'open redirect blocked');

const authed = (p, init = {}) => call(p, { ...init, headers: { ...(init.headers || {}), Cookie: sess } });
r = await authed('/');
assert(r.status === 200 && (await r.text()) === 'asset /', 'signed in → app');

// First API call copies the board from ClassManager
r = await authed('/api/soundboard');
const got = await r.json();
assert(got.board && got.board.name === 'From Blerp' && got.board.sounds[0].id === '65bcd687992ce75f00413024', 'board imported from ClassManager');
const v1 = got.updatedAt;
legacy.prepare('UPDATE soundboard_board SET board_json = ? WHERE id = ?').run(JSON.stringify({ ...legacyBoard, name: 'changed later' }), 'team');
r = await authed('/api/soundboard', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board: { ...got.board, name: 'Ours' }, baseUpdatedAt: v1 }) });
assert(r.status === 200, 'save works');
r = await authed('/api/soundboard');
assert((await r.json()).board.name === 'Ours', 'import happens once and never overwrites');

// Stale tab without a version is refused
r = await authed('/api/soundboard', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board: got.board }) });
assert(r.status === 409, 'old-code save refused');

// Upload + download
r = await authed('/api/soundboard/media', { method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, body: new Uint8Array([1, 2, 3, 4]) });
const up = await r.json();
assert(/^media:/.test(up.ref), 'upload ok');
r = await authed('/api/soundboard/media/' + up.hash);
assert(r.status === 200 && (await r.arrayBuffer()).byteLength === 4, 'download ok');

// Tampered / expired / password-changed cookies
const [exp, sig] = sess.split('=')[1].split('.');
r = await call('/', { headers: { Cookie: 'sb_session=' + (Number(exp) + 1) + '.' + sig } });
assert(r.status === 303, 'tampered cookie rejected');
r = await worker.fetch(new Request(BASE + '/', { headers: { Cookie: sess }, redirect: 'manual' }), { ...env, TEAM_PASSWORD: 'new-password' });
assert(r.status === 303, 'changing the password signs everyone out');

// Sign out
r = await authed('/logout');
assert(r.status === 303 && /Max-Age=0/.test(r.headers.get('Set-Cookie')), 'sign out clears cookie');

// Rate limit: 10 failures per IP per 15 minutes
for (let i = 0; i < 10; i++) await call('/login', form('bad' + i));
r = await call('/login', form('simson-sounds'));
assert(/error=locked/.test(r.headers.get('Location')) && !r.headers.get('Set-Cookie'), 'locked after 10 failures, even with the right password');
r = await call('/login', { ...form('simson-sounds'), headers: { 'CF-Connecting-IP': '198.51.100.7' } });
assert(r.headers.get('Set-Cookie'), 'other computers unaffected');

console.log('worker.test.mjs: ok');
