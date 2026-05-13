/**
 * local-images.js — IndexedDB store for user-supplied images (album art, thumbnails).
 *
 * Mirrors local-audio.js. Images are kept out of the board JSON (which lives in
 * localStorage) so the JSON stays small enough to avoid quota errors. The board
 * references images by ID with the `local-image:<id>` URL scheme; this module
 * resolves them to short-lived object URLs.
 *
 * Each record stores: { arrayBuffer, mime, savedAt }
 */

const IMAGES_DB_NAME = 'soundboard-images';
const STORE_NAME = 'blobs';
let dbPromise = null;
const objectUrlCache = new Map(); // id -> object URL

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window || !window.indexedDB) return reject(new Error('IndexedDB not available'));
    const req = indexedDB.open(IMAGES_DB_NAME, 1);
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

function generateId() {
  return 'img-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function putBlob(id, arrayBuffer, mime) {
  if (!id || !arrayBuffer) return Promise.reject(new Error('local-images: invalid args'));
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ arrayBuffer, mime: String(mime || 'image/jpeg'), savedAt: new Date().toISOString() }, id);
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => reject(tx.error);
    });
  });
}

function getBlob(id) {
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

function removeBlob(id) {
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }).then(() => {
    const cached = objectUrlCache.get(id);
    if (cached) {
      try { URL.revokeObjectURL(cached); } catch (e) { console.warn('local-images: revokeObjectURL failed', e); }
      objectUrlCache.delete(id);
    }
  });
}

function listKeys() {
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAllKeys ? store.getAllKeys() : null;
      if (!req) {
        const keys = [];
        const cursorReq = store.openKeyCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) { keys.push(cursor.key); cursor.continue(); } else resolve(keys);
        };
        cursorReq.onerror = () => reject(cursorReq.error);
        return;
      }
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error);
    });
  });
}

/**
 * Resolve a local-image:<id> reference to an object URL, caching the result.
 * Returns null if the image is missing.
 */
function getObjectUrl(id) {
  if (!id) return Promise.resolve(null);
  if (objectUrlCache.has(id)) return Promise.resolve(objectUrlCache.get(id));
  return getBlob(id).then((rec) => {
    if (!rec || !rec.arrayBuffer) return null;
    const blob = new Blob([rec.arrayBuffer], { type: rec.mime || 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    objectUrlCache.set(id, url);
    return url;
  });
}

/**
 * Convert a data:image/...;base64,... URL into an IDB-stored record.
 * Returns the new id (caller stores it as 'local-image:<id>').
 */
function putDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return Promise.reject(new Error('local-images: not a data URL'));
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return Promise.reject(new Error('local-images: unsupported data URL format'));
  const mime = m[1];
  const b64 = m[2];
  try {
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    const id = generateId();
    return putBlob(id, bytes.buffer, mime).then(() => id);
  } catch (e) {
    return Promise.reject(e);
  }
}

window.SoundboardLocalImages = {
  putBlob,
  getBlob,
  removeBlob,
  getObjectUrl,
  putDataUrl,
  listKeys,
  generateId
};
