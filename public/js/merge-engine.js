/**
 * merge-engine.js — Merge/replace boards (v2), ported from board-manager.js.
 */
(function () {
  const Schema = function () { return window.SoundboardSchema; };

  function normalizeRemoteUrl(url) {
    try {
      const u = new URL(String(url));
      return (u.protocol + '//' + u.host + u.pathname).toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function getAudioBasename(audioRef, soundId) {
    const fu = String(audioRef || '').trim();
    if (!fu) return '';
    if (fu.startsWith('blob:audio:')) return fu.slice('blob:audio:'.length);
    if (fu.startsWith('/media/audio/')) return pathBasename(fu);
    let pathPart = fu;
    if (fu.startsWith('zip:')) pathPart = fu.slice(4);
    pathPart = pathPart.split('?')[0].split('#')[0];
    const base = pathPart.split('/').pop() || '';
    if (!base) return soundId ? String(soundId) : '';
    return base.replace(/\.[^.]+$/, '');
  }

  function pathBasename(p) {
    return String(p).split('/').pop().replace(/\.[^.]+$/, '');
  }

  function getSoundMatchKeys(sound) {
    const S = Schema();
    const s = S.normalizeSoundV2(sound);
    const keys = [];
    if (s.id) keys.push('id:' + s.id);
    const extra = s.extra || {};
    if (extra.blerpId) keys.push('blerp:' + String(extra.blerpId).trim());
    const audioBase = getAudioBasename(s.audioRef, s.id);
    if (audioBase) keys.push('audio:' + audioBase);
    const fu = s.audioRef;
    if (fu && /^https?:/i.test(fu)) {
      const norm = normalizeRemoteUrl(fu);
      if (norm) keys.push('url:' + norm);
    }
    return keys;
  }

  function buildSoundMatchIndex(sounds) {
    const index = new Map();
    (sounds || []).forEach(function (raw) {
      const sid = String(Schema().normalizeSoundV2(raw).id);
      getSoundMatchKeys(raw).forEach(function (k) {
        if (!index.has(k)) index.set(k, sid);
      });
    });
    return index;
  }

  function findExistingSoundIdForIncoming(incoming, matchIndex) {
    if (!matchIndex || !matchIndex.size) return null;
    const keys = getSoundMatchKeys(incoming);
    for (let i = 0; i < keys.length; i++) {
      if (matchIndex.has(keys[i])) return matchIndex.get(keys[i]);
    }
    return null;
  }

  function isFragileRef(ref) {
    const u = String(ref || '').trim();
    // Any blob: ref points into one browser's private storage, so an imported
    // copy of that sound's file always replaces it.
    return !u || u.startsWith('zip:') || u.startsWith('blob:');
  }

  function repairExistingFromIncoming(existing, incoming) {
    if (!existing || !incoming) return false;
    let changed = false;
    const exA = String(existing.audioRef || '').trim();
    const inA = String(incoming.audioRef || '').trim();
    if (isFragileRef(exA) && inA && !inA.startsWith('zip:')) {
      existing.audioRef = inA;
      changed = true;
    }
    const inExtra = incoming.extra || {};
    if (!existing.extra) existing.extra = {};
    ['blerpId', 'blerpUrl', 'blerpAudioUrl', 'blerpDuration', 'source'].forEach(function (key) {
      if (inExtra[key] != null && inExtra[key] !== '' && existing.extra[key] == null) {
        existing.extra[key] = inExtra[key];
        changed = true;
      }
    });
    if (!existing.extra.blerpId && /^[a-f0-9]{24}$/i.test(String(incoming.id || ''))) {
      existing.extra.blerpId = String(incoming.id);
      changed = true;
    }
    return changed;
  }

  function mergeBoards(existing, incoming, options) {
    const S = Schema();
    const base = S.normalizeBoard(existing || { sounds: [] });
    const inc = S.normalizeBoard(incoming || { sounds: [] });
    const merged = JSON.parse(JSON.stringify(base));
    const existingIds = new Set(merged.sounds.map(function (s) { return String(s.id); }));
    const matchIndex = buildSoundMatchIndex(merged.sounds);
    const hotkeys = new Map();
    merged.sounds.forEach(function (s) {
      const hk = typeof window !== 'undefined' && window.SoundboardHotkeys
        ? window.SoundboardHotkeys.normalizeHotkeyInput(s.hotkey || '')
        : String(s.hotkey || '').trim();
      if (hk) {
        s.hotkey = hk;
        hotkeys.set(hk, s.id);
      }
    });

    let added = 0, skipped = 0, hotkeyConflicts = 0;

    (inc.sounds || []).forEach(function (raw) {
      const sound = S.normalizeSoundV2(raw);
      const id = String(sound.id);
      const matchedId = findExistingSoundIdForIncoming(sound, matchIndex);
      const isDup = matchedId != null || existingIds.has(id);

      if (isDup) {
        const idx = merged.sounds.findIndex(function (s) {
          return String(s.id) === String(matchedId || id);
        });
        if (idx >= 0) repairExistingFromIncoming(merged.sounds[idx], sound);
        skipped++;
        return;
      }

      const hkNorm = typeof window !== 'undefined' && window.SoundboardHotkeys
        ? window.SoundboardHotkeys.normalizeHotkeyInput(sound.hotkey || '')
        : String(sound.hotkey || '').trim();
      sound.hotkey = hkNorm;
      if (hkNorm && hotkeys.has(hkNorm)) {
        sound.hotkey = '';
        hotkeyConflicts++;
      } else if (hkNorm) {
        hotkeys.set(hkNorm, sound.id);
      }

      merged.sounds.push(sound);
      existingIds.add(sound.id);
      getSoundMatchKeys(sound).forEach(function (k) {
        if (!matchIndex.has(k)) matchIndex.set(k, sound.id);
      });
      added++;
    });

    const incLayout = inc.layout || {};
    if (!merged.layout) merged.layout = { categoryOrder: [], categoryCollapsed: {}, quickAccess: { favourites: [], recents: [] } };
    const favSet = new Set((merged.layout.quickAccess.favourites || []).map(String));
    (incLayout.quickAccess && incLayout.quickAccess.favourites || []).forEach(function (fid) {
      if (existingIds.has(String(fid))) favSet.add(String(fid));
    });
    merged.layout.quickAccess.favourites = Array.from(favSet);

    const recents = (merged.layout.quickAccess.recents || []).map(String);
    const recSet = new Set(recents);
    (incLayout.quickAccess && incLayout.quickAccess.recents || []).forEach(function (rid) {
      const sid = String(rid);
      if (existingIds.has(sid) && !recSet.has(sid)) {
        recents.push(sid);
        recSet.add(sid);
      }
    });
    merged.layout.quickAccess.recents = recents.slice(-20);

    const order = merged.layout.categoryOrder || [];
    const orderSet = new Set(order);
    (inc.layout && inc.layout.categoryOrder || []).forEach(function (c) {
      if (!orderSet.has(c)) order.push(c);
    });
    merged.layout.categoryOrder = order;

    return { board: S.normalizeBoard(merged), stats: { added, skipped, hotkeyConflicts } };
  }

  function getNewIncomingSoundIds(existing, incoming) {
    const S = Schema();
    const base = S.normalizeBoard(existing || { sounds: [] });
    const inc = S.normalizeBoard(incoming || { sounds: [] });
    const matchIndex = buildSoundMatchIndex(base.sounds);
    const ids = new Set();
    inc.sounds.forEach(function (raw) {
      const sound = S.normalizeSoundV2(raw);
      if (findExistingSoundIdForIncoming(sound, matchIndex)) return;
      ids.add(String(sound.id));
    });
    return ids;
  }

  window.SoundboardMergeEngine = {
    mergeBoards,
    getNewIncomingSoundIds,
    findExistingSoundIdForIncoming,
    buildSoundMatchIndex,
    repairExistingFromIncoming,
    isFragileRef
  };
})();
