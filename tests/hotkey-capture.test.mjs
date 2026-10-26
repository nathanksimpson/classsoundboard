/**
 * Run: node tests/soundboard-hotkey.test.mjs
 * Shortcut capture must keep the full chord after the first key is released.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(__dirname, '../public/js/hotkey-engine.js'), 'utf8');
const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(code, context);
const Hotkeys = context.window.SoundboardHotkeys;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function press(target, props) {
  const e = Object.assign({
    target,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    defaultPrevented: false,
    preventDefault() { e.defaultPrevented = true; }
  }, props);
  Hotkeys.captureHotkeyFromInputKeydown(e);
  return e;
}

function release(target, props) {
  const e = Object.assign({
    target,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    defaultPrevented: false,
    preventDefault() { e.defaultPrevented = true; }
  }, props);
  Hotkeys.captureHotkeyFromInputKeyup(e);
  return e;
}

const chord = { value: '' };
press(chord, { key: 'a', code: 'KeyA' });
press(chord, { key: 'b', code: 'KeyB' });
assert(chord.value === 'A+B', 'live chord should be A+B, got ' + chord.value);
release(chord, { key: 'a', code: 'KeyA' });
assert(chord.value === 'A+B', 'releasing A should keep A+B, got ' + chord.value);
release(chord, { key: 'b', code: 'KeyB' });
assert(chord.value === 'A+B', 'releasing B should keep A+B, got ' + chord.value);
press(chord, { key: 'q', code: 'KeyQ' });
assert(chord.value === 'Q', 'the next press should replace the chord, got ' + chord.value);

const shifted = { value: 'Q' };
const shiftDown = press(shifted, { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
assert(shiftDown.defaultPrevented, 'Shift should be swallowed while recording');
assert(shifted.value === 'Q', 'modifier only should keep the previous shortcut, got ' + shifted.value);
press(shifted, { key: 'a', code: 'KeyA', shiftKey: true });
assert(shifted.value === 'Shift+A', 'Shift+A should show while held, got ' + shifted.value);
release(shifted, { key: 'Shift', code: 'ShiftLeft', shiftKey: false });
assert(shifted.value === 'Shift+A', 'releasing Shift first should keep Shift+A, got ' + shifted.value);
release(shifted, { key: 'a', code: 'KeyA', shiftKey: false });
assert(shifted.value === 'Shift+A', 'releasing A should keep Shift+A, got ' + shifted.value);

const four = { value: '' };
press(four, { key: 'a', code: 'KeyA' });
press(four, { key: 'b', code: 'KeyB' });
press(four, { key: 'c', code: 'KeyC' });
assert(four.value === 'A+B+C', 'three keys should be kept, got ' + four.value);
press(four, { key: 'd', code: 'KeyD' });
assert(four.value === 'A+B+C', 'a fourth key should not clear the box, got ' + four.value);

const cleared = { value: 'Shift+A' };
Hotkeys.clearHotkeyField(cleared);
assert(cleared.value === '', 'clear should empty the box');
press(cleared, { key: 'q', code: 'KeyQ' });
assert(cleared.value === 'Q', 'a key after clear should record, got ' + cleared.value);

const kept = { value: 'Q' };
Hotkeys.resetHotkeyCapture(kept);
assert(kept.value === 'Q', 'reset should keep the text already in the box');

const alt = press({ value: '' }, { key: 'Alt', code: 'AltLeft', altKey: true });
assert(alt.defaultPrevented, 'Alt should be swallowed so the menu does not take focus');
const ctrl = press({ value: '' }, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
assert(ctrl.defaultPrevented, 'Ctrl should be swallowed while recording');

console.log('soundboard-hotkey.test.mjs: ok');
