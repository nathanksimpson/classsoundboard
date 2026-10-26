/**
 * hotkey-engine.js — Normalize, capture, and match hotkeys including multi-key chords (up to 3 parts).
 * Format: optional Ctrl/Alt/Shift/Meta modifiers + up to 3 key tokens, e.g. A+B, Shift+A, Shift+A+B
 */
(function () {
  const MAX_CHORD_PARTS = 3;
  const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];
  const MODIFIER_ALIASES = new Map([
    ['CTRL', 'Ctrl'], ['CONTROL', 'Ctrl'],
    ['ALT', 'Alt'], ['OPTION', 'Alt'],
    ['SHIFT', 'Shift'],
    ['META', 'Meta'], ['CMD', 'Meta'], ['COMMAND', 'Meta'], ['WIN', 'Meta'], ['WINDOWS', 'Meta']
  ]);
  const KEY_ALIASES = new Map([
    ['SPACE', 'Space'], ['SPACEBAR', 'Space'],
    ['ESC', 'Escape'], ['RETURN', 'Enter'],
    ['UP', 'ArrowUp'], ['DOWN', 'ArrowDown'], ['LEFT', 'ArrowLeft'], ['RIGHT', 'ArrowRight'],
    ['PERIOD', '.'], ['DOT', '.'], ['COMMA', ','], ['SLASH', '/'], ['QUESTION', '/'],
    ['BACKSLASH', '\\'], ['SEMICOLON', ';'], ['COLON', ';'],
    ['QUOTE', "'"], ['APOSTROPHE', "'"], ['BACKQUOTE', '`'], ['GRAVE', '`'],
    ['MINUS', '-'], ['DASH', '-'], ['EQUAL', '='], ['PLUS', '='],
    ['LBRACKET', '['], ['RBRACKET', ']'], ['BRACKETLEFT', '['], ['BRACKETRIGHT', ']']
  ]);
  const SHIFTED_CHAR_TO_BASE = {
    '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8',
    '(': '9', ')': '0', '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\',
    ':': ';', '"': "'", '<': ',', '>': '.', '?': '/'
  };
  const KEY_EVENT_ALIAS = {
    ' ': 'Space', Spacebar: 'Space', Esc: 'Escape', Return: 'Enter',
    Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight'
  };
  const MODIFIER_EVENT_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta']);

  const heldKeyTokens = new Set();
  const activeMomentaryChords = new Set();
  const chordSessionKeys = new Set();
  let chordSessionModifiers = [];
  let peakHeldKeyCount = 0;
  let chordSessionConsumed = false;

  function modifiersActive(e) {
    return !!(e && (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey));
  }

  function isSessionIdle(e) {
    return heldKeyTokens.size === 0 && !modifiersActive(e);
  }

  function resetChordSession() {
    chordSessionKeys.clear();
    chordSessionModifiers = [];
    peakHeldKeyCount = 0;
    chordSessionConsumed = false;
  }

  function recordSessionKeydown(e, token) {
    if (token) chordSessionKeys.add(token);
    getModifiersFromEvent(e).forEach(function (m) {
      if (chordSessionModifiers.indexOf(m) === -1) chordSessionModifiers.push(m);
    });
    peakHeldKeyCount = Math.max(peakHeldKeyCount, heldKeyTokens.size);
  }

  function isReleasingSessionPart(e, token) {
    if (token && chordSessionKeys.has(token)) return true;
    if (e.key === 'Shift' && chordSessionModifiers.indexOf('Shift') !== -1) return true;
    if (e.key === 'Control' && chordSessionModifiers.indexOf('Ctrl') !== -1) return true;
    if (e.key === 'Alt' && chordSessionModifiers.indexOf('Alt') !== -1) return true;
    if (e.key === 'Meta' && chordSessionModifiers.indexOf('Meta') !== -1) return true;
    return false;
  }

  function shouldFireChordOnRelease() {
    const sessionSize = chordSessionKeys.size;
    if (!sessionSize || chordSessionConsumed) return false;
    if (sessionSize === 1) return peakHeldKeyCount >= 1;
    return peakHeldKeyCount >= sessionSize;
  }

  function finalizeChordSession(getHotkeyMap, onPlay) {
    const keys = Array.from(chordSessionKeys);
    const modifiers = chordSessionModifiers.slice();
    const signature = buildChordSignature(modifiers, keys);
    if (!signature) return false;
    const hotkeyMap = getHotkeyMap();
    const sound = hotkeyMap.get(signature);
    if (sound && chordExactMatch(signature, modifiers, keys)) {
      if (sound.momentary) return false;
      chordSessionConsumed = true;
      onPlay(sound);
      return true;
    }
    // No chord matches — the keys were just pressed quickly and overlapped
    // (e.g. Q pressed before W was released). Play each one as if tapped
    // separately instead of dropping them all.
    if (keys.length > 1) {
      const singles = [];
      keys.forEach(function (k) {
        const single = buildChordSignature(modifiers, [k]);
        const s = single ? hotkeyMap.get(single) : null;
        if (s && !s.momentary) singles.push(s);
      });
      if (singles.length) {
        chordSessionConsumed = true;
        singles.forEach(function (s) { onPlay(s); });
        return true;
      }
    }
    return false;
  }

  function normalizeKeyToken(token) {
    const trimmed = String(token || '').trim();
    if (!trimmed) return '';
    if (trimmed.length === 1) {
      if (/^[a-z]$/i.test(trimmed)) return trimmed.toUpperCase();
      return trimmed;
    }
    const upper = trimmed.toUpperCase();
    if (/^F([1-9]|1[0-2])$/.test(upper)) return upper;
    if (KEY_ALIASES.has(upper)) return KEY_ALIASES.get(upper);
    const canonical = {
      ENTER: 'Enter', TAB: 'Tab', ESCAPE: 'Escape', BACKSPACE: 'Backspace', DELETE: 'Delete',
      INSERT: 'Insert', HOME: 'Home', END: 'End', PAGEUP: 'PageUp', PAGEDOWN: 'PageDown',
      ARROWUP: 'ArrowUp', ARROWDOWN: 'ArrowDown', ARROWLEFT: 'ArrowLeft', ARROWRIGHT: 'ArrowRight'
    };
    if (canonical[upper]) return canonical[upper];
    return '';
  }

  function normalizeHotkeyInput(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    const compact = text.replace(/\s*\+\s*/g, '+');
    const rawParts = compact.split('+').map(function (p) { return p.trim(); }).filter(Boolean);
    if (!rawParts.length) return '';

    const modifiers = new Set();
    const keys = [];
    for (let i = 0; i < rawParts.length; i++) {
      const part = rawParts[i];
      const mod = MODIFIER_ALIASES.get(part.toUpperCase());
      if (mod) {
        modifiers.add(mod);
        continue;
      }
      const key = normalizeKeyToken(part);
      if (!key) return '';
      keys.push(key);
    }

    const orderedMods = MODIFIER_ORDER.filter(function (m) { return modifiers.has(m); });
    const uniqueKeys = [];
    keys.forEach(function (k) {
      if (!uniqueKeys.includes(k)) uniqueKeys.push(k);
    });
    uniqueKeys.sort(function (a, b) {
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    });

    const totalParts = orderedMods.length + uniqueKeys.length;
    if (totalParts === 0 || totalParts > MAX_CHORD_PARTS) return '';

    return orderedMods.concat(uniqueKeys).join('+');
  }

  function parseHotkey(value) {
    const normalized = normalizeHotkeyInput(value);
    if (!normalized) return { modifiers: [], keys: [], signature: '' };
    const parts = normalized.split('+');
    const modifiers = [];
    const keys = [];
    parts.forEach(function (part) {
      if (MODIFIER_ORDER.includes(part)) modifiers.push(part);
      else keys.push(part);
    });
    return { modifiers: modifiers, keys: keys, signature: normalized };
  }

  function keyFromCode(code) {
    const c = String(code || '');
    if (!c) return '';
    if (c === 'Space') return 'Space';
    if (c === 'Tab') return 'Tab';
    if (c === 'Enter') return 'Enter';
    if (c === 'Escape') return 'Escape';
    if (c === 'Backspace') return 'Backspace';
    if (c === 'Delete') return 'Delete';
    if (c === 'Insert') return 'Insert';
    if (c === 'Home') return 'Home';
    if (c === 'End') return 'End';
    if (c === 'PageUp') return 'PageUp';
    if (c === 'PageDown') return 'PageDown';
    if (/^Arrow/.test(c)) return c;
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit[0-9]$/.test(c)) return c.slice(5);
    if (/^F([1-9]|1[0-2])$/.test(c)) return c;
    const punct = {
      Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
      Backslash: '\\', IntlBackslash: '\\', Semicolon: ';', Quote: "'",
      Comma: ',', Period: '.', Slash: '/'
    };
    return punct[c] || '';
  }

  function getModifiersFromEvent(e) {
    const mods = [];
    const altGraph = e && typeof e.getModifierState === 'function' && e.getModifierState('AltGraph');
    if (e.ctrlKey && !altGraph) mods.push('Ctrl');
    if (e.altKey || altGraph) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Meta');
    return MODIFIER_ORDER.filter(function (m) { return mods.includes(m); });
  }

  function getKeyTokenFromKeyboardEvent(e) {
    if (!e) return '';
    if (MODIFIER_EVENT_KEYS.has(e.key)) return '';
    if (/^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/.test(String(e.code || ''))) return '';

    // Use the physical key first. With the Korean input source on, e.key is a
    // Hangul letter (Q → ㅂ) or "Process", and keydown/keyup can disagree, which
    // left keys "stuck" and silently killed every hotkey. e.code is the same
    // key whatever the input language, so press and release always match.
    const physical = keyFromCode(e.code);
    if (physical) return normalizeKeyToken(physical);

    let key = e.key || '';
    if (!key) key = keyFromCode(e.code);
    if (!key) return '';
    if (key === 'Dead' || key === 'Process' || key === 'Unidentified') {
      const fallback = keyFromCode(e.code);
      if (fallback) key = fallback;
    }
    if (key === 'AltGraph') return '';
    if (KEY_EVENT_ALIAS[key]) key = KEY_EVENT_ALIAS[key];
    if (key.length === 1) {
      if (e.shiftKey && SHIFTED_CHAR_TO_BASE[key]) key = SHIFTED_CHAR_TO_BASE[key];
      if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
    }
    return normalizeKeyToken(key);
  }

  function buildChordSignature(modifiers, keyTokens) {
    const mods = MODIFIER_ORDER.filter(function (m) { return modifiers.includes(m); });
    const keys = keyTokens.slice().sort(function (a, b) {
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    });
    const uniqueKeys = [];
    keys.forEach(function (k) {
      if (k && !uniqueKeys.includes(k)) uniqueKeys.push(k);
    });
    const total = mods.length + uniqueKeys.length;
    if (total === 0 || total > MAX_CHORD_PARTS) return '';
    return mods.concat(uniqueKeys).join('+');
  }

  function getHotkeySignatureFromKeyboardEvent(e) {
    const token = getKeyTokenFromKeyboardEvent(e);
    if (!token) return '';
    return buildChordSignature(getModifiersFromEvent(e), [token]);
  }

  function getHeldChordSignature(e) {
    return buildChordSignature(getModifiersFromEvent(e), Array.from(heldKeyTokens));
  }

  function chordExactMatch(signature, modifiers, keyTokens) {
    const parsed = parseHotkey(signature);
    if (!parsed.signature) return false;
    if (parsed.modifiers.length !== modifiers.length) return false;
    for (let i = 0; i < parsed.modifiers.length; i++) {
      if (parsed.modifiers[i] !== modifiers[i]) return false;
    }
    if (parsed.keys.length !== keyTokens.length) return false;
    const sortedHeld = keyTokens.slice().sort(function (a, b) { return a.localeCompare(b); });
    const sortedParsed = parsed.keys.slice().sort(function (a, b) { return a.localeCompare(b); });
    for (let j = 0; j < sortedParsed.length; j++) {
      if (sortedParsed[j] !== sortedHeld[j]) return false;
    }
    return true;
  }

  function modifierNameFromEventKey(key) {
    if (key === 'Shift') return 'Shift';
    if (key === 'Control') return 'Ctrl';
    if (key === 'Alt') return 'Alt';
    if (key === 'Meta') return 'Meta';
    return '';
  }

  function emptyHotkeyGesture() {
    return { keys: new Set(), modifiers: [], locked: false };
  }

  function resetHotkeyCapture(input) {
    if (!input) return;
    delete input._hotkeyGesture;
  }

  function clearHotkeyField(input) {
    if (!input) return;
    input.value = '';
    resetHotkeyCapture(input);
  }

  function rememberGestureModifier(gesture, mod) {
    if (mod && gesture.modifiers.indexOf(mod) === -1) gesture.modifiers.push(mod);
  }

  /**
   * Record a shortcut into a text field.
   * The field updates only on keydown. The first keyup locks that chord so
   * releasing one key does not shrink it. The next keydown starts a new chord.
   * Modifier-only presses do not replace a shortcut already in the box.
   * A fourth part is ignored instead of clearing the field.
   */
  function captureHotkeyFromInputKeydown(e, onEnter) {
    if (!e) return;
    const key = e.key || '';
    if (key === 'Tab') return;
    if (key === 'Enter') {
      e.preventDefault();
      if (typeof onEnter === 'function') onEnter();
      return;
    }
    if (key === 'Backspace' || key === 'Delete') {
      e.preventDefault();
      clearHotkeyField(e.target);
      return;
    }
    if (key === 'Escape') {
      if (e.target && typeof e.target.blur === 'function') e.target.blur();
      return;
    }
    if (!e.target) return;
    if (e.repeat) {
      e.preventDefault();
      return;
    }

    const modKey = modifierNameFromEventKey(key);
    if (modKey) {
      e.preventDefault();
      let gesture = e.target._hotkeyGesture;
      if (!gesture || gesture.locked) {
        gesture = emptyHotkeyGesture();
        e.target._hotkeyGesture = gesture;
      }
      if (!gesture.keys.size) {
        rememberGestureModifier(gesture, modKey);
        return;
      }
      const nextMods = gesture.modifiers.slice();
      if (nextMods.indexOf(modKey) === -1) nextMods.push(modKey);
      const signature = buildChordSignature(nextMods, Array.from(gesture.keys));
      if (!signature) return;
      gesture.modifiers = nextMods;
      e.target.value = signature;
      return;
    }

    const token = getKeyTokenFromKeyboardEvent(e);
    if (!token) return;
    e.preventDefault();

    let gesture = e.target._hotkeyGesture;
    if (!gesture || gesture.locked) {
      gesture = emptyHotkeyGesture();
      e.target._hotkeyGesture = gesture;
    }

    const modsBefore = gesture.modifiers.slice();
    getModifiersFromEvent(e).forEach(function (m) { rememberGestureModifier(gesture, m); });

    const nextKeys = Array.from(gesture.keys);
    if (nextKeys.indexOf(token) === -1) nextKeys.push(token);
    const signature = buildChordSignature(gesture.modifiers, nextKeys);
    if (!signature) {
      gesture.modifiers = modsBefore;
      return;
    }
    gesture.keys.add(token);
    e.target.value = signature;
  }

  function captureHotkeyFromInputKeyup(e) {
    if (!e || !e.target) return;
    const modKey = modifierNameFromEventKey(e.key || '');
    if (modKey === 'Alt' || modKey === 'Ctrl' || modKey === 'Meta') e.preventDefault();

    const gesture = e.target._hotkeyGesture;
    if (!gesture || gesture.locked) return;

    const token = getKeyTokenFromKeyboardEvent(e);
    const belongs = (modKey && gesture.modifiers.indexOf(modKey) !== -1)
      || (token && gesture.keys.has(token));

    if (!gesture.keys.size) {
      if (belongs || modKey) delete e.target._hotkeyGesture;
      return;
    }

    // Lock on the first release so later keyups cannot shrink the chord.
    // A mismatched keyup token (Korean IME) still locks once a real key is recorded.
    if (belongs || token || modKey) gesture.locked = true;
  }

  const NON_TEXT_INPUT_TYPES = new Set([
    'range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'color'
  ]);
  const NAVIGATION_TOKENS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'
  ]);

  /**
   * Is the user typing into this element, so hotkeys must stay quiet?
   * Only real text boxes count. Sliders, checkboxes and buttons keep focus
   * after a click; treating them as text boxes made every hotkey stop working
   * after someone touched the volume slider. A focused slider still keeps its
   * arrow keys.
   */
  function isTypingTarget(target, token) {
    if (!target || typeof target.closest !== 'function') return false;
    if (target.closest('textarea') || target.closest('select') || target.closest('[contenteditable="true"]')) return true;
    const input = target.closest('input');
    if (!input) return false;
    const type = String(input.type || input.getAttribute && input.getAttribute('type') || 'text').toLowerCase();
    if (!NON_TEXT_INPUT_TYPES.has(type)) return true;
    if (type === 'range' && token && NAVIGATION_TOKENS.has(token)) return true;
    return false;
  }

  function initKeyboard(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const getHotkeyMap = typeof opts.getHotkeyMap === 'function' ? opts.getHotkeyMap : function () { return new Map(); };
    const onPlay = typeof opts.onPlay === 'function' ? opts.onPlay : function () {};
    const isBlocked = typeof opts.isBlocked === 'function' ? opts.isBlocked : function () { return false; };

    document.addEventListener('keydown', function (e) {
      if (isBlocked(e)) return;
      const token = getKeyTokenFromKeyboardEvent(e);
      if (isTypingTarget(e.target, token)) return;
      if (e.repeat) return;

      if (chordSessionConsumed) {
        // Only modifiers are still held (e.g. Shift kept down after Shift+Y):
        // a new key starts a fresh shortcut, so Shift+Y then Shift+R both play.
        if (token && heldKeyTokens.size === 0) resetChordSession();
        else return;
      }
      if (token) heldKeyTokens.add(token);
      recordSessionKeydown(e, token);

      const modifiers = getModifiersFromEvent(e);
      const keys = Array.from(heldKeyTokens);
      const signature = buildChordSignature(modifiers, keys);
      if (!signature) return;

      const hotkeyMap = getHotkeyMap();
      const sound = hotkeyMap.get(signature);
      if (!sound || !chordExactMatch(signature, modifiers, keys)) return;

      // Momentary: start only once the full chord is held. Normal sounds fire on release.
      if (!sound.momentary) return;

      if (activeMomentaryChords.has(signature)) return;
      activeMomentaryChords.add(signature);
      e.preventDefault();
      onPlay(sound, 'momentary-start');
    });

    document.addEventListener('keyup', function (e) {
      const token = getKeyTokenFromKeyboardEvent(e);
      // Always forget a released key, wherever focus is now. Skipping this when
      // focus had moved (a dialog opened, a text box was clicked) left the key
      // "held" forever and blocked every later hotkey.
      if (isBlocked(e) || isTypingTarget(e.target, token)) {
        if (token) heldKeyTokens.delete(token);
        if (isSessionIdle(e)) resetChordSession();
        return;
      }

      const chordsToStop = [];

      activeMomentaryChords.forEach(function (chord) {
        const parsed = parseHotkey(chord);
        if (token && parsed.keys.indexOf(token) !== -1) chordsToStop.push(chord);
        if (e.key === 'Shift' && parsed.modifiers.indexOf('Shift') !== -1) chordsToStop.push(chord);
        if (e.key === 'Control' && parsed.modifiers.indexOf('Ctrl') !== -1) chordsToStop.push(chord);
        if (e.key === 'Alt' && parsed.modifiers.indexOf('Alt') !== -1) chordsToStop.push(chord);
        if (e.key === 'Meta' && parsed.modifiers.indexOf('Meta') !== -1) chordsToStop.push(chord);
      });

      if (token) heldKeyTokens.delete(token);

      chordsToStop.forEach(function (chord) {
        if (!activeMomentaryChords.has(chord)) return;
        activeMomentaryChords.delete(chord);
        const sound = getHotkeyMap().get(chord);
        if (sound && sound.momentary) onPlay(sound, 'momentary-stop');
      });

      if (isReleasingSessionPart(e, token) && shouldFireChordOnRelease()) {
        if (finalizeChordSession(getHotkeyMap, onPlay)) {
          e.preventDefault();
        }
      }

      if (isSessionIdle(e)) {
        resetChordSession();
        activeMomentaryChords.clear();
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'hidden') return;
      heldKeyTokens.clear();
      resetChordSession();
    });

    window.addEventListener('blur', function () {
      heldKeyTokens.clear();
      resetChordSession();
      if (activeMomentaryChords.size) {
        activeMomentaryChords.clear();
        if (typeof opts.onMomentaryCancel === 'function') opts.onMomentaryCancel();
      }
    });
  }

  window.SoundboardHotkeys = {
    MAX_CHORD_PARTS,
    normalizeHotkeyInput,
    parseHotkey,
    getHotkeySignatureFromKeyboardEvent,
    getHeldChordSignature,
    buildChordSignature,
    captureHotkeyFromInputKeydown,
    captureHotkeyFromInputKeyup,
    resetHotkeyCapture,
    clearHotkeyField,
    initKeyboard,
    isTypingTarget
  };
})();
