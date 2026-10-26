/**
 * Run: node tests/soundboard-worker-media.test.mjs
 * Exercises worker/src/soundboard.js against a tiny in-memory stand-in for D1:
 * multi-chunk uploads, serving, de-duplication and save conflicts.
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const Soundboard = await import(path.join(__dirname, '../src/soundboard.js'));

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}

// Minimal D1 fake: just the statements soundboard.js issues.
function fakeD1() {
    let board = null;
    const media = new Map();
    function exec(sql, p) {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('CREATE TABLE')) return { rows: [], changes: 0 };
        if (q.startsWith('SELECT updated_at FROM soundboard_board')) return { rows: board ? [{ updated_at: board.updated_at }] : [] };
        if (q.startsWith('SELECT board_json, updated_at FROM soundboard_board')) return { rows: board ? [{ ...board }] : [] };
        if (q.startsWith('UPDATE soundboard_board')) {
            if (!board || board.updated_at !== p[4]) return { rows: [], changes: 0 };
            board = { board_json: p[0], updated_at: p[1] };
            return { rows: [], changes: 1 };
        }
        if (q.startsWith('INSERT INTO soundboard_board')) { board = { board_json: p[1], updated_at: p[2] }; return { rows: [], changes: 1 }; }
        if (q.startsWith('SELECT chunk_count FROM soundboard_media')) {
            const r = media.get(p[0] + ':0'); return { rows: r ? [{ chunk_count: r.chunk_count }] : [] };
        }
        if (q.startsWith('SELECT COUNT(*) AS n FROM soundboard_media')) {
            return { rows: [{ n: [...media.keys()].filter((k) => k.startsWith(p[0] + ':')).length }] };
        }
        if (q.startsWith('INSERT OR REPLACE INTO soundboard_media')) {
            assert(p[5] instanceof ArrayBuffer, 'chunks must be bound as ArrayBuffer');
            assert(p[5].byteLength <= 1024 * 1024, 'chunk under D1 row limit');
            media.set(p[0] + ':' + p[1], { chunk_index: p[1], chunk_count: p[2], mime: p[3], byte_size: p[4], data: Array.from(new Uint8Array(p[5])) });
            return { rows: [], changes: 1 };
        }
        if (q.startsWith('SELECT chunk_index, chunk_count, mime, byte_size, data')) {
            return { rows: [...media.entries()].filter(([k]) => k.startsWith(p[0] + ':')).map(([, v]) => v).sort((a, b) => a.chunk_index - b.chunk_index) };
        }
        throw new Error('unexpected SQL: ' + q);
    }
    const stmt = (sql, params = []) => ({
        bind: (...p) => stmt(sql, p),
        first: async () => exec(sql, params).rows[0] || null,
        all: async () => ({ results: exec(sql, params).rows }),
        run: async () => ({ meta: { changes: exec(sql, params).changes || 0 } })
    });
    return { DB: { prepare: (sql) => stmt(sql) }, media };
}

const env = fakeD1();
const bytes = new Uint8Array(2.5 * 1024 * 1024).map((_, i) => (i * 7) % 256);
const req = new Request('https://x/api/soundboard/media', { method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, body: bytes });
const up = await Soundboard.putMedia(env, req, 'u1');
assert(/^media:[a-f0-9]{64}$/.test(up.ref), 'returns a shared media ref');
assert(env.media.size === 3, 'stored in 3 chunks, got ' + env.media.size);

const res = await Soundboard.getMediaResponse(env, up.hash);
assert(res.status === 200 && res.headers.get('Content-Type') === 'audio/mpeg', 'serves the file');
const back = new Uint8Array(await res.arrayBuffer());
assert(back.length === bytes.length && back[back.length - 1] === bytes[bytes.length - 1], 'bytes round-trip');
assert(/immutable/.test(res.headers.get('Cache-Control')), 'cached forever by hash');

const again = await Soundboard.putMedia(env, new Request('https://x', { method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, body: bytes }), 'u2');
assert(again.reused && again.ref === up.ref, 'same file is stored once');

let rejected = false;
try { await Soundboard.putMedia(env, new Request('https://x', { method: 'PUT', headers: { 'Content-Type': 'image/svg+xml' }, body: '<svg/>' }), 'u'); }
catch (e) { rejected = e.status === 415; }
assert(rejected, 'svg upload refused');
assert((await Soundboard.getMediaResponse(env, 'nope')).status === 404, 'bad hash 404');

// Board versions / conflicts
const b1 = { schemaVersion: 2, sounds: [{ id: 'a', title: 'A', audioRef: up.ref }] };
const s1 = await Soundboard.saveBoard(env, b1, 'u1', null);
const s2 = await Soundboard.saveBoard(env, { ...b1, name: 'x' }, 'u1', s1.updatedAt);
assert(s2.updatedAt > s1.updatedAt, 'versions increase');
let conflict = null;
try { await Soundboard.saveBoard(env, b1, 'u2', s1.updatedAt); } catch (e) { conflict = e; }
assert(conflict && conflict.status === 409 && conflict.body.board.name === 'x', 'stale save gets 409 with the current board');
const unchanged = await Soundboard.getBoard(env, s2.updatedAt);
assert(unchanged.unchanged === true && !unchanged.board, 'poll with current version returns no body');
const changed = await Soundboard.getBoard(env, s1.updatedAt);
assert(changed.board && changed.updatedAt === s2.updatedAt, 'poll with old version returns the board');

console.log('soundboard-worker-media.test.mjs: ok');
