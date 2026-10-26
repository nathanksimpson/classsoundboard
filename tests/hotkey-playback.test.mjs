/**
 * Run: node tests/soundboard-hotkey-playback.test.mjs
 * Real key sequences against the page-wide hotkey listener (initKeyboard).
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const listeners = {};
const doc = { addEventListener(t, f) { (listeners[t] ||= []).push(f); }, visibilityState: 'visible' };
const win = { addEventListener(t, f) { (listeners['w' + t] ||= []).push(f); } };
const ctx = { window: win, document: doc, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/hotkey-engine.js'), 'utf8'), ctx);
const H = ctx.window.SoundboardHotkeys;

const played = [];
const map = new Map(['Q', 'W', 'Shift+Y', 'Shift+R', 'A+B'].map((k) => [k, { title: k }]));
H.initKeyboard({ getHotkeyMap: () => map, onPlay: (s) => played.push(s.title) });

const body = { closest: () => null };
const el = (type) => { const e = { type, closest: (sel) => (sel === 'input' ? e : null) }; return e; };
const search = el('search');
const slider = el('range');
let shift = false;
function fire(type, key, code, target = body) {
    const e = { type, key, code, target, shiftKey: shift, ctrlKey: false, altKey: false, metaKey: false, repeat: false, getModifierState: () => false, preventDefault() {} };
    (listeners[type] || []).forEach((f) => f(e));
}
const down = (k, c, t) => { if (k === 'Shift') shift = true; fire('keydown', k, c, t); };
const up = (k, c, t) => { if (k === 'Shift') shift = false; fire('keyup', k, c, t); };
function expect(name, seq, want) {
    played.length = 0;
    seq();
    listeners.wblur.forEach((f) => f());
    const got = JSON.stringify(played);
    if (got !== JSON.stringify(want)) throw new Error(name + ': expected ' + JSON.stringify(want) + ', got ' + got);
}

expect('English Q', () => { down('q', 'KeyQ'); up('q', 'KeyQ'); }, ['Q']);
expect('Korean keyboard (Q types ㅂ)', () => { down('ㅂ', 'KeyQ'); up('ㅂ', 'KeyQ'); }, ['Q']);
expect('Windows IME Process/ㅂ mismatch does not jam later keys', () => {
    down('Process', 'KeyQ'); up('ㅂ', 'KeyQ'); down('w', 'KeyW'); up('w', 'KeyW');
}, ['Q', 'W']);
expect('Hotkeys work while the volume slider has focus', () => {
    down('ArrowRight', 'ArrowRight', slider); up('ArrowRight', 'ArrowRight', slider);
    down('q', 'KeyQ', slider); up('q', 'KeyQ', slider);
}, ['Q']);
expect('Quick overlapping taps both play', () => {
    down('q', 'KeyQ'); down('w', 'KeyW'); up('q', 'KeyQ'); up('w', 'KeyW');
}, ['Q', 'W']);
expect('Holding Shift: Shift+Y then Shift+R', () => {
    down('Shift', 'ShiftLeft'); down('Y', 'KeyY'); up('Y', 'KeyY'); down('R', 'KeyR'); up('R', 'KeyR'); up('Shift', 'ShiftLeft');
}, ['Shift+Y', 'Shift+R']);
expect('Chords still work', () => { down('a', 'KeyA'); down('b', 'KeyB'); up('a', 'KeyA'); up('b', 'KeyB'); }, ['A+B']);
expect('Typing in a text box is ignored', () => { down('q', 'KeyQ', search); up('q', 'KeyQ', search); }, []);
expect('A key released inside a text box is not stuck', () => {
    down('q', 'KeyQ'); up('q', 'KeyQ', search); down('w', 'KeyW'); up('w', 'KeyW');
}, ['W']);

// Recording a shortcut with the Korean keyboard on stores the Latin key.
const box = { value: '' };
H.captureHotkeyFromInputKeydown({ target: box, key: 'ㅂ', code: 'KeyQ', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, getModifierState: () => false, preventDefault() {} });
if (box.value !== 'Q') throw new Error('recording in 한글 mode should store Q, got ' + box.value);

console.log('soundboard-hotkey-playback.test.mjs: ok');
