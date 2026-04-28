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
    startMs: s.startMs != null ? Number(s.startMs) : null,
    endMs: s.endMs != null ? Number(s.endMs) : null,
    hotkey: s.hotkey != null ? String(s.hotkey).trim() : '',
    color: s.color != null ? String(s.color).trim() : '',
    extra: s.extra && typeof s.extra === 'object' ? s.extra : {}
  };
}

function normalizeBoard(board) {
  const sounds = (board.sounds || []).map(normalizeSound);
  return {
    schemaVersion: 1,
    id: String(board.id ?? 'board-1').trim(),
    name: String(board.name ?? 'Untitled Board').trim(),
    description: String(board.description ?? '').trim(),
    createdAt: board.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sounds
  };
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
