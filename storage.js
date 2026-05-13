/**
 * storage.js — Save/restore board to localStorage and/or IndexedDB.
 *
 * Storage strategy:
 *   - Try localStorage first (fast, synchronous).
 *   - If it fails (typically QuotaExceededError once boards include large data),
 *     synchronously evict the stale localStorage copy and persist to IndexedDB.
 *   - On load, read BOTH and prefer the one with the newer `updatedAt` so a
 *     stale localStorage copy can never hide a fresher IndexedDB save.
 */

const STORAGE_KEY = 'soundboard-board';
const STORAGE_LOCATION_KEY = 'soundboard-board-location'; // 'local' | 'idb'
const STORAGE_SCHEMA_VERSION_KEY = 'soundboard-schema-version';
const STORAGE_SCHEMA_VERSION = 2;

const BOARD_DB_NAME = 'soundboard-storage';
const STORE_NAME = 'kv';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window || !window.indexedDB) return reject(new Error('IndexedDB not available'));
    const req = indexedDB.open(BOARD_DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
  return dbPromise;
}

function saveBoardToIdb(board) {
  if (!board || typeof board !== 'object') return Promise.resolve(false);
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(board, STORAGE_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  });
}

function loadBoardFromIdb() {
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(STORAGE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

function clearBoardFromIdb() {
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(STORAGE_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }).catch(() => false);
}

/**
 * Persist the board. Returns a Promise that resolves with the location used
 * ('local' | 'idb') on success or rejects with an Error on hard failure.
 *
 * Atomicity: when localStorage save fails (quota), we SYNCHRONOUSLY evict
 * the stale localStorage entry and set the location flag to 'idb' before
 * starting the async IDB save. That way a refresh in the middle can never
 * load a stale localStorage copy.
 */
function saveBoard(board) {
  if (!board || typeof board !== 'object') return Promise.reject(new Error('saveBoard: invalid board'));
  try { localStorage.setItem(STORAGE_SCHEMA_VERSION_KEY, String(STORAGE_SCHEMA_VERSION)); } catch (e) { console.warn('storage: schema version write failed', e); }

  let serialized;
  try {
    serialized = JSON.stringify(board);
  } catch (e) {
    return Promise.reject(e);
  }

  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    try { localStorage.setItem(STORAGE_LOCATION_KEY, 'local'); } catch (e) { console.warn('storage: location flag write failed', e); }
    // Best-effort: keep IDB in sync so cross-source loads pick the fresher copy.
    // We do not block on this; the localStorage copy is the source of truth here.
    saveBoardToIdb(board).catch((e) => { console.warn('storage: idb mirror failed', e); });
    return Promise.resolve('local');
  } catch (e) {
    console.warn('storage: local save failed; falling back to IndexedDB', e);
    // Synchronously drop the stale localStorage copy so a refresh BEFORE the
    // async IDB save completes does not load it.
    try { localStorage.removeItem(STORAGE_KEY); } catch (err) { console.warn('storage: stale clear failed', err); }
    try { localStorage.setItem(STORAGE_LOCATION_KEY, 'idb'); } catch (err) { console.warn('storage: location flag write failed', err); }
    return saveBoardToIdb(board)
      .then(() => 'idb')
      .catch((err) => {
        console.warn('storage: idb save failed', err);
        throw err;
      });
  }
}

function loadBoard() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('storage: load failed', e);
    return null;
  }
}

function loadBoardAsync() {
  return loadBoardFromIdb().catch((e) => {
    console.warn('storage: idb load failed', e);
    return null;
  });
}

function parseUpdatedAt(board) {
  if (!board || typeof board !== 'object' || !board.updatedAt) return 0;
  const t = Date.parse(String(board.updatedAt));
  return Number.isFinite(t) ? t : 0;
}

/**
 * Read both localStorage and IndexedDB and return the freshest valid board.
 * Falls back to whichever side has data if only one is present.
 */
function loadBoardLatest() {
  const localBoard = loadBoard();
  return loadBoardAsync().then((idbBoard) => {
    const localTs = parseUpdatedAt(localBoard);
    const idbTs = parseUpdatedAt(idbBoard);
    if (localBoard && idbBoard) {
      return idbTs > localTs ? idbBoard : localBoard;
    }
    return idbBoard || localBoard || null;
  }).catch(() => localBoard || null);
}

function getBoardLocation() {
  try { return localStorage.getItem(STORAGE_LOCATION_KEY) || 'local'; } catch (e) { console.warn('storage: location flag read failed', e); return 'local'; }
}

function getSchemaVersion() {
  try {
    const raw = localStorage.getItem(STORAGE_SCHEMA_VERSION_KEY);
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 1;
  } catch (e) {
    console.warn('storage: schema version read failed', e);
    return 1;
  }
}

function setSchemaVersion(version) {
  try { localStorage.setItem(STORAGE_SCHEMA_VERSION_KEY, String(version)); } catch (e) { console.warn('storage: schema version write failed', e); }
}

function clearBoard() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_LOCATION_KEY);
  } catch (e) {
    console.warn('storage: clear failed', e);
  }
  return clearBoardFromIdb();
}

window.SoundboardStorage = {
  saveBoard,
  loadBoard,
  loadBoardAsync,
  loadBoardLatest,
  getBoardLocation,
  getSchemaVersion,
  setSchemaVersion,
  clearBoard,
  SCHEMA_VERSION: STORAGE_SCHEMA_VERSION
};
