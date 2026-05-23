/**
 * board-manager.js — Load board JSON, validate schema, manage state (add/edit/delete).
 */

function validateSound(s) {
  if (!s || typeof s !== 'object') return false;
  if (typeof s.id !== 'string' || !s.id.trim()) return false;
  if (typeof s.title !== 'string') return false;
  if (typeof s.fileUrl !== 'string' || !s.fileUrl.trim()) return false;
  if (s.volume != null && (typeof s.volume !== 'number' || s.volume < 0 || s.volume > 1)) return false;
  if (s.playbackRate != null && (typeof s.playbackRate !== 'number' || s.playbackRate < 0.25 || s.playbackRate > 4)) return false;
  if (s.momentary != null && typeof s.momentary !== 'boolean') return false;
  if (s.startMs != null && typeof s.startMs !== 'number') return false;
  if (s.endMs != null && typeof s.endMs !== 'number') return false;
  if (s.startMs != null && s.endMs != null && s.startMs >= s.endMs) return false;
  if (s.extra && typeof s.extra === 'object') {
    if (s.extra.normGain != null && (typeof s.extra.normGain !== 'number' || !isFinite(s.extra.normGain) || s.extra.normGain < 0 || s.extra.normGain > 8)) {
      return false;
    }
    if (s.extra.normAlgoVersion != null && (typeof s.extra.normAlgoVersion !== 'number' || s.extra.normAlgoVersion < 1)) {
      return false;
    }
  }
  return true;
}

function validateBoard(board) {
  if (!board || typeof board !== 'object') return { ok: false, error: 'Invalid board: not an object' };
  if (board.schemaVersion !== 1) return { ok: false, error: 'Invalid board: unsupported schemaVersion' };
  if (!Array.isArray(board.sounds)) return { ok: false, error: 'Invalid board: missing or invalid sounds array' };
  for (let i = 0; i < board.sounds.length; i++) {
    if (!validateSound(board.sounds[i])) {
      return { ok: false, error: 'Invalid sound at index ' + i };
    }
  }
  return { ok: true };
}

function normalizeSound(s) {
  return {
    id: String(s.id).trim(),
    title: String(s.title ?? '').trim(),
    fileUrl: String(s.fileUrl ?? '').trim(),
    imageUrl: s.imageUrl != null ? String(s.imageUrl).trim() : '',
    category: s.category != null ? String(s.category).trim() : '',
    tags: Array.isArray(s.tags) ? s.tags.map((t) => String(t)) : [],
    volume: s.volume != null ? Math.max(0, Math.min(1, Number(s.volume))) : 1,
    playbackRate: s.playbackRate != null ? Math.max(0.25, Math.min(4, Number(s.playbackRate))) : 1,
    loop: s.loop === true,
    momentary: s.momentary === true,
    startMs: s.startMs != null ? Number(s.startMs) : null,
    endMs: s.endMs != null ? Number(s.endMs) : null,
    hotkey: s.hotkey != null ? String(s.hotkey).trim() : '',
    color: s.color != null ? String(s.color).trim() : '',
    extra: normalizeSoundExtra(s.extra)
  };
}

function normalizeSoundExtra(extra) {
  if (!extra || typeof extra !== 'object') return {};
  const out = { ...extra };
  if (out.normGain != null) {
    const g = Number(out.normGain);
    out.normGain = isFinite(g) ? Math.max(0, Math.min(8, g)) : undefined;
    if (out.normGain === undefined) delete out.normGain;
  }
  if (out.normAlgoVersion != null) {
    const v = Number(out.normAlgoVersion);
    out.normAlgoVersion = isFinite(v) && v >= 1 ? Math.floor(v) : undefined;
    if (out.normAlgoVersion === undefined) delete out.normAlgoVersion;
  }
  return out;
}

// Reserved top-level fields that have explicit normalization rules below.
// Any other top-level keys on the input board are preserved as-is so that
// forward-compatible additions (e.g. quickAccess) survive normalize().
const RESERVED_BOARD_KEYS = new Set([
  'schemaVersion',
  'id',
  'name',
  'description',
  'createdAt',
  'updatedAt',
  'sounds',
  'quickAccess'
]);

const MAX_RECENT_SOUNDS_IN_BOARD = 20;

function normalizeQuickAccess(qa) {
  if (!qa || typeof qa !== 'object') {
    return { favourites: [], recents: [] };
  }
  const favourites = Array.isArray(qa.favourites)
    ? qa.favourites.map((id) => String(id).trim()).filter(Boolean)
    : [];
  const recents = Array.isArray(qa.recents)
    ? qa.recents.map((id) => String(id).trim()).filter(Boolean).slice(0, MAX_RECENT_SOUNDS_IN_BOARD)
    : [];
  return { favourites, recents };
}

function normalizeBoard(board) {
  const src = board && typeof board === 'object' ? board : {};
  const sounds = (src.sounds || []).map(normalizeSound);
  const normalized = {
    schemaVersion: 1,
    id: String(src.id ?? 'board-1').trim(),
    name: String(src.name ?? 'Untitled Board').trim(),
    description: String(src.description ?? '').trim(),
    createdAt: src.createdAt ?? new Date().toISOString(),
    // Preserve updatedAt from the source. The saver owns timestamp updates so
    // that load/normalize round-trips do not artificially refresh the value
    // (which would break freshness comparisons between localStorage and IDB).
    updatedAt: src.updatedAt ?? src.createdAt ?? new Date().toISOString(),
    sounds
  };
  normalized.quickAccess = normalizeQuickAccess(src.quickAccess);
  // Carry forward unknown / forward-compatible top-level fields.
  Object.keys(src).forEach((key) => {
    if (!RESERVED_BOARD_KEYS.has(key)) {
      normalized[key] = src[key];
    }
  });
  return normalized;
}

function generateId() {
  return 'sound-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

function createDefaultSound(overrides = {}) {
  return normalizeSound({
    id: generateId(),
    title: 'New Sound',
    fileUrl: '',
    imageUrl: '',
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
    ...overrides
  });
}

window.SoundboardBoardManager = {
  validateSound,
  validateBoard,
  normalizeSound,
  normalizeBoard,
  generateId,
  createDefaultSound
};
