/**
 * import-service.js — Import JSON/ZIP with merge or replace.
 */
(function () {
  function guessMime(path, fallback) {
    const lower = String(path || '').toLowerCase();
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    return fallback || 'application/octet-stream';
  }

  function readFileText(file) {
    return file.text ? file.text() : new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file);
    });
  }

  function readFileArrayBuffer(file) {
    return file.arrayBuffer ? file.arrayBuffer() : new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(file);
    });
  }

  /**
   * Put a file in shared storage so every computer can play it.
   * Only if the upload is impossible (offline / signed out) does it fall back
   * to a copy kept in this browser — repairBrowserOnlyRefs uploads it later.
   */
  async function storeBlobForSound(soundId, kind, arrayBuffer, mime) {
    const Repo = window.SoundboardRepository;
    try {
      return await Repo.uploadMedia(arrayBuffer, mime, kind);
    } catch (e) {
      console.warn('import: shared upload failed, keeping a local copy for now', soundId, e);
    }
    const key = Repo.blobKeyForSound(soundId, kind);
    await Repo.putBlob(key, arrayBuffer, mime);
    return 'blob:' + kind + ':' + soundId;
  }

  async function hydrateRemoteAudio(board, options) {
    const opts = options || {};
    const limit = opts.limit != null ? opts.limit : (board.sounds || []).length;
    const Repo = window.SoundboardRepository;
    const Media = window.SoundboardMediaResolver;
    let hydrated = 0;
    const sounds = board.sounds || [];
    for (let i = 0; i < Math.min(sounds.length, limit); i++) {
      const s = sounds[i];
      const ref = String(s.audioRef || '');
      if (!ref || ref.startsWith('blob:') || ref.startsWith('media:')) continue;
      if (opts.onProgress) opts.onProgress('Hydrating ' + (i + 1) + '/' + Math.min(sounds.length, limit));
      try {
        let ab = null;
        if (Media && Media.fetchAudioArrayBuffer) {
          const play = window.SoundboardSchema.soundForPlayback(s);
          const result = await Media.fetchAudioArrayBuffer(play);
          if (result && result.arrayBuffer) ab = result.arrayBuffer;
        } else if (/^https?:/i.test(ref) || ref.startsWith('/')) {
          const res = await fetch(ref.startsWith('/') ? ref : ref);
          if (res.ok) ab = await res.arrayBuffer();
        }
        if (ab) {
          s.audioRef = await storeBlobForSound(s.id, 'audio', ab, 'audio/mpeg');
          hydrated++;
        }
      } catch (e) {
        console.warn('import: hydrate failed', s.id, e);
      }
    }
    return { hydrated };
  }

  async function parsePortableZip(file, options) {
    if (!window.JSZip) return { ok: false, error: 'no-jszip' };
    const Schema = window.SoundboardSchema;
    const Merge = window.SoundboardMergeEngine;
    const opts = options || {};
    const buf = await readFileArrayBuffer(file);
    const zip = await window.JSZip.loadAsync(buf);
    const boardFile = zip.file('board.json');
    if (!boardFile) return { ok: false, error: 'missing-board-json' };

    const parsed = JSON.parse(await boardFile.async('text'));
    const validation = Schema.validateBoard(parsed);
    if (!validation.ok) return { ok: false, error: 'invalid-board', detail: validation.error };

    let board = Schema.normalizeBoard(parsed);
    const warnings = [];
    const current = opts.currentBoard || window.SoundboardRepository.getBoard();
    const mode = opts.mode || 'replace';
    const newIds = mode === 'merge' && current
      ? Merge.getNewIncomingSoundIds(current, board)
      : null;

    for (const s of board.sounds) {
      const isNew = !newIds || newIds.has(String(s.id));
      const ref = String(s.audioRef || '');
      const zipAudio = ref.startsWith('zip:') ? ref.slice(4) : (ref.startsWith('audio/') ? ref : '');
      if (zipAudio || (isNew && ref.startsWith('zip:'))) {
        const path = ref.startsWith('zip:') ? ref.slice(4) : zipAudio;
        const zf = zip.file(path);
        if (zf) {
          const ab = await zf.async('arraybuffer');
          s.audioRef = await storeBlobForSound(s.id, 'audio', ab, guessMime(path, 'audio/mpeg'));
        } else {
          warnings.push('Missing audio: ' + path);
        }
      }

      const iu = String(s.imageRef || '');
      if (iu.startsWith('zip:') || (isNew && iu.startsWith('images/'))) {
        const path = iu.startsWith('zip:') ? iu.slice(4) : iu;
        const zf = zip.file(path);
        if (zf) {
          const ab = await zf.async('arraybuffer');
          s.imageRef = await storeBlobForSound(s.id, 'image', ab, guessMime(path, 'image/jpeg'));
        }
      }
    }

    return { ok: true, board, warnings };
  }

  async function importFile(file, options) {
    const Schema = window.SoundboardSchema;
    const Merge = window.SoundboardMergeEngine;
    const Repo = window.SoundboardRepository;
    const opts = options || {};
    const mode = opts.mode || 'merge';

    if (!file) return { ok: false, error: 'no-file' };

    const isZip = /\.zip$/i.test(file.name || '') || String(file.type || '').includes('zip');
    if (isZip) {
      const parsed = await parsePortableZip(file, { mode, currentBoard: Repo.getBoard() });
      if (!parsed.ok) return parsed;
      let boardToSet = parsed.board;
      let mergeStats = null;
      if (mode === 'merge' && Repo.getBoard()) {
        const merged = Merge.mergeBoards(Repo.getBoard(), parsed.board);
        boardToSet = merged.board;
        mergeStats = merged.stats;
      }
      Repo.setBoard(boardToSet, { save: true });
      await Repo.saveNow();
      return { ok: true, board: boardToSet, mergeStats, warnings: parsed.warnings || [] };
    }

    let data;
    try {
      data = JSON.parse(await readFileText(file));
    } catch (_) {
      return { ok: false, error: 'invalid-json' };
    }

    const validation = Schema.validateBoard(data);
    if (!validation.ok) return { ok: false, error: 'invalid-board', detail: validation.error };

    let board = Schema.normalizeBoard(data);
    if (opts.hydrateRemote) {
      await hydrateRemoteAudio(board, { onProgress: opts.onProgress });
    }

    let mergeStats = null;
    if (mode === 'merge' && Repo.getBoard()) {
      const merged = Merge.mergeBoards(Repo.getBoard(), board);
      board = merged.board;
      mergeStats = merged.stats;
    }

    Repo.setBoard(board, { save: true });
    await Repo.saveNow();
    return { ok: true, board, mergeStats, warnings: [] };
  }

  window.SoundboardImportService = {
    importFile,
    parsePortableZip,
    hydrateRemoteAudio
  };
})();
