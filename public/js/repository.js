/**
 * repository.js — The shared sound board and its media.
 *
 * The server is the source of truth: one team board (/api/soundboard) and
 * uploaded audio/images (/api/soundboard/media, referenced as `media:<sha256>`).
 * IndexedDB here is only a cache — an offline copy of the board and of media
 * bytes already downloaded. A browser never writes references to its own
 * private storage into the shared board.
 *
 * Every save says which server version it was based on. If another computer
 * saved in between, the server answers 409 and we merge sound-by-sound
 * (see mergeBoards) and save again. A light poll picks up other computers'
 * changes while the page is open.
 */
(function () {
  const DB_NAME = 'soundboard-v3';
  const DB_VERSION = 1;
  const META_KEY = 'meta';
  const API_PATH = '/api/soundboard';
  const MEDIA_API_PATH = '/api/soundboard/media';
  const DEFAULT_BOARD_URL = '/boards/default/board.json';
  const LOGIN_URL = '/login';
  const POLL_MS = 15000;
  const SAVE_DEBOUNCE_MS = 400;
  const MAX_CONFLICT_RETRIES = 4;

  let dbPromise = null;
  let liveBoard = null;
  /** Last board we know the server holds (what our local edits are based on). */
  let baseBoard = null;
  let serverUpdatedAt = null;
  let dirty = false;
  let saveTimer = null;
  let saveInFlight = null;
  let serverAvailable = true;
  let syncOptions = null;
  let pollTimer = null;
  let pollInFlight = false;

  // ---------------------------------------------------------------- utils

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function stableStringify(value) {
    if (value === undefined) return 'undefined';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort().filter(function (k) {
      return value[k] !== undefined;
    }).map(function (k) {
      return JSON.stringify(k) + ':' + stableStringify(value[k]);
    }).join(',') + '}';
  }

  function same(a, b) {
    return stableStringify(a) === stableStringify(b);
  }

  function normalize(board) {
    const Schema = window.SoundboardSchema;
    return Schema ? Schema.normalizeBoard(board) : board;
  }

  function setServerStatus(text) {
    const el = document.getElementById('status-line');
    if (el) el.textContent = text || '';
  }

  // ------------------------------------------------------------ IndexedDB

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = function () { reject(req.error); };
      req.onsuccess = function () { resolve(req.result); };
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
    });
    return dbPromise;
  }

  function tx(store, mode) {
    return openDb().then(function (db) {
      return db.transaction(store, mode).objectStore(store);
    });
  }

  function idbGet(store, key) {
    return tx(store, 'readonly').then(function (s) {
      return new Promise(function (resolve, reject) {
        const req = s.get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbPut(store, key, value) {
    return tx(store, 'readwrite').then(function (s) {
      return new Promise(function (resolve, reject) {
        const req = s.put(value, key);
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /** Offline copy of the last known board (cache only). */
  function cacheBoardLocally(board) {
    return idbPut('meta', META_KEY, {
      board: board,
      serverUpdatedAt: serverUpdatedAt
    }).catch(function () { return null; });
  }

  function readLocalCache() {
    return idbGet('meta', META_KEY).then(function (v) {
      if (!v) return null;
      // Older versions stored the bare board.
      if (v.sounds) return { board: v, serverUpdatedAt: null };
      return v.board ? v : null;
    }).catch(function () { return null; });
  }

  function putBlob(key, arrayBuffer, mime) {
    return idbPut('blobs', String(key), { bytes: arrayBuffer, mime: mime || 'application/octet-stream' });
  }

  function getBlobRecord(key) {
    return idbGet('blobs', String(key)).catch(function () { return null; });
  }

  function getBlob(key) {
    return getBlobRecord(key).then(function (v) { return v && v.bytes ? v.bytes : null; });
  }

  function deleteBlob(key) {
    return tx('blobs', 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        const req = store.delete(String(key));
        req.onsuccess = function () { resolve(true); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  /** Clears this browser's cache only. The shared board is untouched. */
  function clearAll() {
    return openDb().then(function (db) {
      return Promise.all(['meta', 'blobs'].map(function (name) {
        return new Promise(function (resolve, reject) {
          const t = db.transaction(name, 'readwrite');
          t.objectStore(name).clear();
          t.oncomplete = function () { resolve(); };
          t.onerror = function () { reject(t.error); };
        });
      }));
    }).then(function () {
      liveBoard = null;
      baseBoard = null;
      serverUpdatedAt = null;
      dirty = false;
    });
  }

  // ----------------------------------------------------------------- media

  function parseMediaRef(ref) {
    const m = String(ref || '').match(/^media:([a-f0-9]{64})$/);
    return m ? m[1] : null;
  }

  function mediaUrl(hash) {
    return MEDIA_API_PATH + '/' + hash;
  }

  function guessMime(kind, mime) {
    const m = String(mime || '').toLowerCase();
    if (/^(audio|image)\//.test(m) && m.indexOf('svg') === -1) return m;
    return kind === 'image' ? 'image/jpeg' : 'audio/mpeg';
  }

  /**
   * Upload bytes to shared storage. Resolves to a `media:<sha256>` ref that
   * works on every computer. Also keeps a cached copy in this browser.
   */
  function uploadMedia(arrayBuffer, mime, kind) {
    const type = guessMime(kind, mime);
    return fetch(MEDIA_API_PATH, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': type },
      body: arrayBuffer
    }).then(function (res) {
      if (res.status === 401) {
        const err = new Error('Your sign-in has expired — reload the page to sign in again.');
        err.code = 'auth';
        throw err;
      }
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok || !body || !body.ref) {
          throw new Error((body && body.error) || 'Upload failed');
        }
        return putBlob('media:' + body.hash, arrayBuffer, type)
          .catch(function () { return null; })
          .then(function () { return body.ref; });
      });
    });
  }

  /** Bytes for a `media:` hash — from this browser's cache, else the server. */
  function getMediaBytes(hash) {
    return getBlob('media:' + hash).then(function (cached) {
      if (cached) return cached;
      return fetch(mediaUrl(hash), { credentials: 'same-origin' }).then(function (res) {
        if (!res.ok) throw new Error('media fetch failed (' + res.status + ')');
        const type = res.headers.get('Content-Type') || '';
        return res.arrayBuffer().then(function (ab) {
          putBlob('media:' + hash, ab, type).catch(function () { return null; });
          return ab;
        });
      });
    });
  }

  // --------------------------------------------------------------- merging

  function soundMap(board) {
    const map = new Map();
    ((board && board.sounds) || []).forEach(function (s) {
      if (s && s.id != null) map.set(String(s.id), s);
    });
    return map;
  }

  function idsOf(board) {
    return ((board && board.sounds) || []).map(function (s) { return String(s.id); });
  }

  /** Pick a field: our edit if we changed it since base, otherwise theirs. */
  function pick(baseVal, localVal, remoteVal) {
    if (!same(localVal, baseVal)) return clone(localVal);
    return clone(remoteVal);
  }

  /**
   * Three-way merge of whole boards.
   * - Sounds merge by id: a sound we edited keeps our version, otherwise the
   *   server's. Sounds added on either side are kept. A deletion wins unless
   *   the other side edited that same sound.
   * - Other board fields (name, category order, favourites…) merge the same
   *   way, one field at a time.
   */
  function mergeBoards(base, local, remote) {
    const b = base || { sounds: [] };
    const l = local || { sounds: [] };
    const r = remote || { sounds: [] };
    const bm = soundMap(b);
    const lm = soundMap(l);
    const rm = soundMap(r);

    const keep = new Map();
    rm.forEach(function (remoteSound, id) {
      const baseSound = bm.get(id);
      const localSound = lm.get(id);
      if (!localSound) {
        // We deleted it (it was in base) — honour that unless they edited it.
        if (baseSound && same(remoteSound, baseSound)) return;
        keep.set(id, clone(remoteSound));
        return;
      }
      keep.set(id, baseSound && same(localSound, baseSound) ? clone(remoteSound) : clone(localSound));
    });
    lm.forEach(function (localSound, id) {
      if (keep.has(id) || rm.has(id)) return;
      const baseSound = bm.get(id);
      // New on our side, or they deleted it but we edited it: keep ours.
      if (!baseSound || !same(localSound, baseSound)) keep.set(id, clone(localSound));
    });

    // Order: follow whichever side reordered; new local sounds slot in after
    // the sound they followed locally.
    const baseIds = idsOf(b);
    const localIds = idsOf(l);
    const remoteIds = idsOf(r);
    const localReordered = !same(localIds.filter(function (id) { return bm.has(id); }), baseIds.filter(function (id) { return lm.has(id); }));
    const remoteReordered = !same(remoteIds.filter(function (id) { return bm.has(id); }), baseIds.filter(function (id) { return rm.has(id); }));
    const primary = localReordered && !remoteReordered ? localIds : remoteIds;
    const order = primary.filter(function (id) { return keep.has(id); });
    const placed = new Set(order);
    const secondary = primary === localIds ? remoteIds : localIds;
    secondary.forEach(function (id, idx) {
      if (!keep.has(id) || placed.has(id)) return;
      let insertAt = order.length;
      for (let i = idx - 1; i >= 0; i--) {
        const at = order.indexOf(secondary[i]);
        if (at !== -1) { insertAt = at + 1; break; }
      }
      order.splice(insertAt, 0, id);
      placed.add(id);
    });
    keep.forEach(function (_, id) { if (!placed.has(id)) order.push(id); });

    const merged = {};
    const keys = new Set(Object.keys(b).concat(Object.keys(l), Object.keys(r)));
    keys.forEach(function (k) {
      if (k === 'sounds' || k === 'updatedAt' || k === 'layout') return;
      const v = pick(b[k], l[k], r[k]);
      if (v !== undefined) merged[k] = v;
    });
    const bl = b.layout || {};
    const ll = l.layout || {};
    const rl = r.layout || {};
    const layout = {};
    new Set(Object.keys(bl).concat(Object.keys(ll), Object.keys(rl))).forEach(function (k) {
      if (k === 'quickAccess') return;
      const v = pick(bl[k], ll[k], rl[k]);
      if (v !== undefined) layout[k] = v;
    });
    const bq = bl.quickAccess || {};
    const lq = ll.quickAccess || {};
    const rq = rl.quickAccess || {};
    layout.quickAccess = {
      favourites: pick(bq.favourites, lq.favourites, rq.favourites) || [],
      recents: []
    };
    merged.layout = layout;
    merged.sounds = order.map(function (id) { return keep.get(id); });
    merged.updatedAt = r.updatedAt || l.updatedAt || null;
    return merged;
  }

  // ------------------------------------------------------------- board API

  function getBoard() {
    return liveBoard;
  }

  function setBoard(board, options) {
    liveBoard = normalize(board);
    const opts = options || {};
    if (opts.markDirty !== false) dirty = true;
    if (opts.save !== false) scheduleSave();
    return liveBoard;
  }

  function hasUnsavedChanges() {
    return dirty || !!saveTimer || !!saveInFlight;
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Shape sent to the server: recents are per-computer and never shared. */
  function boardForServer(board) {
    const copy = clone(normalize(board));
    if (copy.layout && copy.layout.quickAccess) copy.layout.quickAccess.recents = [];
    delete copy.updatedAt;
    return copy;
  }

  function putToServer(board, baseUpdatedAt) {
    return fetch(API_PATH, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: board, baseUpdatedAt: baseUpdatedAt || null })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (res.status === 401) {
          const err = new Error('not signed in');
          err.code = 'auth';
          throw err;
        }
        if (res.status === 409) {
          const err = new Error('conflict');
          err.code = 'conflict';
          err.remote = body;
          throw err;
        }
        if (!res.ok) {
          throw new Error((body && body.error) || 'save failed');
        }
        return body;
      });
    });
  }

  function notifyRemote(reason) {
    if (syncOptions && typeof syncOptions.onRemoteBoard === 'function') {
      try { syncOptions.onRemoteBoard(liveBoard, reason); } catch (e) { console.warn(e); }
    }
  }

  function saveNow() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (saveInFlight) {
      // Another save is running; save again once it finishes.
      return saveInFlight.then(function () { return dirty ? saveNow() : undefined; });
    }
    if (!liveBoard) return Promise.resolve();
    dirty = false;
    saveInFlight = attemptSave(0).finally(function () {
      saveInFlight = null;
      if (dirty) scheduleSave();
    });
    return saveInFlight;
  }

  function attemptSave(attempt) {
    const outgoing = boardForServer(liveBoard);
    if (serverUpdatedAt && baseBoard && same(outgoing, baseBoard)) {
      // Nothing that other computers see has changed — skip the write.
      return Promise.resolve();
    }
    return putToServer(outgoing, serverUpdatedAt).then(function (res) {
      serverAvailable = true;
      serverUpdatedAt = res.updatedAt || serverUpdatedAt;
      baseBoard = outgoing;
      if (liveBoard) liveBoard.updatedAt = serverUpdatedAt;
      cacheBoardLocally(liveBoard);
      setServerStatus('Saved — all computers will see this.');
    }).catch(function (err) {
      if (err && err.code === 'conflict' && err.remote && attempt < MAX_CONFLICT_RETRIES) {
        const remoteBoard = err.remote.board ? normalize(err.remote.board) : { schemaVersion: 2, sounds: [] };
        const recents = liveBoard && liveBoard.layout && liveBoard.layout.quickAccess
          ? liveBoard.layout.quickAccess.recents : [];
        liveBoard = normalize(mergeBoards(baseBoard, boardForServer(liveBoard), remoteBoard));
        if (liveBoard.layout && liveBoard.layout.quickAccess) liveBoard.layout.quickAccess.recents = recents || [];
        baseBoard = boardForServer(remoteBoard);
        serverUpdatedAt = err.remote.updatedAt || null;
        notifyRemote('merged');
        return attemptSave(attempt + 1);
      }
      if (err && err.code === 'auth') {
        serverAvailable = false;
        dirty = true;
        cacheBoardLocally(liveBoard);
        setServerStatus('Your sign-in has expired — reload the page to sign in again. Your changes are kept on this computer until then.');
        return;
      }
      dirty = true;
      cacheBoardLocally(liveBoard);
      setServerStatus('Could not save to the server — will retry.');
      console.warn('soundboard server save failed', err);
    });
  }

  function loadFromServer(since) {
    const url = since ? API_PATH + '?since=' + encodeURIComponent(since) : API_PATH;
    return fetch(url, { credentials: 'same-origin', cache: 'no-store' }).then(function (res) {
      if (res.status === 401) return { unauthorized: true };
      if (!res.ok) throw new Error('soundboard load failed');
      return res.json();
    });
  }

  function loadDefaultBoardJson() {
    return fetch(DEFAULT_BOARD_URL, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('default board fetch failed');
        return res.json();
      });
  }

  function adoptServerBoard(board, updatedAt) {
    const recents = liveBoard && liveBoard.layout && liveBoard.layout.quickAccess
      ? liveBoard.layout.quickAccess.recents : null;
    liveBoard = normalize(board);
    if (recents && liveBoard.layout && liveBoard.layout.quickAccess) {
      liveBoard.layout.quickAccess.recents = recents;
    }
    liveBoard.updatedAt = updatedAt || null;
    baseBoard = boardForServer(board);
    serverUpdatedAt = updatedAt || null;
    dirty = false;
    serverAvailable = true;
    cacheBoardLocally(liveBoard);
    return liveBoard;
  }

  function loadDefaultBoard() {
    return loadDefaultBoardJson().then(function (data) {
      liveBoard = normalize(data);
      dirty = true;
      return saveNow().then(function () { return { board: liveBoard, source: 'default' }; });
    });
  }

  function loadInitial() {
    return loadFromServer().then(function (remote) {
      if (remote && remote.board && Array.isArray(remote.board.sounds)) {
        adoptServerBoard(remote.board, remote.updatedAt);
        return { board: liveBoard, source: 'server' };
      }
      if (remote && remote.unauthorized) {
        // Not signed in: go to the team-password page, then come back.
        window.location.href = LOGIN_URL;
        serverAvailable = false;
        return readLocalCache().then(function (cached) {
          if (cached && cached.board && cached.board.sounds && cached.board.sounds.length) {
            liveBoard = normalize(cached.board);
            return { board: liveBoard, source: 'offline copy (not signed in)' };
          }
          return loadDefaultBoardJson().then(function (data) {
            liveBoard = normalize(data);
            return { board: liveBoard, source: 'default (not signed in)' };
          });
        });
      }
      // Signed in, but nobody has saved a board yet.
      return loadDefaultBoard();
    }).catch(function () {
      serverAvailable = false;
      return readLocalCache().then(function (cached) {
        if (cached && cached.board && cached.board.sounds && cached.board.sounds.length) {
          liveBoard = normalize(cached.board);
          baseBoard = boardForServer(cached.board);
          serverUpdatedAt = cached.serverUpdatedAt || null;
          return { board: liveBoard, source: 'offline copy' };
        }
        return loadDefaultBoardJson().then(function (data) {
          liveBoard = normalize(data);
          return { board: liveBoard, source: 'default (offline)' };
        });
      });
    });
  }

  // --------------------------------------------------------------- polling

  /** Check the server for changes made on other computers. */
  function pollOnce() {
    if (pollInFlight || !liveBoard) return Promise.resolve(false);
    if (syncOptions && typeof syncOptions.isBusy === 'function' && syncOptions.isBusy()) {
      return Promise.resolve(false);
    }
    if (saveInFlight || saveTimer) return Promise.resolve(false);
    pollInFlight = true;
    return loadFromServer(serverAvailable ? serverUpdatedAt : null).then(function (remote) {
      if (!remote || remote.unauthorized || remote.unchanged) return false;
      if (!remote.board || !Array.isArray(remote.board.sounds)) return false;
      if (remote.updatedAt && remote.updatedAt === serverUpdatedAt) return false;
      // Something changed while the request was out — let the save path merge.
      if (saveInFlight || saveTimer) return false;
      if (dirty && baseBoard) {
        const recents = liveBoard.layout && liveBoard.layout.quickAccess ? liveBoard.layout.quickAccess.recents : [];
        const merged = mergeBoards(baseBoard, boardForServer(liveBoard), normalize(remote.board));
        adoptServerBoard(remote.board, remote.updatedAt);
        liveBoard = normalize(merged);
        if (liveBoard.layout && liveBoard.layout.quickAccess) liveBoard.layout.quickAccess.recents = recents || [];
        dirty = true;
        scheduleSave();
      } else {
        adoptServerBoard(remote.board, remote.updatedAt);
      }
      notifyRemote('remote-change');
      return true;
    }).catch(function () {
      return false;
    }).finally(function () {
      pollInFlight = false;
    });
  }

  /**
   * Keep this page in step with other computers.
   * options.onRemoteBoard(board) — called after a newer board was adopted/merged.
   * options.isBusy() — return true to postpone (e.g. while an editor is open).
   */
  function startSync(options) {
    syncOptions = options || {};
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (document.visibilityState === 'visible') pollOnce();
    }, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') pollOnce();
    });
    window.addEventListener('focus', function () { pollOnce(); });
  }

  // ------------------------------------------- legacy browser-only refs

  function blobKeyForSound(soundId, kind) {
    return kind + ':' + String(soundId);
  }

  function parseBlobRef(ref) {
    const m = String(ref || '').match(/^blob:(audio|image):(.+)$/);
    if (!m) return null;
    return { kind: m[1], soundId: m[2], key: m[1] + ':' + m[2] };
  }

  /**
   * Older versions pointed shared sounds at files saved only in one browser
   * (`blob:audio:<id>`). Fix them: upload the file if this browser has it,
   * otherwise fall back to the original source from the default board.
   * Returns { fixed, missing, changed }.
   */
  async function repairBrowserOnlyRefs(board, options) {
    const opts = options || {};
    // Work on a snapshot; uploads take a while and the live board can be
    // replaced meanwhile. Fixes are applied to the live board at the end.
    const sounds = clone((board && board.sounds) || []);
    const legacy = sounds.filter(function (s) {
      return parseBlobRef(s.audioRef) || parseBlobRef(s.imageRef);
    });
    if (!legacy.length) return { fixed: 0, missing: 0, changed: false };

    let defaults = null;
    try {
      defaults = soundMap(normalize(await loadDefaultBoardJson()));
    } catch (_) {
      defaults = new Map();
    }

    let fixed = 0;
    let missing = 0;
    const fixes = [];
    let uploadsBlocked = !serverAvailable;
    for (let i = 0; i < legacy.length; i++) {
      const s = legacy[i];
      if (opts.onProgress) opts.onProgress(i + 1, legacy.length);
      const fallback = defaults.get(String(s.id));
      for (const field of ['audioRef', 'imageRef']) {
        const parsed = parseBlobRef(s[field]);
        if (!parsed) continue;
        let newRef = null;
        if (!uploadsBlocked) {
          const rec = await getBlobRecord(parsed.key);
          if (rec && rec.bytes) {
            try {
              newRef = await uploadMedia(rec.bytes, rec.mime, parsed.kind);
            } catch (e) {
              if (e && e.code === 'auth') uploadsBlocked = true;
              console.warn('soundboard: upload during repair failed', s.id, e);
            }
          }
        }
        if (!newRef && fallback && fallback[field] && !parseBlobRef(fallback[field])) {
          newRef = fallback[field];
        }
        if (newRef) {
          fixes.push({ id: String(s.id), field: field, from: s[field], to: newRef });
        } else if (field === 'audioRef') {
          missing++;
        }
      }
    }
    // Apply to the board as it is now, only where nobody changed that ref meanwhile.
    const current = soundMap(liveBoard);
    fixes.forEach(function (f) {
      const cs = current.get(f.id);
      if (cs && cs[f.field] === f.from) {
        cs[f.field] = f.to;
        fixed++;
      }
    });
    return { fixed: fixed, missing: missing, changed: fixed > 0 };
  }

  window.SoundboardRepository = {
    openDb,
    getBoard,
    setBoard,
    scheduleSave,
    saveNow,
    hasUnsavedChanges,
    loadInitial,
    loadDefaultBoard,
    startSync,
    pollOnce,
    putBlob,
    getBlob,
    deleteBlob,
    clearAll,
    uploadMedia,
    getMediaBytes,
    parseMediaRef,
    mediaUrl,
    repairBrowserOnlyRefs,
    mergeBoards,
    blobKeyForSound,
    parseBlobRef
  };
})();
