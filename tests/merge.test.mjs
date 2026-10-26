/**
 * Run: node tests/soundboard-merge.test.mjs
 * Three-way merge used when two computers save the shared board at once.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ctx = { window: {}, document: { getElementById: () => null, addEventListener() {} }, console, JSON, Map, Set };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/repository.js'), 'utf8'), ctx);
const { mergeBoards } = ctx.window.SoundboardRepository;

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const snd = (id, extra) => Object.assign({ id, title: id, audioRef: 'media:' + 'a'.repeat(64) }, extra || {});
const board = (sounds, extra) => Object.assign({ schemaVersion: 2, name: 'B', layout: { categoryOrder: [], quickAccess: { favourites: [] } }, sounds }, extra || {});
const ids = (b) => b.sounds.map((s) => s.id).join(',');
const get = (b, id) => b.sounds.find((s) => s.id === id);

const base = board([snd('a'), snd('b'), snd('c')]);

let m = mergeBoards(base, board([snd('a', { title: 'mine' }), snd('b'), snd('c')]), board([snd('a'), snd('b', { title: 'theirs' }), snd('c')]));
assert(get(m, 'a').title === 'mine' && get(m, 'b').title === 'theirs', 'different sounds edited: both kept');

m = mergeBoards(base, board([snd('a'), snd('b'), snd('c'), snd('d')]), board([snd('a'), snd('b'), snd('c'), snd('e')]));
assert(['a,b,c,d,e', 'a,b,c,e,d'].includes(ids(m)), 'both additions kept, got ' + ids(m));

m = mergeBoards(base, board([snd('a'), snd('c')]), board([snd('a'), snd('b'), snd('c', { title: 'x' })]));
assert(ids(m) === 'a,c' && get(m, 'c').title === 'x', 'our delete of an untouched sound sticks');

m = mergeBoards(base, board([snd('a'), snd('b'), snd('c')]), board([snd('a'), snd('c')]));
assert(ids(m) === 'a,c', 'their delete sticks when we did not touch it');

m = mergeBoards(base, board([snd('a'), snd('b', { title: 'edited' }), snd('c')]), board([snd('a'), snd('c')]));
assert(get(m, 'b') && get(m, 'b').title === 'edited', 'an edited sound survives a delete elsewhere');

m = mergeBoards(base, board([snd('c'), snd('a'), snd('b')]), board([snd('a'), snd('b'), snd('c', { title: 'x' })]));
assert(ids(m) === 'c,a,b' && get(m, 'c').title === 'x', 'our reorder applies, their edit kept');

m = mergeBoards(base, board([snd('a'), snd('b'), snd('c')], { name: 'Renamed' }), board([snd('a'), snd('b'), snd('c')], {
    layout: { categoryOrder: ['Music'], quickAccess: { favourites: ['a'] } }
}));
assert(m.name === 'Renamed' && m.layout.categoryOrder[0] === 'Music' && m.layout.quickAccess.favourites[0] === 'a', 'board fields merge separately');
assert(Array.isArray(m.layout.quickAccess.recents) && m.layout.quickAccess.recents.length === 0, 'recents never shared');

console.log('soundboard-merge.test.mjs: ok');
