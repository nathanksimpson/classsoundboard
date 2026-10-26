/**
 * schema.js — Board validation and normalization (v1 import + v2 native).
 */
(function () {
  const MAX_RECENTS = 20;

  function validateSoundV1(s) {
    if (!s || typeof s !== 'object') return false;
    if (typeof s.id !== 'string' || !s.id.trim()) return false;
    if (typeof s.title !== 'string') return false;
    const ref = s.fileUrl != null ? s.fileUrl : s.audioRef;
    if (typeof ref !== 'string' || !ref.trim()) return false;
    return true;
  }

  function validateSoundV2(s) {
    if (!s || typeof s !== 'object') return false;
    if (typeof s.id !== 'string' || !s.id.trim()) return false;
    if (typeof s.title !== 'string') return false;
    if (typeof s.audioRef !== 'string' || !s.audioRef.trim()) return false;
    return true;
  }

  function validateBoard(board) {
    if (!board || typeof board !== 'object') return { ok: false, error: 'not an object' };
    const v = board.schemaVersion;
    if (v !== 1 && v !== 2) return { ok: false, error: 'unsupported schemaVersion' };
    if (!Array.isArray(board.sounds)) return { ok: false, error: 'missing sounds' };
    const validate = v === 2 ? validateSoundV2 : validateSoundV1;
    for (let i = 0; i < board.sounds.length; i++) {
      if (!validate(board.sounds[i])) return { ok: false, error: 'invalid sound at ' + i };
    }
    return { ok: true };
  }

  function normalizeQuickAccess(qa) {
    if (!qa || typeof qa !== 'object') return { favourites: [], recents: [] };
    return {
      favourites: Array.isArray(qa.favourites) ? qa.favourites.map(String).filter(Boolean) : [],
      recents: Array.isArray(qa.recents) ? qa.recents.map(String).filter(Boolean).slice(0, MAX_RECENTS) : []
    };
  }

  function normalizeLayout(layout, quickAccess) {
    const src = layout && typeof layout === 'object' ? layout : {};
    const qa = quickAccess && typeof quickAccess === 'object' ? quickAccess : src.quickAccess;
    return {
      categoryOrder: Array.isArray(src.categoryOrder) ? src.categoryOrder.map(String) : [],
      categoryCollapsed: src.categoryCollapsed && typeof src.categoryCollapsed === 'object' ? { ...src.categoryCollapsed } : {},
      quickAccess: normalizeQuickAccess(qa)
    };
  }

  function v1RefToV2(fileUrl, imageUrl, soundId) {
    const fu = String(fileUrl || '').trim();
    const iu = String(imageUrl || '').trim();
    let audioRef = fu;
    let imageRef = iu;
    if (fu.startsWith('local:')) audioRef = 'blob:audio:' + soundId;
    else if (fu.startsWith('zip:')) audioRef = 'zip:' + fu.slice(4);
    else if (/^https?:/i.test(fu)) audioRef = fu;
    else if (fu.startsWith('audio/') || fu.startsWith('./audio/')) audioRef = '/media/audio/' + fu.replace(/^\.?\//, '').split('/').pop();
    else if (fu.startsWith('boards/')) audioRef = '/' + fu.replace(/^\.?\//, '');

    if (iu.startsWith('local-image:')) imageRef = 'blob:image:' + iu.slice('local-image:'.length);
    else if (iu.startsWith('zip:')) imageRef = 'zip:' + iu.slice(4);
    else if (/^https?:/i.test(iu)) imageRef = iu;
    else if (iu.startsWith('data:image')) imageRef = iu;
    else if (iu.startsWith('images/')) imageRef = '/media/images/' + iu.split('/').pop();
    return { audioRef, imageRef };
  }

  function normalizeEndMs(endMs, startMs, extra) {
    if (endMs == null || !isFinite(Number(endMs))) return null;
    let end = Number(endMs);
    const blerpDur = extra && extra.blerpDuration != null && isFinite(Number(extra.blerpDuration))
      ? Number(extra.blerpDuration)
      : null;
    if (end > 600000) {
      if (blerpDur != null && blerpDur > 0) end = blerpDur;
      else if (end > 100000) end = Math.round(end / 1000);
      else return null;
    }
    if (blerpDur != null && blerpDur > 0 && end > blerpDur * 3) end = blerpDur;
    const start = startMs != null && isFinite(Number(startMs)) ? Number(startMs) : 0;
    if (end <= start) return null;
    return end;
  }

  function normalizeSoundV2(s) {
    const id = String(s.id).trim();
    let audioRef = s.audioRef != null ? String(s.audioRef).trim() : '';
    let imageRef = s.imageRef != null ? String(s.imageRef).trim() : '';
    if (!audioRef && s.fileUrl) {
      const converted = v1RefToV2(s.fileUrl, s.imageUrl, id);
      audioRef = converted.audioRef;
      imageRef = converted.imageRef;
    }
    return {
      id,
      title: String(s.title ?? '').trim(),
      audioRef,
      imageRef,
      category: s.category != null ? String(s.category).trim() : '',
      tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
      volume: s.volume != null ? Math.max(0, Math.min(1, Number(s.volume))) : 1,
      playbackRate: s.playbackRate != null ? Math.max(0.25, Math.min(4, Number(s.playbackRate))) : 1,
      loop: s.loop === true,
      momentary: s.momentary === true,
      startMs: s.startMs != null ? Number(s.startMs) : null,
      endMs: normalizeEndMs(s.endMs, s.startMs, s.extra),
      hotkey: s.hotkey != null ? String(s.hotkey).trim() : '',
      color: s.color != null ? String(s.color).trim() : '',
      extra: s.extra && typeof s.extra === 'object' ? { ...s.extra } : {}
    };
  }

  function normalizeBoard(board) {
    const src = board && typeof board === 'object' ? board : {};
    const isV2 = src.schemaVersion === 2;
    const sounds = (src.sounds || []).map(normalizeSoundV2);
    const layout = normalizeLayout(src.layout, src.quickAccess);
    return {
      schemaVersion: 2,
      id: String(src.id ?? 'board-1').trim(),
      name: String(src.name ?? 'Untitled Board').trim(),
      description: String(src.description ?? '').trim(),
      createdAt: src.createdAt ?? new Date().toISOString(),
      updatedAt: src.updatedAt ?? src.createdAt ?? new Date().toISOString(),
      layout,
      sounds
    };
  }

  function soundForPlayback(sound) {
    const s = normalizeSoundV2(sound);
    return {
      ...s,
      fileUrl: s.audioRef,
      imageUrl: s.imageRef
    };
  }

  function generateId() {
    return 'sound-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  function createDefaultSound(overrides) {
    const o = overrides && typeof overrides === 'object' ? overrides : {};
    return normalizeSoundV2({
      id: generateId(),
      title: 'New Sound',
      audioRef: '',
      imageRef: '',
      category: '',
      tags: [],
      volume: 1,
      playbackRate: 1,
      loop: false,
      momentary: false,
      startMs: null,
      endMs: null,
      hotkey: '',
      color: '#6b7280',
      extra: {},
      ...o
    });
  }

  window.SoundboardSchema = {
    validateBoard,
    normalizeBoard,
    normalizeSoundV2,
    soundForPlayback,
    generateId,
    createDefaultSound,
    v1RefToV2
  };
})();
