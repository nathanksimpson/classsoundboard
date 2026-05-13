/**
 * file-mode.js — "File-on-disk" mode using the File System Access API.
 *
 * Lets the user pick a portable ZIP file once; we remember the handle in
 * IndexedDB and on subsequent loads we (with one click of permission) read
 * the board back from that file. On every save we write the latest portable
 * ZIP back to the same file.
 *
 * Only available on Chrome/Edge desktop (browsers that expose
 * window.showOpenFilePicker / showSaveFilePicker and FileSystemFileHandle).
 * On unsupported browsers (iOS Safari, Firefox) all methods become no-ops
 * that report unsupported = true.
 */

const FILE_HANDLE_DB = 'soundboard-file-mode';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'attached';
let dbPromise = null;

function isSupported() {
  return typeof window !== 'undefined'
    && typeof window.showOpenFilePicker === 'function'
    && typeof window.showSaveFilePicker === 'function';
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window || !window.indexedDB) return reject(new Error('IndexedDB not available'));
    const req = indexedDB.open(FILE_HANDLE_DB, 1);
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

function putHandle(handle) {
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

function getHandle() {
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }).catch((e) => {
    console.warn('file-mode: getHandle failed', e);
    return null;
  });
}

function clearHandle() {
  return openDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }).catch((e) => { console.warn('file-mode: clearHandle failed', e); });
}

/**
 * Request read/write permission on a handle. Returns 'granted', 'denied',
 * 'prompt' (= will need a user-gesture click), or 'unsupported'.
 */
async function queryPermission(handle, mode = 'readwrite') {
  if (!handle || typeof handle.queryPermission !== 'function') return 'unsupported';
  try {
    const state = await handle.queryPermission({ mode });
    return state;
  } catch (e) {
    console.warn('file-mode: queryPermission failed', e);
    return 'denied';
  }
}

async function requestPermission(handle, mode = 'readwrite') {
  if (!handle || typeof handle.requestPermission !== 'function') return 'unsupported';
  try {
    const state = await handle.requestPermission({ mode });
    return state;
  } catch (e) {
    console.warn('file-mode: requestPermission failed', e);
    return 'denied';
  }
}

async function readAttachedFile() {
  const handle = await getHandle();
  if (!handle) return { ok: false, reason: 'no-handle' };
  let perm = await queryPermission(handle, 'read');
  if (perm === 'prompt') {
    perm = await requestPermission(handle, 'read');
  }
  if (perm !== 'granted') {
    return { ok: false, reason: 'no-permission', handle };
  }
  try {
    const file = await handle.getFile();
    return { ok: true, file, handle };
  } catch (e) {
    console.warn('file-mode: getFile failed', e);
    return { ok: false, reason: 'read-failed', handle };
  }
}

async function writeAttachedFile(blob) {
  const handle = await getHandle();
  if (!handle) return { ok: false, reason: 'no-handle' };
  let perm = await queryPermission(handle, 'readwrite');
  if (perm === 'prompt') {
    perm = await requestPermission(handle, 'readwrite');
  }
  if (perm !== 'granted') {
    return { ok: false, reason: 'no-permission' };
  }
  try {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { ok: true };
  } catch (e) {
    console.warn('file-mode: write failed', e);
    return { ok: false, reason: 'write-failed', error: e };
  }
}

/**
 * Open File Picker — user picks an existing portable ZIP and we save its
 * handle for future read/write. Returns { ok, file, handle } on success.
 */
async function pickAndAttach() {
  if (!isSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const handles = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: 'Soundboard portable ZIP',
        accept: { 'application/zip': ['.zip'] }
      }]
    });
    const handle = handles && handles[0];
    if (!handle) return { ok: false, reason: 'cancelled' };
    const perm = await requestPermission(handle, 'readwrite');
    if (perm !== 'granted') return { ok: false, reason: 'no-permission', handle };
    const file = await handle.getFile();
    await putHandle(handle);
    return { ok: true, file, handle };
  } catch (e) {
    if (e && (e.name === 'AbortError' || /cancel/i.test(String(e.message || '')))) {
      return { ok: false, reason: 'cancelled' };
    }
    console.warn('file-mode: pickAndAttach failed', e);
    return { ok: false, reason: 'error', error: e };
  }
}

/**
 * Save File Picker — user picks WHERE to save a new portable ZIP; we write
 * the bytes and remember the handle so subsequent saves go to the same file.
 */
async function saveAndAttach(blob, suggestedName) {
  if (!isSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: suggestedName || 'soundboard-portable.zip',
      types: [{
        description: 'Soundboard portable ZIP',
        accept: { 'application/zip': ['.zip'] }
      }]
    });
    if (!handle) return { ok: false, reason: 'cancelled' };
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    await putHandle(handle);
    return { ok: true, handle };
  } catch (e) {
    if (e && (e.name === 'AbortError' || /cancel/i.test(String(e.message || '')))) {
      return { ok: false, reason: 'cancelled' };
    }
    console.warn('file-mode: saveAndAttach failed', e);
    return { ok: false, reason: 'error', error: e };
  }
}

async function getAttachmentInfo() {
  const handle = await getHandle();
  if (!handle) return { attached: false };
  const perm = await queryPermission(handle, 'readwrite');
  return {
    attached: true,
    name: handle.name || '',
    permission: perm,
    handle
  };
}

async function detach() {
  await clearHandle();
}

window.SoundboardFileMode = {
  isSupported,
  pickAndAttach,
  saveAndAttach,
  readAttachedFile,
  writeAttachedFile,
  getAttachmentInfo,
  detach
};
