/**
 * soundboard.js — Entry: wire board-manager, audio-engine, ui-renderer, storage.
 * Load board (JSON or localStorage), render grid, handle play/edit/import/export.
 */

(function () {
  const Storage = window.SoundboardStorage;
  const Audio = window.SoundboardAudio;
  const Board = window.SoundboardBoardManager;
  const UI = window.SoundboardUIRenderer;

  let currentBoard = null;
  let playingId = null;
  let errorIds = new Set();
  let reorderMode = false;
  const hotkeyMap = new Map();

  const gridEl = document.getElementById('sound-grid');
  const toolbarEl = document.getElementById('toolbar');
  const importInput = document.getElementById('import-input');
  const modalEl = document.getElementById('modal');
  const modalForm = document.getElementById('modal-form');
  const modalError = document.getElementById('modal-error');
  const boardNameEl = document.getElementById('board-name');
  const downloadStatus = document.getElementById('download-status');
  const globalVolumeEl = document.getElementById('global-volume');
  const globalVolumeLabel = document.getElementById('global-volume-label');
  const durationHint = document.getElementById('duration-hint');
  const searchInputEl = document.getElementById('search-input');
  const searchClearEl = document.getElementById('search-clear');
  const searchCountEl = document.getElementById('search-count');
  const autoLevelToggleEl = document.getElementById('auto-level-toggle');
  const quickBarEl = document.getElementById('quick-bar');

  function getBoardJsonPath() {
    const base = window.location.pathname.replace(/\/[^/]*$/, '') || '/';
    return base + (base.endsWith('/') ? '' : '/') + 'boards/sample-board.json';
  }

  const CATEGORY_UI_KEY_PREFIX = 'soundboard-category-state:';
  const AUTO_LEVEL_KEY = 'soundboard-auto-level';
  let searchQuery = '';
  let categoryUiState = {};

  function getCategoryStorageKey() {
    const boardId = currentBoard && currentBoard.id ? String(currentBoard.id) : 'default';
    return CATEGORY_UI_KEY_PREFIX + boardId;
  }

  function loadCategoryUiState() {
    try {
      const raw = localStorage.getItem(getCategoryStorageKey());
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveCategoryUiState() {
    try {
      localStorage.setItem(getCategoryStorageKey(), JSON.stringify(categoryUiState || {}));
    } catch (_) {}
  }

  function normalizeCategoryKey(category) {
    const raw = (category || '').trim();
    return raw ? raw : 'Uncategorized';
  }

  function soundMatchesQuery(sound, q) {
    if (!q) return true;
    const title = (sound && sound.title ? String(sound.title) : '').toLowerCase();
    const cat = (sound && sound.category ? String(sound.category) : '').toLowerCase();
    return title.includes(q) || cat.includes(q);
  }

  function getFilteredSounds() {
    const sounds = currentBoard && Array.isArray(currentBoard.sounds) ? currentBoard.sounds : [];
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return sounds.slice();
    return sounds.filter((s) => soundMatchesQuery(s, q));
  }

  function buildGroups(sounds) {
    const map = new Map();
    (Array.isArray(sounds) ? sounds : []).forEach((s) => {
      const key = normalizeCategoryKey(s && s.category);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    });

    const keys = Array.from(map.keys());
    keys.sort((a, b) => {
      if (a === 'Uncategorized' && b !== 'Uncategorized') return -1;
      if (b === 'Uncategorized' && a !== 'Uncategorized') return 1;
      return a.localeCompare(b);
    });

    return keys.map((k) => ({ key: k, label: k, sounds: map.get(k) }));
  }

  function updateSearchCount(count, total) {
    if (!searchCountEl) return;
    const q = (searchQuery || '').trim();
    if (!q) {
      searchCountEl.textContent = '';
      return;
    }
    searchCountEl.textContent = String(count) + '/' + String(total);
  }

  function loadInitialBoard() {
    const saved = Storage && Storage.loadBoard();
    if (saved && Board.validateBoard(saved).ok) {
      setBoard(Board.normalizeBoard(saved));
      return;
    }
    const url = getBoardJsonPath();
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load board'))))
      .then((data) => {
        const result = Board.validateBoard(data);
        if (!result.ok) throw new Error(result.error);
        setBoard(Board.normalizeBoard(data));
      })
      .catch((err) => {
        console.warn('soundboard: load board failed', err);
        setBoard({
          schemaVersion: 1,
          id: 'default',
          name: 'My Soundboard',
          description: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sounds: []
        });
      });
  }

  function setBoard(board) {
    currentBoard = board;
    if (boardNameEl) {
      boardNameEl.textContent = board.name || 'Soundboard';
      boardNameEl.title = 'Click to change board name';
    }
    categoryUiState = loadCategoryUiState();
    buildHotkeyMap();
    render();
    initBoardTitle();
    if (Audio && board.sounds && board.sounds.length) {
      Audio.preloadSounds(board.sounds);
    }
  }

  function buildHotkeyMap() {
    hotkeyMap.clear();
    if (!currentBoard || !currentBoard.sounds) return;
    currentBoard.sounds.forEach((s) => {
      const key = (s.hotkey || '').trim().toUpperCase();
      if (key) hotkeyMap.set(key, s);
    });
  }

  function render() {
    if (!UI || !gridEl) return;
    const allSounds = currentBoard ? currentBoard.sounds : [];
    const filtered = getFilteredSounds();
    updateSearchCount(filtered.length, Array.isArray(allSounds) ? allSounds.length : 0);

    if (!Array.isArray(allSounds) || allSounds.length === 0) {
      UI.renderGrid(gridEl, [], playingId, errorIds, onPlay, onEditSound, reorderMode, reorderSounds);
      updateReorderButton();
      return;
    }

    if (reorderMode) {
      UI.renderGrid(gridEl, filtered, playingId, errorIds, onPlay, onEditSound, reorderMode, reorderSounds);
    } else if (UI.renderGroupedGrid) {
      const groups = buildGroups(filtered);
      UI.renderGroupedGrid(
        gridEl,
        groups,
        playingId,
        errorIds,
        onPlay,
        onEditSound,
        false,
        null,
        {
          isCollapsed: (key) => categoryUiState && categoryUiState[String(key)] === false,
          onToggleCategory: (key) => {
            const k = String(key);
            const current = categoryUiState && Object.prototype.hasOwnProperty.call(categoryUiState, k) ? categoryUiState[k] : true;
            categoryUiState[k] = !current;
            saveCategoryUiState();
            render();
          }
        }
      );
    } else {
      UI.renderGrid(gridEl, filtered, playingId, errorIds, onPlay, onEditSound, false, null);
    }
    updateReorderButton();
  }

  function reorderSounds(fromIndex, toIndex) {
    if (!currentBoard || !currentBoard.sounds) return;
    const arr = currentBoard.sounds;
    if (fromIndex < 0 || fromIndex >= arr.length || toIndex < 0 || toIndex >= arr.length || fromIndex === toIndex) return;
    const item = arr.splice(fromIndex, 1)[0];
    arr.splice(toIndex, 0, item);
    saveToStorage();
    render();
  }

  function setReorderMode(active) {
    reorderMode = !!active;
    render();
  }

  function updateReorderButton() {
    const btn = toolbarEl && toolbarEl.querySelector('[data-action="reorder-toggle"]');
    const quickBtn = quickBarEl && quickBarEl.querySelector('[data-action="quick-reorder"]');
    if (btn) {
      btn.classList.toggle('btn--active', reorderMode);
      btn.setAttribute('aria-pressed', reorderMode ? 'true' : 'false');
    }
    if (quickBtn) {
      quickBtn.classList.toggle('btn--active', reorderMode);
      quickBtn.setAttribute('aria-pressed', reorderMode ? 'true' : 'false');
    }
  }

  function onPlay(sound) {
    if (!sound || !Audio) return;
    if (playingId === sound.id) {
      if (Audio.stopSound) Audio.stopSound();
      playingId = null;
      render();
      return;
    }

    // Background analysis for auto-leveling: compute and persist per-sound gain without delaying playback.
    if (Audio.getAutoLevelEnabled && Audio.getAutoLevelEnabled() && Audio.analyzeFileUrl && sound.fileUrl) {
      const has = sound.extra && typeof sound.extra.normGain === 'number' && isFinite(sound.extra.normGain);
      if (!has) {
        if (!sound.extra || typeof sound.extra !== 'object') sound.extra = {};
        Audio.analyzeFileUrl(sound.fileUrl).then(function (res) {
          if (res && typeof res.gain === 'number' && isFinite(res.gain)) {
            sound.extra.normGain = res.gain;
            sound.extra.normAnalyzedAt = new Date().toISOString();
            sound.extra.normAlgoVersion = res.algoVersion || 1;
            saveToStorage();
          }
        }).catch(function () {});
      }
    }

    if (Audio.stopSound) Audio.stopSound();
    playingId = null;
    render();
    playingId = sound.id;
    render();
    Audio.playSound(sound).then((played) => {
      if (!played) {
        errorIds.add(sound.id);
        if (UI && gridEl) UI.updateTileState(gridEl, sound.id, 'error');
      }
      if (playingId === sound.id) {
        playingId = null;
        if (UI && gridEl) UI.updateTileState(gridEl, sound.id, 'idle');
      }
      render();
    });
  }

  function onEditSound(sound) {
    if (!modalEl || !modalForm) return;
    openModal(sound);
  }

  function saveToStorage() {
    if (currentBoard && Storage) {
      currentBoard.updatedAt = new Date().toISOString();
      Storage.saveBoard(currentBoard);
    }
  }

  function addSound() {
    const s = Board.createDefaultSound();
    currentBoard.sounds.push(s);
    saveToStorage();
    openModal(s);
    render();
  }

  function deleteSound(sound) {
    if (!currentBoard || !sound) return;
    currentBoard.sounds = currentBoard.sounds.filter((s) => s.id !== sound.id);
    errorIds.delete(sound.id);
    saveToStorage();
    closeModal();
    render();
  }

  function openModal(sound) {
    if (!modalEl || !modalForm) return;
    modalEl.dataset.soundId = sound ? sound.id : '';
    const uploadInput = document.getElementById('upload-audio-input');
    const uploadedHint = document.getElementById('uploaded-audio-hint');
    if (uploadInput) uploadInput.value = '';
    if (modalForm.dataset) delete modalForm.dataset.pendingBlobId;
    if (uploadedHint) uploadedHint.textContent = '';
    if (modalForm) {
      const isLocal = sound && sound.fileUrl && String(sound.fileUrl).startsWith('local:');
      modalForm.querySelector('[name="title"]').value = sound ? sound.title : '';
      modalForm.querySelector('[name="fileUrl"]').value = isLocal ? '' : (sound ? sound.fileUrl : '');
      if (isLocal && uploadedHint) uploadedHint.textContent = 'Audio: your uploaded file (saved)';
      modalForm.querySelector('[name="imageUrl"]').value = sound ? sound.imageUrl || '' : '';
      modalForm.querySelector('[name="category"]').value = sound ? sound.category || '' : '';
      modalForm.querySelector('[name="hotkey"]').value = sound ? sound.hotkey || '' : '';
      const volPct = sound ? Math.round((sound.volume != null ? sound.volume : 1) * 100) : 100;
      modalForm.querySelector('[name="volume"]').value = String(volPct);
      const speed = sound && sound.playbackRate != null ? sound.playbackRate : 1;
      modalForm.querySelector('[name="playbackRate"]').value = String(Math.max(0.5, Math.min(2, speed)));
      updateSpeedValue(parseFloat(modalForm.querySelector('[name="playbackRate"]').value));
      const loopCheck = modalForm.querySelector('[name="loop"]');
      if (loopCheck) loopCheck.checked = !!(sound && sound.loop);
      const startSec = sound && sound.startMs != null ? sound.startMs / 1000 : '';
      const endSec = sound && sound.endMs != null ? sound.endMs / 1000 : '';
      modalForm.querySelector('[name="startSec"]').value = startSec === '' ? '' : String(Number(startSec.toFixed(2)));
      modalForm.querySelector('[name="endSec"]').value = endSec === '' ? '' : String(Number(endSec.toFixed(2)));
      updateVolumePercent(volPct);
    }
    if (durationHint) durationHint.textContent = '';
    if (sound && sound.fileUrl && Audio && Audio.getDurationSeconds) {
      const sec = Audio.getDurationSeconds(sound.fileUrl);
      if (sec != null) durationHint.textContent = 'Duration: ' + sec.toFixed(1) + 's';
    }
    updateTrimBar(sound && sound.fileUrl && Audio && Audio.getDurationSeconds ? Audio.getDurationSeconds(sound.fileUrl) : null);
    modalEl.classList.add('modal--open');
    modalEl.hidden = false;
    if (modalError) modalError.textContent = '';
  }

  function updateTrimBar(durationSecArg) {
    const wrap = document.getElementById('trim-bar-wrap');
    const fill = document.getElementById('trim-bar-fill');
    const handleStart = document.getElementById('trim-handle-start');
    const handleEnd = document.getElementById('trim-handle-end');
    const startLabel = document.getElementById('trim-start-label');
    const endLabel = document.getElementById('trim-end-label');
    const startInput = modalForm && modalForm.querySelector('[name="startSec"]');
    const endInput = modalForm && modalForm.querySelector('[name="endSec"]');
    if (!wrap || !fill || !handleStart || !handleEnd || !startInput || !endInput) return;
    let duration = durationSecArg;
    if (duration == null && modalForm && Audio && Audio.getDurationSeconds) {
      const fileUrl = (modalForm.dataset && modalForm.dataset.pendingBlobId)
        ? ('local:' + modalForm.dataset.pendingBlobId)
        : (modalForm.querySelector('[name="fileUrl"]').value || '').trim();
      if (fileUrl) duration = Audio.getDurationSeconds(fileUrl);
    }
    if (duration == null || duration <= 0) {
      wrap.setAttribute('aria-hidden', 'true');
      return;
    }
    wrap.setAttribute('aria-hidden', 'false');
    wrap.dataset.durationSec = String(duration);
    let startSec = parseFloat(startInput.value);
    let endSec = parseFloat(endInput.value);
    if (isNaN(startSec)) startSec = 0;
    if (isNaN(endSec)) endSec = duration;
    startSec = Math.max(0, Math.min(startSec, endSec - 0.05));
    endSec = Math.min(duration, Math.max(endSec, startSec + 0.05));
    startInput.value = startSec.toFixed(2);
    endInput.value = endSec.toFixed(2);
    const leftPct = (startSec / duration) * 100;
    const widthPct = ((endSec - startSec) / duration) * 100;
    fill.style.left = leftPct + '%';
    fill.style.width = widthPct + '%';
    handleStart.style.left = leftPct + '%';
    handleEnd.style.left = (endSec / duration) * 100 + '%';
    if (startLabel) startLabel.textContent = startSec.toFixed(1) + 's';
    if (endLabel) endLabel.textContent = endSec.toFixed(1) + 's';
  }

  function initTrimBarDrag() {
    const wrap = document.getElementById('trim-bar-wrap');
    const bar = document.getElementById('trim-bar');
    const handleStart = document.getElementById('trim-handle-start');
    const handleEnd = document.getElementById('trim-handle-end');
    if (!wrap || !bar || !handleStart || !handleEnd) return;
    function getSecFromEvent(e) {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const rect = bar.getBoundingClientRect();
      const duration = parseFloat(wrap.dataset.durationSec);
      if (!duration) return null;
      let pct = (clientX - rect.left) / rect.width;
      pct = Math.max(0, Math.min(1, pct));
      return pct * duration;
    }
    function onMove(e, which) {
      const sec = getSecFromEvent(e);
      if (sec == null) return;
      const startInput = modalForm && modalForm.querySelector('[name="startSec"]');
      const endInput = modalForm && modalForm.querySelector('[name="endSec"]');
      if (!startInput || !endInput) return;
      const duration = parseFloat(wrap.dataset.durationSec);
      let startSec = parseFloat(startInput.value) || 0;
      let endSec = parseFloat(endInput.value) || duration;
      if (which === 'start') {
        startSec = Math.max(0, Math.min(sec, endSec - 0.05));
        startInput.value = startSec.toFixed(2);
      } else {
        endSec = Math.min(duration, Math.max(sec, startSec + 0.05));
        endInput.value = endSec.toFixed(2);
      }
      updateTrimBar(duration);
    }
    function onUp() {
      document.removeEventListener('mousemove', moveStart);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', moveStart, { passive: false });
      document.removeEventListener('touchend', onUp);
    }
    let moveStart = function (e) {
      if (e.touches) e.preventDefault();
      onMove(e, dragWhich);
    };
    let dragWhich = null;
    function startDrag(which) {
      dragWhich = which;
      document.addEventListener('mousemove', moveStart);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', moveStart, { passive: false });
      document.addEventListener('touchend', onUp);
    }
    handleStart.addEventListener('mousedown', function (e) { e.preventDefault(); startDrag('start'); });
    handleStart.addEventListener('touchstart', function (e) { e.preventDefault(); startDrag('start'); }, { passive: false });
    handleEnd.addEventListener('mousedown', function (e) { e.preventDefault(); startDrag('end'); });
    handleEnd.addEventListener('touchstart', function (e) { e.preventDefault(); startDrag('end'); }, { passive: false });
  }

  function updateVolumePercent(pct) {
    const el = document.getElementById('volume-percent');
    if (el) el.textContent = (pct == null ? 100 : Math.round(pct)) + '%';
  }

  function updateSpeedValue(rate) {
    const el = document.getElementById('speed-value');
    if (el) el.textContent = rate == null ? '1.0' : Number(rate).toFixed(1);
  }

  function closeModal() {
    if (modalEl) {
      modalEl.classList.remove('modal--open');
      modalEl.hidden = true;
    }
  }

  function handleUploadAudio(fileInput) {
    const file = fileInput && fileInput.files && fileInput.files[0];
    const uploadedHint = document.getElementById('uploaded-audio-hint');
    if (!file || !modalForm) return;
    const LocalAudio = window.SoundboardLocalAudio;
    if (!LocalAudio || !LocalAudio.putBlob) {
      if (uploadedHint) uploadedHint.textContent = 'Upload not available.';
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      const ab = reader.result;
      if (!ab || !(ab instanceof ArrayBuffer)) return;
      const blobId = 'blob-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      LocalAudio.putBlob(blobId, ab).then(function () {
        modalForm.dataset.pendingBlobId = blobId;
        modalForm.querySelector('[name="fileUrl"]').value = '';
        if (uploadedHint) uploadedHint.textContent = 'Uploaded: ' + (file.name || 'file');
        var localUrl = 'local:' + blobId;
        if (Audio && Audio.loadBuffer) Audio.loadBuffer(localUrl).then(function () { updateTrimBar(); });
      }).catch(function () {
        if (uploadedHint) uploadedHint.textContent = 'Upload failed.';
      });
    };
    reader.onerror = function () {
      if (uploadedHint) uploadedHint.textContent = 'Could not read file.';
    };
    reader.readAsArrayBuffer(file);
  }

  function saveSoundFromModal() {
    if (!modalForm || !currentBoard) return;
    const id = modalEl.dataset.soundId;
    const title = (modalForm.querySelector('[name="title"]').value || '').trim();
    const pendingBlobId = modalForm.dataset && modalForm.dataset.pendingBlobId;
    const fileUrl = pendingBlobId ? ('local:' + pendingBlobId) : (modalForm.querySelector('[name="fileUrl"]').value || '').trim();
    if (!title) {
      if (modalError) modalError.textContent = 'Title is required.';
      return;
    }
    if (!fileUrl) {
      if (modalError) modalError.textContent = 'Provide an audio URL or upload a file.';
      return;
    }
    const volumePct = parseFloat(modalForm.querySelector('[name="volume"]').value);
    const volume = isNaN(volumePct) ? 1 : Math.max(0, Math.min(1, volumePct / 100));
    const rateRaw = parseFloat(modalForm.querySelector('[name="playbackRate"]').value);
    const playbackRate = isNaN(rateRaw) ? 1 : Math.max(0.5, Math.min(2, rateRaw));
    const loopCheck = modalForm.querySelector('[name="loop"]');
    const loop = loopCheck ? loopCheck.checked : false;
    const startSecRaw = modalForm.querySelector('[name="startSec"]').value.trim();
    const endSecRaw = modalForm.querySelector('[name="endSec"]').value.trim();
    const startMs = startSecRaw === '' ? null : Math.round(parseFloat(startSecRaw) * 1000);
    const endMs = endSecRaw === '' ? null : Math.round(parseFloat(endSecRaw) * 1000);
    if (startMs != null && endMs != null && startMs >= endMs) {
      if (modalError) modalError.textContent = 'Start must be less than end.';
      return;
    }

    let sound = currentBoard.sounds.find((s) => s.id === id);
    if (sound) {
      sound.title = title;
      sound.fileUrl = fileUrl;
      sound.imageUrl = (modalForm.querySelector('[name="imageUrl"]').value || '').trim();
      sound.category = (modalForm.querySelector('[name="category"]').value || '').trim();
      sound.hotkey = (modalForm.querySelector('[name="hotkey"]').value || '').trim();
      sound.volume = volume;
      sound.playbackRate = playbackRate;
      sound.loop = loop;
      sound.startMs = startMs;
      sound.endMs = endMs;
    } else {
      sound = Board.normalizeSound({
        id: Board.generateId(),
        title,
        fileUrl,
        imageUrl: (modalForm.querySelector('[name="imageUrl"]').value || '').trim(),
        category: (modalForm.querySelector('[name="category"]').value || '').trim(),
        tags: [],
        volume,
        playbackRate,
        loop,
        startMs,
        endMs,
        hotkey: (modalForm.querySelector('[name="hotkey"]').value || '').trim(),
        color: '#6b7280',
        extra: {}
      });
      currentBoard.sounds.push(sound);
    }
    saveToStorage();
    buildHotkeyMap();
    closeModal();
    render();
  }

  function exportBoard() {
    if (!currentBoard) return;
    const json = JSON.stringify(Board.normalizeBoard(currentBoard), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (currentBoard.name || 'board').replace(/[^a-z0-9-_]/gi, '-') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadAllSounds() {
    if (!currentBoard || !currentBoard.sounds || currentBoard.sounds.length === 0) {
      if (downloadStatus) downloadStatus.textContent = 'No sounds to download.';
      return;
    }
    const LocalAudio = window.SoundboardLocalAudio;
    if (!LocalAudio || !LocalAudio.putBlob) {
      if (downloadStatus) downloadStatus.textContent = 'Local storage not available.';
      return;
    }
    var remoteSounds = currentBoard.sounds.filter(function (s) {
      return s && s.fileUrl && s.fileUrl.trim() && !String(s.fileUrl).startsWith('local:');
    });
    if (remoteSounds.length === 0) {
      if (downloadStatus) downloadStatus.textContent = 'All sounds already saved locally.';
      setTimeout(function () { if (downloadStatus) downloadStatus.textContent = ''; }, 2500);
      return;
    }
    const btn = toolbarEl && toolbarEl.querySelector('[data-action="download-sounds"]');
    if (btn) btn.disabled = true;
    const total = remoteSounds.length;
    const results = [];

    function fetchOne(index) {
      if (index >= total) {
        applyLocalAndSave(results);
        return;
      }
      const s = remoteSounds[index];
      const filename = (s.title || s.id || 'sound-' + (index + 1)).replace(/[^a-z0-9-_\.]/gi, '-').slice(0, 80) + '.mp3';
      if (downloadStatus) downloadStatus.textContent = 'Downloading ' + (index + 1) + '/' + total + '…';
      fetch(s.fileUrl, { mode: 'cors' })
        .then(function (r) { return r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText)); })
        .then(function (arrayBuffer) {
          results.push({ sound: s, arrayBuffer: arrayBuffer, filename: filename });
          fetchOne(index + 1);
        })
        .catch(function (err) {
          if (downloadStatus) downloadStatus.textContent = 'Failed: ' + (err.message || 'fetch');
          if (btn) btn.disabled = false;
        });
    }

    function applyLocalAndSave(results) {
      if (downloadStatus) downloadStatus.textContent = 'Saving into board…';
      const LocalAudio = window.SoundboardLocalAudio;
      let saved = 0;
      function storeNext() {
        if (saved >= results.length) {
          results.forEach(function (r) {
            r.sound.fileUrl = 'local:downloaded-' + r.sound.id;
          });
          currentBoard.updatedAt = new Date().toISOString();
          saveToStorage();
          if (Audio && Audio.clearCache) Audio.clearCache();
          render();
          saveFilesToDirectory(results);
          return;
        }
        const r = results[saved];
        LocalAudio.putBlob('downloaded-' + r.sound.id, r.arrayBuffer).then(function () {
          saved++;
          storeNext();
        }).catch(function () {
          if (downloadStatus) downloadStatus.textContent = 'Error saving to storage.';
          if (btn) btn.disabled = false;
        });
      }
      storeNext();
    }

    function saveFilesToDirectory(results) {
      function done(msg) {
        if (downloadStatus) downloadStatus.textContent = msg;
        if (btn) btn.disabled = false;
        setTimeout(function () { if (downloadStatus) downloadStatus.textContent = ''; }, 3000);
      }
      if (typeof window.showDirectoryPicker === 'function') {
        if (downloadStatus) downloadStatus.textContent = 'Choose a folder to save files…';
        window.showDirectoryPicker()
          .then(function (dir) {
            if (downloadStatus) downloadStatus.textContent = 'Saving files…';
            var written = 0;
            function writeNext() {
              if (written >= results.length) {
                return dir.getFileHandle((currentBoard.name || 'board').replace(/[^a-z0-9-_]/gi, '-') + '.json', { create: true })
                  .then(function (fh) { return fh.createWritable(); })
                  .then(function (w) {
                    w.write(JSON.stringify(Board.normalizeBoard(currentBoard), null, 2));
                    return w.close();
                  });
              }
              var r = results[written];
              return dir.getFileHandle(r.filename, { create: true })
                .then(function (fh) { return fh.createWritable(); })
                .then(function (w) {
                  w.write(r.arrayBuffer);
                  return w.close();
                })
                .then(function () { written++; return writeNext(); });
            }
            return writeNext();
          })
          .then(function () {
            done('Saved to folder. Board updated with local sounds.');
          })
          .catch(function (err) {
            if (err.name === 'AbortError') done('Board updated with local sounds.');
            else done('Saved to board. Folder save failed.');
          });
      } else {
        done('All sounds saved into the board. (Use a modern browser to save to a folder.)');
      }
    }

    fetchOne(0);
  }

  function getSoundIndex(soundId) {
    if (!currentBoard || !currentBoard.sounds) return -1;
    return currentBoard.sounds.findIndex((s) => s.id === soundId);
  }

  function moveSoundInModal(direction) {
    const id = modalEl.dataset.soundId;
    if (!id || !currentBoard || !currentBoard.sounds) return;
    const idx = getSoundIndex(id);
    if (idx < 0) return;
    const next = direction === 'up' ? idx - 1 : idx + 1;
    if (next < 0 || next >= currentBoard.sounds.length) return;
    const arr = currentBoard.sounds;
    const t = arr[idx];
    arr[idx] = arr[next];
    arr[next] = t;
    saveToStorage();
    render();
    openModal(t);
  }

  function previewFromModal() {
    if (!modalForm || !Audio) return;
    const fileUrl = (modalForm.querySelector('[name="fileUrl"]').value || '').trim();
    if (!fileUrl) {
      if (modalError) modalError.textContent = 'Enter an audio URL to preview.';
      return;
    }
    const volPct = parseFloat(modalForm.querySelector('[name="volume"]').value);
    const startSecRaw = modalForm.querySelector('[name="startSec"]').value.trim();
    const endSecRaw = modalForm.querySelector('[name="endSec"]').value.trim();
    const startMs = startSecRaw === '' ? null : Math.round(parseFloat(startSecRaw) * 1000);
    const endMs = endSecRaw === '' ? null : Math.round(parseFloat(endSecRaw) * 1000);
    const rateRaw = parseFloat(modalForm.querySelector('[name="playbackRate"]').value);
    const playbackRate = isNaN(rateRaw) ? 1 : Math.max(0.5, Math.min(2, rateRaw));
    const loopCheck = modalForm.querySelector('[name="loop"]');
    const loop = loopCheck ? loopCheck.checked : false;
    const temp = {
      id: 'preview',
      title: 'Preview',
      fileUrl,
      volume: isNaN(volPct) ? 1 : Math.max(0, Math.min(1, volPct / 100)),
      playbackRate,
      loop,
      startMs,
      endMs
    };
    Audio.playSound(temp);
    if (modalError) modalError.textContent = '';
  }

  function soundFromFormForDuration() {
    const fileUrl = (modalForm.dataset && modalForm.dataset.pendingBlobId)
      ? ('local:' + modalForm.dataset.pendingBlobId)
      : (modalForm.querySelector('[name="fileUrl"]').value || '').trim();
    if (!fileUrl) return null;
    Audio.loadBuffer(fileUrl).then(function () {
      if (durationHint && Audio.getDurationSeconds) {
        const sec = Audio.getDurationSeconds(fileUrl);
        if (sec != null) durationHint.textContent = 'Duration: ' + sec.toFixed(1) + 's';
      }
      updateTrimBar();
    });
  }

  function importBoard(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const result = Board.validateBoard(data);
        if (!result.ok) {
          alert('Invalid board format: ' + (result.error || 'unknown'));
          return;
        }
        setBoard(Board.normalizeBoard(data));
        saveToStorage();
      } catch (e) {
        alert('Invalid JSON file.');
      }
    };
    reader.readAsText(file);
  }

  var boardTitleEditInited = false;
  function initBoardTitle() {
    if (!boardNameEl || boardTitleEditInited) return;
    boardTitleEditInited = true;
    boardNameEl.addEventListener('click', function () {
      if (!currentBoard) return;
      if (boardNameEl.querySelector('input')) return;
      if (boardNameEl.querySelector('input')) return;
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'header__title-input';
      input.value = currentBoard.name || 'Soundboard';
      input.setAttribute('aria-label', 'Board name');
      function commit() {
        var name = (input.value || '').trim() || 'Soundboard';
        currentBoard.name = name;
        saveToStorage();
        boardNameEl.removeChild(input);
        boardNameEl.textContent = name;
        boardNameEl.title = 'Click to change board name';
      }
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
        if (e.key === 'Escape') {
          boardNameEl.removeChild(input);
          boardNameEl.textContent = currentBoard.name || 'Soundboard';
          boardNameEl.title = 'Click to change board name';
        }
      });
      boardNameEl.textContent = '';
      boardNameEl.appendChild(input);
      input.focus();
      input.select();
    });
  }

  function initToolbar() {
    if (!toolbarEl) return;
    const addBtn = toolbarEl.querySelector('[data-action="add"]');
    const importBtn = toolbarEl.querySelector('[data-action="import"]');
    const exportBtn = toolbarEl.querySelector('[data-action="export"]');
    const downloadBtn = toolbarEl.querySelector('[data-action="download-sounds"]');
    const reorderBtn = toolbarEl.querySelector('[data-action="reorder-toggle"]');
    const analyzeAllBtn = toolbarEl.querySelector('[data-action="analyze-all"]');
    if (addBtn) addBtn.addEventListener('click', addSound);
    if (importBtn && importInput) importBtn.addEventListener('click', () => importInput.click());
    if (importInput) importInput.addEventListener('change', (e) => { if (e.target.files[0]) importBoard(e.target.files[0]); e.target.value = ''; });
    if (exportBtn) exportBtn.addEventListener('click', exportBoard);
    if (downloadBtn) downloadBtn.addEventListener('click', downloadAllSounds);
    if (reorderBtn) reorderBtn.addEventListener('click', () => setReorderMode(!reorderMode));
    if (analyzeAllBtn) analyzeAllBtn.addEventListener('click', analyzeAllSounds);
    if (globalVolumeEl && Audio) {
      globalVolumeEl.addEventListener('input', function () {
        const pct = parseInt(globalVolumeEl.value, 10);
        if (Audio.setMasterVolume) Audio.setMasterVolume(pct / 100);
        if (globalVolumeLabel) globalVolumeLabel.textContent = 'Volume ' + (isNaN(pct) ? 100 : pct) + '%';
      });
      if (globalVolumeLabel) globalVolumeLabel.textContent = 'Volume ' + (Audio.getMasterVolume ? Math.round(Audio.getMasterVolume() * 100) : 100) + '%';
    }

    if (searchInputEl) {
      searchInputEl.addEventListener('input', function () {
        searchQuery = searchInputEl.value || '';
        render();
      });
    }
    if (searchClearEl) {
      searchClearEl.addEventListener('click', function () {
        searchQuery = '';
        if (searchInputEl) searchInputEl.value = '';
        render();
        if (searchInputEl) searchInputEl.focus();
      });
    }

    if (autoLevelToggleEl) {
      let initial = true;
      try {
        const raw = localStorage.getItem(AUTO_LEVEL_KEY);
        if (raw != null) initial = raw === 'true';
      } catch (_) {}
      autoLevelToggleEl.checked = initial;
      if (Audio && Audio.setAutoLevelEnabled) Audio.setAutoLevelEnabled(initial);
      autoLevelToggleEl.addEventListener('change', function () {
        const enabled = !!autoLevelToggleEl.checked;
        try { localStorage.setItem(AUTO_LEVEL_KEY, String(enabled)); } catch (_) {}
        if (Audio && Audio.setAutoLevelEnabled) Audio.setAutoLevelEnabled(enabled);
      });
    }

    if (quickBarEl) {
      const quickAdd = quickBarEl.querySelector('[data-action="quick-add"]');
      const quickSearch = quickBarEl.querySelector('[data-action="quick-search"]');
      const quickReorder = quickBarEl.querySelector('[data-action="quick-reorder"]');
      const quickAnalyze = quickBarEl.querySelector('[data-action="quick-analyze"]');

      if (quickAdd) quickAdd.addEventListener('click', addSound);
      if (quickSearch) {
        quickSearch.addEventListener('click', function () {
          if (searchInputEl) {
            searchInputEl.focus();
            searchInputEl.select();
          }
        });
      }
      if (quickReorder) {
        quickReorder.addEventListener('click', function () {
          setReorderMode(!reorderMode);
        });
      }
      if (quickAnalyze) quickAnalyze.addEventListener('click', analyzeAllSounds);
    }
  }

  function analyzeAllSounds() {
    if (!currentBoard || !currentBoard.sounds || currentBoard.sounds.length === 0) {
      if (downloadStatus) downloadStatus.textContent = 'No sounds to analyze.';
      return;
    }
    if (!Audio || !Audio.analyzeFileUrl) {
      if (downloadStatus) downloadStatus.textContent = 'Analysis not available.';
      return;
    }
    const sounds = currentBoard.sounds.slice();
    let i = 0;
    let updated = 0;
    const total = sounds.length;
    if (downloadStatus) downloadStatus.textContent = 'Analyzing 0/' + total + '…';

    function step() {
      if (i >= total) {
        if (updated > 0) saveToStorage();
        if (downloadStatus) downloadStatus.textContent = 'Analyze complete.';
        setTimeout(function () { if (downloadStatus) downloadStatus.textContent = ''; }, 2500);
        return;
      }
      const s = sounds[i++];
      if (!s || !s.fileUrl) return setTimeout(step, 0);
      if (!s.extra || typeof s.extra !== 'object') s.extra = {};

      Audio.analyzeFileUrl(s.fileUrl).then(function (res) {
        if (res && typeof res.gain === 'number' && isFinite(res.gain)) {
          s.extra.normGain = res.gain;
          s.extra.normAnalyzedAt = new Date().toISOString();
          s.extra.normAlgoVersion = res.algoVersion || 1;
          updated++;
        }
      }).catch(function () {}).finally(function () {
        if (downloadStatus) downloadStatus.textContent = 'Analyzing ' + i + '/' + total + '…';
        setTimeout(step, 0);
      });
    }
    step();
  }

  function initModal() {
    if (!modalEl || !modalForm) return;
    const saveBtn = modalForm.querySelector('[data-action="save"]');
    const cancelBtn = modalForm.querySelector('[data-action="cancel"]');
    const deleteBtn = modalForm.querySelector('[data-action="delete"]');
    const previewBtn = modalForm.querySelector('[data-action="preview"]');
    const moveUpBtn = modalForm.querySelector('[data-action="move-up"]');
    const moveDownBtn = modalForm.querySelector('[data-action="move-down"]');
    const volumeRange = modalForm.querySelector('[name="volume"]');
    const fileUrlInput = modalForm.querySelector('[name="fileUrl"]');
    if (saveBtn) saveBtn.addEventListener('click', saveSoundFromModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (deleteBtn) deleteBtn.addEventListener('click', () => {
      const id = modalEl.dataset.soundId;
      const s = currentBoard && currentBoard.sounds.find((x) => x.id === id);
      if (s) deleteSound(s);
    });
    if (previewBtn) previewBtn.addEventListener('click', previewFromModal);
    if (moveUpBtn) moveUpBtn.addEventListener('click', () => moveSoundInModal('up'));
    if (moveDownBtn) moveDownBtn.addEventListener('click', () => moveSoundInModal('down'));
    if (volumeRange) volumeRange.addEventListener('input', function () { updateVolumePercent(parseFloat(volumeRange.value)); });
    const speedRange = modalForm.querySelector('[name="playbackRate"]');
    if (speedRange) speedRange.addEventListener('input', function () { updateSpeedValue(parseFloat(speedRange.value)); });
    if (fileUrlInput && Audio) fileUrlInput.addEventListener('blur', soundFromFormForDuration);
    const uploadInput = document.getElementById('upload-audio-input');
    if (uploadInput) uploadInput.addEventListener('change', function () { handleUploadAudio(uploadInput); });
    modalForm.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      const target = e.target;
      if (!target) return;
      // Enter in the edit form should save, except when focused on buttons/ranges/file input.
      const tag = (target.tagName || '').toLowerCase();
      const type = (target.type || '').toLowerCase();
      if (tag === 'button') return;
      if (type === 'range' || type === 'file') return;
      e.preventDefault();
      saveSoundFromModal();
    });
    initTrimBarDrag();
    modalEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal__backdrop') || !e.target.closest('.modal__panel')) closeModal();
    });
  }

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target && (e.target.closest('input') || e.target.closest('textarea'))) return;
      const key = (e.key || '').toUpperCase();
      const sound = key ? hotkeyMap.get(key) : null;
      if (sound) {
        e.preventDefault();
        onPlay(sound);
      }
    });
  }

  function init() {
    initToolbar();
    initModal();
    initKeyboard();
    loadInitialBoard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
