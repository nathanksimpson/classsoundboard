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
    extra: s.extra && typeof s.extra === 'object' ? s.extra : {}
  };
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

function ensureUniqueSoundId(existingIds, sound) {
  const base = normalizeSound(sound);
  if (!existingIds.has(base.id)) return base;
  let n = 2;
  let candidate = base.id + '-copy';
  while (existingIds.has(candidate)) {
    candidate = base.id + '-copy-' + n;
    n++;
  }
  return { ...base, id: candidate };
}

const RECENTS_MAX_DEFAULT = 20;

/**
 * Merge incoming board sounds into existing board.
 * options.duplicateStrategy: 'skip' | 'replace' | 'rename' (default 'skip')
 */
function mergeBoards(existing, incoming, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const duplicateStrategy = opts.duplicateStrategy === 'replace' || opts.duplicateStrategy === 'rename'
    ? opts.duplicateStrategy
    : 'skip';

  const base = normalizeBoard(existing && typeof existing === 'object' ? existing : { sounds: [] });
  const inc = normalizeBoard(incoming && typeof incoming === 'object' ? incoming : { sounds: [] });
  const merged = JSON.parse(JSON.stringify(base));
  const existingIds = new Set((merged.sounds || []).map((s) => String(s.id)));
  const existingHotkeys = new Map();
  (merged.sounds || []).forEach((s) => {
    const hk = String(s.hotkey || '').trim();
    if (hk) existingHotkeys.set(hk, s.id);
  });

  let added = 0;
  let skipped = 0;
  let hotkeyConflicts = 0;

  (inc.sounds || []).forEach((rawSound) => {
    const sound = normalizeSound(rawSound);
    const id = String(sound.id);

    if (existingIds.has(id)) {
      if (duplicateStrategy === 'replace') {
        const idx = merged.sounds.findIndex((s) => String(s.id) === id);
        if (idx >= 0) merged.sounds[idx] = sound;
        added++;
      } else if (duplicateStrategy === 'rename') {
        const unique = ensureUniqueSoundId(existingIds, sound);
        merged.sounds.push(unique);
        existingIds.add(unique.id);
        added++;
      } else {
        skipped++;
      }
      return;
    }

    const hk = String(sound.hotkey || '').trim();
    if (hk && existingHotkeys.has(hk)) {
      sound.hotkey = '';
      hotkeyConflicts++;
    } else if (hk) {
      existingHotkeys.set(hk, sound.id);
    }

    merged.sounds.push(sound);
    existingIds.add(sound.id);
    added++;
  });

  // Merge quickAccess favourites/recents if present on incoming board.
  const incQa = inc.quickAccess && typeof inc.quickAccess === 'object' ? inc.quickAccess : null;
  if (incQa) {
    if (!merged.quickAccess || typeof merged.quickAccess !== 'object') {
      merged.quickAccess = {};
    }
    const favSet = new Set(Array.isArray(merged.quickAccess.favourites) ? merged.quickAccess.favourites.map(String) : []);
    (Array.isArray(incQa.favourites) ? incQa.favourites : []).forEach((id) => {
      if (existingIds.has(String(id))) favSet.add(String(id));
    });
    merged.quickAccess.favourites = Array.from(favSet);

    const recentList = Array.isArray(merged.quickAccess.recents) ? merged.quickAccess.recents.map(String) : [];
    const recentSet = new Set(recentList);
    (Array.isArray(incQa.recents) ? incQa.recents : []).forEach((id) => {
      const sid = String(id);
      if (existingIds.has(sid) && !recentSet.has(sid)) {
        recentList.push(sid);
        recentSet.add(sid);
      }
    });
    merged.quickAccess.recents = recentList.slice(-RECENTS_MAX_DEFAULT);
  }

  return {
    board: merged,
    stats: { added, skipped, hotkeyConflicts }
  };
}

window.SoundboardBoardManager = {
  validateSound,
  validateBoard,
  normalizeSound,
  normalizeBoard,
  generateId,
  createDefaultSound,
  ensureUniqueSoundId,
  mergeBoards
};
