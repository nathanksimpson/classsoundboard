/**
 * Run: node tests/import-repair.test.mjs
 * Importing a ZIP exported from the old ClassManager soundboard must replace
 * sounds whose audio only existed in one browser (blob:audio:…) with the
 * uploaded shared file, without touching anything else.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ctx = { window: {}, console, JSON, Map, Set, URL };
vm.createContext(ctx);
for (const f of ['schema.js', 'hotkey-engine.js', 'merge-engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js', f), 'utf8'), ctx);
}
const Merge = ctx.window.SoundboardMergeEngine;
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

const H = 'media:' + 'b'.repeat(64);
const current = { schemaVersion: 2, sounds: [
    { id: '65ce6ef07cf135ed9ed6f2c4', title: 'john cena', audioRef: 'blob:audio:65ce6ef07cf135ed9ed6f2c4', hotkey: 'J', volume: 0.5 },
    { id: 'keep', title: 'keep', audioRef: 'remote:https://cdn.example/a' }
] };
const fromZip = { schemaVersion: 2, sounds: [
    { id: '65ce6ef07cf135ed9ed6f2c4', title: 'john cena', audioRef: H, hotkey: 'J', volume: 1 },
    { id: 'keep', title: 'keep', audioRef: 'media:' + 'c'.repeat(64) }
] };
const { board, stats } = Merge.mergeBoards(current, fromZip);
const jc = board.sounds.find((s) => s.id === '65ce6ef07cf135ed9ed6f2c4');
assert(jc.audioRef === H, 'browser-only audio replaced by the uploaded file, got ' + jc.audioRef);
assert(jc.volume === 0.5 && jc.hotkey === 'J', 'existing settings kept');
assert(board.sounds.find((s) => s.id === 'keep').audioRef === 'remote:https://cdn.example/a', 'working sounds untouched');
assert(stats.added === 0, 'no duplicates added');
console.log('import-repair.test.mjs: ok');
