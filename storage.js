/**
 * storage.js — Save/restore board to localStorage.
 * Key: soundboard-board
 */

const STORAGE_KEY = 'soundboard-board';
const STORAGE_LOCATION_KEY = 'soundboard-board-location'; // 'local' | 'idb'

const DB_NAME = 'soundboard-storage';
const STORE_NAME = 'kv';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window || !window.indexedDB) return reject(new Error('IndexedDB not available'));
    const req = indexedDB.open(DB_NAME, 1);
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

function saveBoard(board) {
  if (!board || typeof board !== 'object') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
    try { localStorage.setItem(STORAGE_LOCATION_KEY, 'local'); } catch (_) {}
  } catch (e) {
    // localStorage can fail (QuotaExceededError) once boards include embedded images.
    // Fall back to IndexedDB so the board persists across refresh.
    console.warn('storage: local save failed; falling back to IndexedDB', e);
    saveBoardToIdb(board).then(() => {
      try { localStorage.setItem(STORAGE_LOCATION_KEY, 'idb'); } catch (_) {}
      // Keep localStorage lean so subsequent saves don't keep throwing.
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    }).catch((err) => {
      console.warn('storage: idb save failed', err);
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

function getBoardLocation() {
  try { return localStorage.getItem(STORAGE_LOCATION_KEY) || 'local'; } catch (_) { return 'local'; }
}

function clearBoard() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_LOCATION_KEY);
  } catch (e) {
    console.warn('storage: clear failed', e);
  }
}

window.SoundboardStorage = { saveBoard, loadBoard, loadBoardAsync, getBoardLocation, clearBoard };
