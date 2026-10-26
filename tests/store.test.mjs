/**
 * Run: node tests/soundboard-store.test.mjs
 */
import * as store from '../src/store.js';

const { prepareBoard, validateBoard } = store;

function assert(cond, msg) {
    if (!cond) {
        throw new Error(msg || 'assertion failed');
    }
}

const good = {
    schemaVersion: 2,
    name: 'From Blerp',
    sounds: [
        { id: 'sound-1', title: 'Oops', audioRef: 'remote:https://cdn.blerp.com/normalized/example' }
    ]
};

assert(validateBoard(good).ok, 'valid board');
const prepared = prepareBoard(good);
assert(prepared.ok && prepared.json.includes('sound-1'), 'prepare serializes board');

assert(!validateBoard(null).ok, 'rejects null');
assert(!validateBoard({ schemaVersion: 3, sounds: [] }).ok, 'rejects unknown version');
assert(!validateBoard({ schemaVersion: 2, sounds: [{ id: '', title: 'x', audioRef: 'a' }] }).ok, 'rejects blank id');
assert(!prepareBoard({ schemaVersion: 2, sounds: [{ id: 'a', title: 'x' }] }).ok, 'rejects missing audio');

const huge = {
    schemaVersion: 2,
    sounds: [{ id: 'a', title: 'x', audioRef: 'remote:https://example.test/' + 'y'.repeat(900000) }]
};
assert(!prepareBoard(huge).ok, 'rejects oversized board');

console.log('soundboard-store.test.mjs: ok');

// ---- Shared media + conflict rules ----
assert(prepareBoard({ schemaVersion: 2, sounds: [{ id: 'new', title: 'New Sound', audioRef: '' }] }).ok,
    'a just-added sound with no audio yet can be saved');
assert(store.checkSaveBase('2026-10-26T01:00:00.000Z', '2026-10-26T01:00:00.000Z').ok, 'same base saves');
assert(!store.checkSaveBase('2026-10-26T02:00:00.000Z', '2026-10-26T01:00:00.000Z').ok, 'stale base conflicts');
assert(!store.checkSaveBase('2026-10-26T02:00:00.000Z', null).ok, 'pages running old code cannot overwrite the board');
assert(store.checkSaveBase(null, 'x').ok, 'first save ever succeeds');
assert(store.normalizeMediaType('audio/mpeg') === 'audio/mpeg', 'audio allowed');
assert(store.normalizeMediaType('image/png; charset=binary') === 'image/png', 'image allowed');
assert(store.normalizeMediaType('image/svg+xml') === '', 'svg rejected');
assert(store.normalizeMediaType('text/html') === '', 'html rejected');
assert(store.isValidMediaHash('a'.repeat(64)) && !store.isValidMediaHash('../etc'), 'hash validation');
const big = new Uint8Array(store.MEDIA_CHUNK_BYTES * 2 + 5).map((_, i) => i % 251);
const parts = store.chunkBytes(big);
assert(parts.length === 3 && parts[2].length === 5, 'splits into 1 MB chunks');
const rejoined = store.joinChunks(parts.map((p) => store.blobToBytes(Array.from(p))));
assert(rejoined.length === big.length && rejoined[big.length - 1] === big[big.length - 1], 'chunks rejoin from D1 array form');
assert(store.blobToBytes(parts[0].slice().buffer).length === store.MEDIA_CHUNK_BYTES, 'ArrayBuffer form');
console.log('soundboard-store.test.mjs: media/conflict ok');
