/**
 * app.js — classsoundboard3 main controller
 */
(function () {
  const Schema = window.SoundboardSchema;
  const Repo = window.SoundboardRepository;
  const ImportSvc = window.SoundboardImportService;
  const ExportSvc = window.SoundboardExportService;
  const BlerpImport = window.SoundboardBlerpImport;
  const Audio = window.SoundboardAudio;
  const Media = window.SoundboardMediaResolver;
  const Hotkeys = window.SoundboardHotkeys;
  const UI = window.SoundboardUIRenderer;

  const gridEl = document.getElementById('sound-grid');
  const quickAccessEl = document.getElementById('quick-access');
  const favouritesSectionEl = document.getElementById('favourites-section');
  const favouritesStripEl = document.getElementById('favourites-strip');
  const recentsSectionEl = document.getElementById('recents-section');
  const recentsStripEl = document.getElementById('recents-strip');
  const favouritesReorderToggleEl = document.getElementById('favourites-reorder-toggle');
  const favouritesRowsSelectEl = document.getElementById('favourites-rows-select');
  const recentsRowsSelectEl = document.getElementById('recents-rows-select');
  const recentsCollapseToggleEl = document.getElementById('recents-collapse-toggle');
  const favouritesCollapseToggleEl = document.getElementById('favourites-collapse-toggle');
  const recentsCountEl = document.getElementById('recents-count');
  const favouritesCountEl = document.getElementById('favourites-count');
  const boardNameEl = document.getElementById('board-name');
  const statusLine = document.getElementById('status-line');
  const searchInput = document.getElementById('search-input');
  const importInput = document.getElementById('import-input');
  const importDropzone = document.getElementById('import-dropzone');
  const modal = document.getElementById('modal');
  const modalForm = document.getElementById('modal-form');
  const modalError = document.getElementById('modal-error');
  const blerpModal = document.getElementById('blerp-modal');
  const blerpUrlInput = document.getElementById('blerp-url-input');
  const blerpModalError = document.getElementById('blerp-modal-error');
  const blerpModalStatus = document.getElementById('blerp-modal-status');
  const blerpImportBtn = document.getElementById('blerp-import-btn');
  const globalVolume = document.getElementById('global-volume');
  const globalVolumeLabel = document.getElementById('global-volume-label');
  const autoLevelToggleEl = document.getElementById('auto-level-toggle');

  let playingId = null;
  let errorIds = new Set();
  let editingId = null;
  let searchQuery = '';
  let pendingAudioBlob = null;
  let analyzeInProgress = false;
  const imageUrlCache = new Map();

  const STRIP_ROWS_MIN = 1;
  const STRIP_ROWS_MAX = 4;
  const FAVOURITES_ROWS_KEY = 'soundboard-favourites-rows';
  const RECENTS_ROWS_KEY = 'soundboard-recents-rows';
  const LOCAL_RECENTS_KEY = 'soundboard-recents-local';
  const QUICK_ACCESS_COLLAPSED_KEY_PREFIX = 'soundboard-quick-access-collapsed:';
  const AUTO_LEVEL_KEY = 'soundboard-auto-level';

  let favouriteStripRows = 1;
  let recentStripRows = 1;
  let favouriteReorderMode = false;
  let quickAccessCollapsed = { recents: false, favourites: false };

  window.SoundboardImageResolver = {
    resolve: function (url) {
      if (!url) return '';
      const u = String(url);
      if (u.startsWith('remote:')) return u.slice(7);
      const mediaHash = Repo.parseMediaRef(u);
      if (mediaHash) return Repo.mediaUrl(mediaHash);
      const parsed = Repo.parseBlobRef(u);
      if (parsed && parsed.kind === 'image') {
        return imageUrlCache.get(parsed.key) || '';
      }
      if (u.startsWith('/media/') || u.startsWith('/boards/')) return u;
      if (u.startsWith('/')) return u;
      return url;
    },
    isLocalImageRef: function (url) {
      return Repo.parseBlobRef(url) != null;
    }
  };

  function setStatus(msg, ms) {
    if (!statusLine) return;
    statusLine.textContent = msg || '';
    if (ms) setTimeout(function () {
      if (statusLine.textContent === msg) statusLine.textContent = '';
    }, ms);
  }

  function getBoard() {
    return Repo.getBoard();
  }

  function soundsForRender(sounds) {
    return (sounds || []).map(function (s) {
      const play = Schema.soundForPlayback(s);
      return Object.assign({}, s, { fileUrl: play.fileUrl, imageUrl: play.imageRef });
    });
  }

  function buildGroups(board) {
    const sounds = filterSounds(board.sounds || []);
    const map = new Map();
    sounds.forEach(function (s) {
      const cat = String(s.category || '').trim() || 'Uncategorized';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(s);
    });
    const order = (board.layout && board.layout.categoryOrder) || [];
    const groups = [];
    const seen = new Set();
    order.forEach(function (c) {
      if (map.has(c)) {
        groups.push({ key: c, label: c, sounds: map.get(c) });
        seen.add(c);
      }
    });
    const rest = [];
    map.forEach(function (list, name) {
      if (!seen.has(name)) rest.push(name);
    });
    rest.sort(function (a, b) { return a.localeCompare(b); });
    rest.forEach(function (name) {
      groups.push({ key: name, label: name, sounds: map.get(name) });
    });
    return groups;
  }

  function filterSounds(sounds) {
    const q = String(searchQuery || '').trim().toLowerCase();
    if (!q) return sounds.slice();
    return sounds.filter(function (s) {
      const title = String(s.title || '').toLowerCase();
      const cat = String(s.category || '').toLowerCase();
      return title.includes(q) || cat.includes(q);
    });
  }

  function ensureLayout(board) {
    if (!board.layout) {
      board.layout = { categoryOrder: [], categoryCollapsed: {}, quickAccess: { favourites: [], recents: [] } };
    }
    if (!board.layout.quickAccess) board.layout.quickAccess = { favourites: [], recents: [] };
    if (!board.layout.categoryCollapsed) board.layout.categoryCollapsed = {};
    return board.layout;
  }

  function clampStripRows(value) {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) return STRIP_ROWS_MIN;
    return Math.max(STRIP_ROWS_MIN, Math.min(STRIP_ROWS_MAX, parsed));
  }

  function getQuickAccessCollapsedKey() {
    const board = getBoard();
    const id = board && board.id ? String(board.id) : 'default';
    return QUICK_ACCESS_COLLAPSED_KEY_PREFIX + id;
  }

  function loadQuickAccessCollapsedState() {
    try {
      const raw = localStorage.getItem(getQuickAccessCollapsedKey());
      if (!raw) return { recents: false, favourites: false };
      const parsed = JSON.parse(raw);
      return {
        recents: !!(parsed && parsed.recents),
        favourites: !!(parsed && parsed.favourites)
      };
    } catch (_) {
      return { recents: false, favourites: false };
    }
  }

  function saveQuickAccessCollapsedState() {
    try {
      localStorage.setItem(getQuickAccessCollapsedKey(), JSON.stringify({
        recents: !!quickAccessCollapsed.recents,
        favourites: !!quickAccessCollapsed.favourites
      }));
    } catch (_) {}
  }

  function loadFavouriteStripRows() {
    try {
      return clampStripRows(localStorage.getItem(FAVOURITES_ROWS_KEY));
    } catch (_) {
      return STRIP_ROWS_MIN;
    }
  }

  function saveFavouriteStripRows() {
    try {
      localStorage.setItem(FAVOURITES_ROWS_KEY, String(clampStripRows(favouriteStripRows)));
    } catch (_) {}
  }

  function loadRecentStripRows() {
    try {
      return clampStripRows(localStorage.getItem(RECENTS_ROWS_KEY));
    } catch (_) {
      return STRIP_ROWS_MIN;
    }
  }

  function saveRecentStripRows() {
    try {
      localStorage.setItem(RECENTS_ROWS_KEY, String(clampStripRows(recentStripRows)));
    } catch (_) {}
  }

  function getQuickAccessSounds(board) {
    const source = board.sounds || [];
    const byId = new Map(source.map(function (s) { return [String(s.id), s]; }));
    const qa = ensureLayout(board).quickAccess;
    const favourites = (qa.favourites || [])
      .map(function (id) { return byId.get(String(id)); })
      .filter(Boolean);
    const recents = (qa.recents || [])
      .map(function (id) { return byId.get(String(id)); })
      .filter(Boolean);
    return {
      favourites: soundsForRender(favourites),
      recents: soundsForRender(recents)
    };
  }

  function formatSoundCount(count) {
    return count + ' sound' + (count === 1 ? '' : 's');
  }

  function updateQuickAccessCollapseUi(counts) {
    const isRecentsCollapsed = !!quickAccessCollapsed.recents;
    const isFavouritesCollapsed = !!quickAccessCollapsed.favourites;
    if (recentsSectionEl) recentsSectionEl.classList.toggle('quick-access__section--collapsed', isRecentsCollapsed);
    if (favouritesSectionEl) favouritesSectionEl.classList.toggle('quick-access__section--collapsed', isFavouritesCollapsed);
    if (recentsCountEl) recentsCountEl.textContent = formatSoundCount(counts.recents);
    if (favouritesCountEl) favouritesCountEl.textContent = formatSoundCount(counts.favourites);
    if (recentsCollapseToggleEl) {
      recentsCollapseToggleEl.setAttribute('aria-expanded', isRecentsCollapsed ? 'false' : 'true');
      const caret = recentsCollapseToggleEl.querySelector('.quick-access__caret');
      if (caret) caret.textContent = isRecentsCollapsed ? '\u25B6' : '\u25BC';
    }
    if (favouritesCollapseToggleEl) {
      favouritesCollapseToggleEl.setAttribute('aria-expanded', isFavouritesCollapsed ? 'false' : 'true');
      const caret = favouritesCollapseToggleEl.querySelector('.quick-access__caret');
      if (caret) caret.textContent = isFavouritesCollapsed ? '\u25B6' : '\u25BC';
    }
  }

  function renderQuickAccess(renderOpts) {
    if (!quickAccessEl || !UI || !UI.renderHorizontalStrip) return;
    const board = getBoard();
    const strips = getQuickAccessSounds(board);
    const hotkeyCounts = renderOpts && renderOpts.hotkeyCounts ? renderOpts.hotkeyCounts : buildHotkeyCounts(board.sounds);

    quickAccessEl.hidden = false;
    if (favouritesSectionEl) favouritesSectionEl.hidden = false;
    if (recentsSectionEl) recentsSectionEl.hidden = false;

    updateQuickAccessCollapseUi({
      recents: strips.recents.length,
      favourites: strips.favourites.length
    });

    if (favouritesRowsSelectEl) {
      const favRows = String(clampStripRows(favouriteStripRows));
      if (favouritesRowsSelectEl.value !== favRows) favouritesRowsSelectEl.value = favRows;
    }
    if (recentsRowsSelectEl) {
      const recRows = String(clampStripRows(recentStripRows));
      if (recentsRowsSelectEl.value !== recRows) recentsRowsSelectEl.value = recRows;
    }
    if (favouritesReorderToggleEl) {
      favouritesReorderToggleEl.classList.toggle('btn--active', favouriteReorderMode);
      favouritesReorderToggleEl.setAttribute('aria-pressed', favouriteReorderMode ? 'true' : 'false');
      favouritesReorderToggleEl.textContent = favouriteReorderMode ? 'Done' : 'Reorder';
    }

    const favRowCount = clampStripRows(favouriteStripRows);
    if (favouritesStripEl) {
      favouritesStripEl.classList.toggle('sound-strip--multirow', favRowCount > 1);
      favouritesStripEl.style.setProperty('--favorites-strip-rows', String(favRowCount));
    }
    const recRowCount = clampStripRows(recentStripRows);
    if (recentsStripEl) {
      recentsStripEl.classList.toggle('sound-strip--multirow', recRowCount > 1);
      recentsStripEl.style.setProperty('--recents-strip-rows', String(recRowCount));
    }

    const stripOpts = Object.assign({}, renderOpts || {}, { hotkeyCounts: hotkeyCounts });

    if (strips.favourites.length > 0 && favouritesStripEl) {
      UI.renderHorizontalStrip(
        favouritesStripEl,
        strips.favourites,
        playingId,
        errorIds,
        onPlay,
        onEdit,
        Object.assign({}, stripOpts, {
          reorderMode: favouriteReorderMode,
          onReorder: reorderFavourites
        })
      );
    } else if (favouritesStripEl) {
      favouritesStripEl.textContent = '';
      const empty = document.createElement('p');
      empty.className = 'sound-strip__empty';
      empty.textContent = 'No favourites yet. Tap the star on a sound tile.';
      favouritesStripEl.appendChild(empty);
    }

    if (strips.recents.length > 0 && recentsStripEl) {
      UI.renderHorizontalStrip(
        recentsStripEl,
        strips.recents,
        playingId,
        errorIds,
        onPlay,
        onEdit,
        stripOpts
      );
    } else if (recentsStripEl) {
      recentsStripEl.textContent = '';
      const empty = document.createElement('p');
      empty.className = 'sound-strip__empty';
      empty.textContent = 'No recent plays yet. Play a sound to populate this list.';
      recentsStripEl.appendChild(empty);
    }
  }

  function toggleQuickAccessSectionCollapse(sectionKey) {
    const key = sectionKey === 'favourites' ? 'favourites' : 'recents';
    quickAccessCollapsed[key] = !quickAccessCollapsed[key];
    saveQuickAccessCollapsedState();
    render();
  }

  function setFavouriteStripRows(nextRows) {
    const clamped = clampStripRows(nextRows);
    if (clamped === favouriteStripRows) return;
    favouriteStripRows = clamped;
    saveFavouriteStripRows();
    render();
  }

  function setRecentStripRows(nextRows) {
    const clamped = clampStripRows(nextRows);
    if (clamped === recentStripRows) return;
    recentStripRows = clamped;
    saveRecentStripRows();
    render();
  }

  function reorderFavourites(fromIndex, toIndex) {
    const board = getBoard();
    const qa = ensureLayout(board).quickAccess;
    const ordered = (qa.favourites || []).map(String);
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= ordered.length || toIndex >= ordered.length || fromIndex === toIndex) return;
    const moved = ordered.splice(fromIndex, 1)[0];
    ordered.splice(toIndex, 0, moved);
    qa.favourites = ordered;
    Repo.setBoard(board);
    render();
  }

  function favouriteSet(board) {
    const favs = board.layout && board.layout.quickAccess && board.layout.quickAccess.favourites;
    return new Set((favs || []).map(String));
  }

  function buildRenderOpts(board) {
    const favs = favouriteSet(board);
    return {
      isFavorite: function (s) { return favs.has(String(s.id)); },
      onToggleFavorite: toggleFavourite,
      hotkeyCounts: buildHotkeyCounts(board.sounds)
    };
  }

  function updatePlayingUiForId(soundId, state) {
    if (!soundId || !UI || !UI.updateTileState) return;
    if (gridEl) UI.updateTileState(gridEl, soundId, state);
    if (recentsStripEl) UI.updateTileState(recentsStripEl, soundId, state);
    if (favouritesStripEl) UI.updateTileState(favouritesStripEl, soundId, state);
  }

  function renderRecentsStripOnly(renderOpts) {
    if (!recentsStripEl || !UI || !UI.renderHorizontalStrip) return;
    const board = getBoard();
    const opts = renderOpts || buildRenderOpts(board);
    const strips = getQuickAccessSounds(board);
    if (recentsCountEl) recentsCountEl.textContent = formatSoundCount(strips.recents.length);

    const recRowCount = clampStripRows(recentStripRows);
    recentsStripEl.classList.toggle('sound-strip--multirow', recRowCount > 1);
    recentsStripEl.style.setProperty('--recents-strip-rows', String(recRowCount));

    if (strips.recents.length > 0) {
      UI.renderHorizontalStrip(
        recentsStripEl,
        strips.recents,
        playingId,
        errorIds,
        onPlay,
        onEdit,
        opts
      );
    } else {
      recentsStripEl.textContent = '';
      const empty = document.createElement('p');
      empty.className = 'sound-strip__empty';
      empty.textContent = 'No recent plays yet. Play a sound to populate this list.';
      recentsStripEl.appendChild(empty);
    }
  }

  function render() {
    const board = getBoard();
    if (!board) return;
    if (boardNameEl) boardNameEl.textContent = board.name || 'Soundboard';

    const renderOpts = buildRenderOpts(board);
    const renderSounds = soundsForRender;
    const groups = buildGroups(board).map(function (g) {
      return { key: g.key, label: g.label, sounds: renderSounds(g.sounds) };
    });

    const categoryOpts = {
      isCollapsed: function (key) {
        const collapsed = board.layout && board.layout.categoryCollapsed;
        return !!(collapsed && collapsed[String(key)]);
      },
      onToggleCategory: function (key) {
        const k = String(key);
        if (!board.layout) board.layout = { categoryOrder: [], categoryCollapsed: {}, quickAccess: { favourites: [], recents: [] } };
        if (!board.layout.categoryCollapsed) board.layout.categoryCollapsed = {};
        board.layout.categoryCollapsed[k] = !board.layout.categoryCollapsed[k];
        Repo.setBoard(board);
        render();
      }
    };

    if (UI && UI.renderGroupedGrid) {
      UI.renderGroupedGrid(
        gridEl,
        groups,
        playingId,
        errorIds,
        onPlay,
        onEdit,
        false,
        null,
        renderOpts,
        categoryOpts
      );
    }

    renderQuickAccess(renderOpts);

    refreshCategoryDatalist(board);
  }

  function buildHotkeyCounts(sounds) {
    const m = new Map();
    (sounds || []).forEach(function (s) {
      const hk = Hotkeys && Hotkeys.normalizeHotkeyInput
        ? Hotkeys.normalizeHotkeyInput(s.hotkey || '')
        : String(s.hotkey || '').trim();
      if (!hk) return;
      m.set(hk, (m.get(hk) || 0) + 1);
    });
    return m;
  }

  function refreshCategoryDatalist(board) {
    const dl = document.getElementById('category-options');
    if (!dl) return;
    const cats = new Set();
    (board.sounds || []).forEach(function (s) {
      const c = String(s.category || '').trim();
      if (c) cats.add(c);
    });
    dl.textContent = '';
    cats.forEach(function (c) {
      const opt = document.createElement('option');
      opt.value = c;
      dl.appendChild(opt);
    });
  }

  async function prewarmBlobImages(sounds) {
    for (const s of sounds || []) {
      const ref = String(s.imageRef || '');
      const parsed = Repo.parseBlobRef(ref);
      if (!parsed || parsed.kind !== 'image') continue;
      if (imageUrlCache.has(parsed.key)) continue;
      try {
        const bytes = await Repo.getBlob(parsed.key);
        if (!bytes) continue;
        const blob = new Blob([bytes], { type: 'image/jpeg' });
        imageUrlCache.set(parsed.key, URL.createObjectURL(blob));
      } catch (_) {}
    }
    render();
  }

  function playSoundWithFallback(sound) {
    const play = Schema.soundForPlayback(sound);
    return Audio.resumeContext().then(function () {
      return Audio.playSound(play);
    }).then(function (played) {
      if (played !== false) return played;
      if (!Media || !Media.fetchAudioArrayBuffer) return false;
      // Retry once. Never point the shared board at a copy that only exists
      // in this browser — that is what broke playback on other computers.
      return Media.fetchAudioArrayBuffer(play).then(function (result) {
        if (!result || !result.arrayBuffer) return false;
        Audio.clearCache();
        return Audio.playSound(play);
      });
    });
  }

  function handlePlayError(sound) {
    errorIds.add(sound.id);
    playingId = null;
    setStatus('Audio could not play for "' + (sound.title || 'sound') + '". Try Download media in Settings.', 5000);
    render();
  }

  function startPlayback(sound, options) {
    if (!sound) return;
    const squelch = !options || options.squelch !== false;
    const prevPlayingId = playingId;
    const board = getBoard();
    const renderOpts = buildRenderOpts(board);

    pushRecent(sound.id);

    if (squelch) {
      Audio.stopSound();
      if (prevPlayingId) updatePlayingUiForId(prevPlayingId, 'idle');
      playingId = null;
    }

    playingId = sound.id;
    renderRecentsStripOnly(renderOpts);
    updatePlayingUiForId(sound.id, 'playing');

    playSoundWithFallback(sound).then(function () {
      if (playingId === sound.id) {
        playingId = null;
        updatePlayingUiForId(sound.id, 'idle');
      }
    }).catch(function () {
      handlePlayError(sound);
    });
  }

  function onPlay(sound, mode) {
    if (!sound) return;
    if (mode === 'momentary-stop') {
      Audio.stopSound(sound.id);
      if (playingId === sound.id) {
        playingId = null;
        updatePlayingUiForId(sound.id, 'idle');
      }
      return;
    }
    if (mode === 'momentary-start' || sound.momentary) {
      if (playingId === sound.id) return;
      startPlayback(sound, { squelch: true });
      return;
    }
    if (playingId === sound.id) {
      Audio.stopSound();
      playingId = null;
      updatePlayingUiForId(sound.id, 'idle');
      return;
    }
    startPlayback(sound);
  }

  function pushRecent(id) {
    const board = getBoard();
    const qa = ensureLayout(board).quickAccess;
    const rec = (qa.recents || []).filter(function (x) { return String(x) !== String(id); });
    rec.unshift(String(id));
    qa.recents = rec.slice(0, 20);
    // Recents belong to this computer: remember locally, never save the shared board for a play.
    saveLocalRecents(qa.recents);
  }

  function saveLocalRecents(list) {
    try { localStorage.setItem(LOCAL_RECENTS_KEY, JSON.stringify(list || [])); } catch (_) {}
  }

  function applyLocalRecents(board) {
    if (!board) return;
    const qa = ensureLayout(board).quickAccess;
    let list = null;
    try { list = JSON.parse(localStorage.getItem(LOCAL_RECENTS_KEY) || 'null'); } catch (_) {}
    if (!Array.isArray(list)) {
      // First run on this computer: start from whatever the old shared board had.
      list = (qa.recents || []).slice();
      saveLocalRecents(list);
    }
    const ids = new Set((board.sounds || []).map(function (s) { return String(s.id); }));
    qa.recents = list.map(String).filter(function (x) { return ids.has(x); }).slice(0, 20);
  }

  function toggleFavourite(sound) {
    const board = getBoard();
    const qa = ensureLayout(board).quickAccess;
    const sid = String(sound.id);
    let favs = (qa.favourites || []).map(String);
    const idx = favs.indexOf(sid);
    if (idx >= 0) favs.splice(idx, 1);
    else favs.push(sid);
    qa.favourites = favs;
    Repo.setBoard(board);
    render();
  }

  function updateSpeedValue(rate) {
    const el = document.getElementById('speed-value');
    if (el) el.textContent = rate == null ? '1.0' : Number(rate).toFixed(1);
  }

  function getModalDurationSec() {
    const audioRef = modalForm.audioRef.value.trim();
    const sound = findSound(editingId);
    const tmp = Schema.soundForPlayback(Object.assign({}, sound || {}, {
      audioRef: pendingAudioBlob ? 'blob:audio:' + (sound && sound.id) : audioRef
    }));
    if (pendingAudioBlob && sound) {
      return null;
    }
    return Audio.getDurationSeconds(tmp.fileUrl);
  }

  function updateTrimBar(durationSecArg) {
    const wrap = document.getElementById('trim-bar-wrap');
    const fill = document.getElementById('trim-bar-fill');
    const handleStart = document.getElementById('trim-handle-start');
    const handleEnd = document.getElementById('trim-handle-end');
    const startLabel = document.getElementById('trim-start-label');
    const endLabel = document.getElementById('trim-end-label');
    const startInput = modalForm.querySelector('[name="startSec"]');
    const endInput = modalForm.querySelector('[name="endSec"]');
    const hint = document.getElementById('duration-hint');
    if (!wrap || !fill || !handleStart || !handleEnd || !startInput || !endInput) return;
    let duration = durationSecArg;
    if (duration == null) duration = getModalDurationSec();
    if (duration == null || duration <= 0) {
      wrap.setAttribute('aria-hidden', 'true');
      if (hint) hint.textContent = 'Preview or upload audio to set trim range.';
      return;
    }
    wrap.setAttribute('aria-hidden', 'false');
    wrap.dataset.durationSec = String(duration);
    if (hint) hint.textContent = 'Total length: ' + duration.toFixed(1) + 's';
    let startSec = parseFloat(startInput.value);
    let endSec = parseFloat(endInput.value);
    if (isNaN(startSec)) startSec = 0;
    if (isNaN(endSec) || endInput.value.trim() === '') endSec = duration;
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
    if (!wrap || !bar || !handleStart || !handleEnd || wrap.dataset.trimInit === '1') return;
    wrap.dataset.trimInit = '1';
    function getSecFromEvent(e) {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const rect = bar.getBoundingClientRect();
      const duration = parseFloat(wrap.dataset.durationSec);
      if (!duration) return null;
      let pct = (clientX - rect.left) / rect.width;
      pct = Math.max(0, Math.min(1, pct));
      return pct * duration;
    }
    let dragWhich = null;
    let moveHandler = null;
    function onUp() {
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', moveHandler);
      document.removeEventListener('touchend', onUp);
    }
    function onMove(e) {
      if (e.touches) e.preventDefault();
      const sec = getSecFromEvent(e);
      if (sec == null) return;
      const startInput = modalForm.querySelector('[name="startSec"]');
      const endInput = modalForm.querySelector('[name="endSec"]');
      const duration = parseFloat(wrap.dataset.durationSec);
      let startSec = parseFloat(startInput.value) || 0;
      let endSec = parseFloat(endInput.value) || duration;
      if (dragWhich === 'start') {
        startSec = Math.max(0, Math.min(sec, endSec - 0.05));
        startInput.value = startSec.toFixed(2);
      } else {
        endSec = Math.min(duration, Math.max(sec, startSec + 0.05));
        endInput.value = endSec.toFixed(2);
      }
      updateTrimBar(duration);
    }
    function startDrag(which) {
      dragWhich = which;
      moveHandler = onMove;
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', moveHandler, { passive: false });
      document.addEventListener('touchend', onUp);
    }
    handleStart.addEventListener('mousedown', function (e) { e.preventDefault(); startDrag('start'); });
    handleStart.addEventListener('touchstart', function (e) { e.preventDefault(); startDrag('start'); }, { passive: false });
    handleEnd.addEventListener('mousedown', function (e) { e.preventDefault(); startDrag('end'); });
    handleEnd.addEventListener('touchstart', function (e) { e.preventDefault(); startDrag('end'); }, { passive: false });
  }

  function soundFromModalForm(baseSound) {
    const startSecRaw = modalForm.querySelector('[name="startSec"]').value.trim();
    const endSecRaw = modalForm.querySelector('[name="endSec"]').value.trim();
    const startMs = startSecRaw === '' ? null : Math.round(parseFloat(startSecRaw) * 1000);
    const endMs = endSecRaw === '' ? null : Math.round(parseFloat(endSecRaw) * 1000);
    return Schema.normalizeSoundV2(Object.assign({}, baseSound || {}, {
      title: modalForm.title.value.trim(),
      audioRef: modalForm.audioRef.value.trim(),
      imageRef: modalForm.imageRef.value.trim(),
      category: modalForm.category.value.trim(),
      hotkey: Hotkeys && Hotkeys.normalizeHotkeyInput
        ? Hotkeys.normalizeHotkeyInput(modalForm.hotkey.value.trim())
        : modalForm.hotkey.value.trim(),
      color: modalForm.color.value,
      volume: Number(modalForm.volume.value) / 100,
      playbackRate: Number(modalForm.playbackRate.value),
      loop: modalForm.loop.checked,
      momentary: modalForm.momentary.checked,
      startMs: startMs,
      endMs: endMs
    }));
  }

  function onEdit(sound) {
    editingId = sound.id;
    pendingAudioBlob = null;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    modalError.textContent = '';
    modalForm.title.value = sound.title || '';
    modalForm.audioRef.value = sound.audioRef || '';
    modalForm.imageRef.value = sound.imageRef || '';
    modalForm.category.value = sound.category || '';
    modalForm.hotkey.value = Hotkeys && Hotkeys.normalizeHotkeyInput
      ? Hotkeys.normalizeHotkeyInput(sound.hotkey || '')
      : (sound.hotkey || '');
    if (Hotkeys && Hotkeys.resetHotkeyCapture) Hotkeys.resetHotkeyCapture(modalForm.hotkey);
    modalForm.color.value = sound.color || '#4a9eff';
    modalForm.volume.value = Math.round((sound.volume != null ? sound.volume : 1) * 100);
    modalForm.playbackRate.value = sound.playbackRate != null ? sound.playbackRate : 1;
    modalForm.loop.checked = !!sound.loop;
    modalForm.momentary.checked = !!sound.momentary;
    const startSec = sound.startMs != null ? sound.startMs / 1000 : '';
    const endSec = sound.endMs != null ? sound.endMs / 1000 : '';
    modalForm.querySelector('[name="startSec"]').value = startSec === '' ? '' : String(Number(startSec.toFixed(2)));
    modalForm.querySelector('[name="endSec"]').value = endSec === '' ? '' : String(Number(endSec.toFixed(2)));
    const uploadHint = document.getElementById('uploaded-audio-hint');
    if (uploadHint) uploadHint.textContent = '';
    const uploadInput = document.getElementById('upload-audio-input');
    if (uploadInput) uploadInput.value = '';
    document.getElementById('volume-percent').textContent = modalForm.volume.value + '%';
    updateSpeedValue(modalForm.playbackRate.value);
    initTrimBarDrag();
    const play = Schema.soundForPlayback(sound);
    Audio.loadBuffer(play.fileUrl, play).then(function () {
      updateTrimBar();
    }).catch(function () {
      updateTrimBar();
    });
  }

  function closeModal() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    editingId = null;
    pendingAudioBlob = null;
    Audio.stopSound('preview');
  }

  function openBlerpModal() {
    if (!blerpModal) return;
    blerpModal.hidden = false;
    blerpModal.setAttribute('aria-hidden', 'false');
    if (blerpModalError) blerpModalError.textContent = '';
    if (blerpModalStatus) blerpModalStatus.textContent = '';
    if (blerpUrlInput) {
      blerpUrlInput.value = '';
      blerpUrlInput.focus();
      if (navigator.clipboard && navigator.clipboard.readText && BlerpImport && BlerpImport.looksLikeBlerpUrl) {
        navigator.clipboard.readText().then(function (text) {
          if (BlerpImport.looksLikeBlerpUrl(text) && blerpUrlInput && !blerpUrlInput.value) {
            blerpUrlInput.value = String(text).trim();
          }
        }).catch(function () {});
      }
    }
  }

  function closeBlerpModal() {
    if (!blerpModal) return;
    blerpModal.hidden = true;
    blerpModal.setAttribute('aria-hidden', 'true');
    if (blerpModalError) blerpModalError.textContent = '';
    if (blerpModalStatus) blerpModalStatus.textContent = '';
    if (blerpImportBtn) blerpImportBtn.disabled = false;
  }

  async function handleBlerpImport() {
    if (!BlerpImport || !blerpUrlInput) return;
    const url = blerpUrlInput.value.trim();
    if (blerpModalError) blerpModalError.textContent = '';
    if (blerpModalStatus) blerpModalStatus.textContent = 'Looking up sound…';
    if (blerpImportBtn) blerpImportBtn.disabled = true;

    try {
      const result = await BlerpImport.importFromUrl(url, getBoard());
      if (!result.ok) {
        if (result.duplicate && result.sound) {
          closeBlerpModal();
          alert('This sound is already on your board.');
          onEdit(result.sound);
          return;
        }
        if (blerpModalError) blerpModalError.textContent = result.error || 'Import failed.';
        if (blerpModalStatus) blerpModalStatus.textContent = '';
        return;
      }

      const board = getBoard();
      board.sounds.push(result.sound);
      Repo.setBoard(board);
      hotkeyMap = buildHotkeyMap();
      Audio.clearCache();
      render();
      closeBlerpModal();
      setStatus('Added from Blerp: ' + (result.sound.title || 'sound'), 3500);

      if (result.partial && result.warning) {
        alert(result.warning);
      }

      onEdit(result.sound);
    } catch (e) {
      console.warn('blerp import failed', e);
      if (blerpModalError) blerpModalError.textContent = 'Import failed. Check the link and try again.';
      if (blerpModalStatus) blerpModalStatus.textContent = '';
    } finally {
      if (blerpImportBtn) blerpImportBtn.disabled = false;
    }
  }

  function findSound(id) {
    const board = getBoard();
    return (board.sounds || []).find(function (s) { return String(s.id) === String(id); });
  }

  function getImportMode() {
    const replace = document.getElementById('import-mode-replace');
    return replace && replace.checked ? 'replace' : 'merge';
  }

  async function handleImport(file) {
    if (!file) return;
    setStatus('Importing…');
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
    const result = await ImportSvc.importFile(file, {
      mode: getImportMode(),
      hydrateRemote: isMobile,
      onProgress: function (t) { setStatus(t); }
    });
    if (!result.ok) {
      setStatus('Import failed: ' + (result.error || 'unknown'));
      alert('Import failed: ' + (result.error || 'unknown'));
      return;
    }
    errorIds.clear();
    Audio.clearCache();
    quickAccessCollapsed = loadQuickAccessCollapsedState();
    await prewarmBlobImages(result.board.sounds);
    Audio.preloadSounds(soundsForRender(result.board.sounds));
    render();
    if (result.mergeStats) {
      const st = result.mergeStats;
      setStatus('Merged: ' + st.added + ' added, ' + st.skipped + ' skipped.', 4000);
    } else {
      setStatus('Import complete.', 3000);
    }
  }

  async function downloadMedia() {
    setStatus('Copying audio into shared storage…');
    const work = JSON.parse(JSON.stringify(getBoard()));
    const before = new Map(work.sounds.map(function (s) { return [String(s.id), s.audioRef]; }));
    const r = await ImportSvc.hydrateRemoteAudio(work, {
      onProgress: function (t) { setStatus(t); }
    });
    const board = getBoard();
    work.sounds.forEach(function (ws) {
      const cs = board.sounds.find(function (x) { return String(x.id) === String(ws.id); });
      if (cs && ws.audioRef !== before.get(String(ws.id)) && cs.audioRef === before.get(String(ws.id))) {
        cs.audioRef = ws.audioRef;
      }
    });
    Repo.setBoard(board);
    await Repo.saveNow();
    Audio.clearCache();
    Audio.preloadSounds(soundsForRender(board.sounds));
    setStatus('Copied ' + r.hydrated + ' audio file(s) into shared storage for all computers.', 4000);
    render();
  }

  function buildHotkeyMap() {
    const board = getBoard();
    const map = new Map();
    (board.sounds || []).forEach(function (s) {
      const hk = Hotkeys && Hotkeys.normalizeHotkeyInput
        ? Hotkeys.normalizeHotkeyInput(s.hotkey || '')
        : String(s.hotkey || '').trim();
      if (!hk) return;
      s.hotkey = hk;
      if (!map.has(hk)) map.set(hk, s);
    });
    return map;
  }

  let hotkeyMap = new Map();

  function shouldAnalyzeSound(sound) {
    if (!sound || !sound.audioRef) return false;
    const gain = sound.extra && typeof sound.extra === 'object' ? sound.extra.normGain : null;
    return !(typeof gain === 'number' && isFinite(gain));
  }

  function analyzeAllSounds(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const onlyMissing = opts.onlyMissing === true;
    const silent = opts.silent === true;
    if (analyzeInProgress) return;
    const board = getBoard();
    if (!board || !board.sounds || board.sounds.length === 0) {
      if (!silent) setStatus('No sounds to analyze.');
      return;
    }
    if (!Audio || !Audio.analyzeFileUrl) {
      if (!silent) setStatus('Volume analysis is unavailable.');
      return;
    }
    const sounds = board.sounds.slice().filter(function (s) {
      return onlyMissing ? shouldAnalyzeSound(s) : !!s.audioRef;
    });
    if (sounds.length === 0) return;

    analyzeInProgress = true;
    let i = 0;
    let updated = 0;
    const total = sounds.length;
    if (!silent) setStatus('Analyzing volume 0/' + total + '…');

    const results = new Map();
    function step() {
      if (i >= total) {
        if (updated > 0) {
          // Apply to the board as it is NOW (it may have been refreshed meanwhile).
          const current = getBoard();
          (current.sounds || []).forEach(function (cs) {
            const r = results.get(String(cs.id));
            if (!r || cs.audioRef !== r.audioRef) return;
            if (!cs.extra || typeof cs.extra !== 'object') cs.extra = {};
            Object.assign(cs.extra, r.extra);
          });
          Repo.setBoard(current);
        }
        analyzeInProgress = false;
        if (!silent) setStatus('Volume analysis complete (' + updated + ' updated).', 3000);
        return;
      }
      const s = sounds[i++];
      if (!s || !s.audioRef) {
        setTimeout(step, 0);
        return;
      }
      if (!s.extra || typeof s.extra !== 'object') s.extra = {};
      const play = Schema.soundForPlayback(s);
      Audio.analyzeFileUrl(play.fileUrl, play).then(function (res) {
        if (res && typeof res.gain === 'number' && isFinite(res.gain)) {
          s.extra.normGain = res.gain;
          s.extra.normAnalyzedAt = new Date().toISOString();
          s.extra.normAlgoVersion = res.algoVersion || 1;
          results.set(String(s.id), {
            audioRef: s.audioRef,
            extra: { normGain: s.extra.normGain, normAnalyzedAt: s.extra.normAnalyzedAt, normAlgoVersion: s.extra.normAlgoVersion }
          });
          updated++;
        }
      }).catch(function () {}).finally(function () {
        if (!silent) setStatus('Analyzing volume ' + i + '/' + total + '…');
        setTimeout(step, 0);
      });
    }
    step();
  }

  function runAutoAnalyzeOnLoad() {
    if (!Audio || !Audio.analyzeFileUrl) return;
    if (!Audio.getAutoLevelEnabled || !Audio.getAutoLevelEnabled()) return;
    analyzeAllSounds({ onlyMissing: true, silent: true });
  }

  function wireEvents() {
    document.querySelector('[data-action="add"]').addEventListener('click', function () {
      const s = Schema.createDefaultSound({ title: 'New Sound', audioRef: '', category: 'Uncategorized' });
      const board = getBoard();
      board.sounds.push(s);
      Repo.setBoard(board);
      render();
      onEdit(s);
    });

    const addBlerpBtn = document.querySelector('[data-action="add-blerp"]');
    if (addBlerpBtn) addBlerpBtn.addEventListener('click', openBlerpModal);

    if (blerpImportBtn) blerpImportBtn.addEventListener('click', handleBlerpImport);
    if (blerpUrlInput) {
      blerpUrlInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleBlerpImport();
        }
      });
    }
    if (blerpModal) {
      blerpModal.querySelectorAll('[data-blerp-dismiss]').forEach(function (el) {
        el.addEventListener('click', closeBlerpModal);
      });
    }

    document.querySelector('[data-action="export"]').addEventListener('click', function () {
      ExportSvc.exportJson(getBoard());
    });

    document.querySelector('[data-action="export-portable"]').addEventListener('click', function () {
      setStatus('Building ZIP…');
      ExportSvc.exportPortableZip(getBoard(), {
        onProgress: function (t) { setStatus(t); }
      }).then(function () {
        setStatus('ZIP exported.', 3000);
      }).catch(function (e) {
        setStatus('Export failed.');
        console.warn(e);
      });
    });

    document.querySelector('[data-action="download-media"]').addEventListener('click', function () {
      downloadMedia().catch(function (e) { console.warn(e); });
    });

    document.querySelector('[data-action="reinitialize"]').addEventListener('click', function () {
      Audio.reinitializeAudio({ clearCache: true }).then(function () {
        const board = getBoard();
        Audio.preloadSounds(soundsForRender(board.sounds));
        setStatus('Sounds reinitialized.', 2500);
      });
    });

    const analyzeAllBtn = document.querySelector('[data-action="analyze-all"]');
    if (analyzeAllBtn) analyzeAllBtn.addEventListener('click', function () {
      analyzeAllSounds();
    });

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
        if (enabled) runAutoAnalyzeOnLoad();
      });
    }

    document.querySelector('[data-action="clear-data"]').addEventListener('click', function () {
      if (!confirm('Clear this computer\'s saved copy and reload the shared board?\n\n(The shared board other computers use is not changed. To replace it, use Import → Replace entire board.)')) return;
      Repo.clearAll().then(function () {
        return Repo.loadInitial();
      }).then(function () {
        errorIds.clear();
        applyLocalRecents(getBoard());
        hotkeyMap = buildHotkeyMap();
        quickAccessCollapsed = loadQuickAccessCollapsedState();
        render();
        Audio.clearCache();
        Audio.preloadSounds(soundsForRender(getBoard().sounds));
        setStatus('Cleared this computer\'s copy and reloaded the shared board.', 3500);
      });
    });

    importDropzone.addEventListener('click', function () { importInput.click(); });
    importInput.addEventListener('change', function (e) {
      if (e.target.files[0]) handleImport(e.target.files[0]);
      e.target.value = '';
    });
    importDropzone.addEventListener('dragover', function (e) { e.preventDefault(); });
    importDropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer.files[0]) handleImport(e.dataTransfer.files[0]);
    });

    modalForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const soundId = editingId;
      const before = findSound(soundId);
      if (!before) return closeModal();
      const updated = soundFromModalForm(before);
      if (pendingAudioBlob) {
        const file = pendingAudioBlob;
        pendingAudioBlob = null;
        const bytes = file.arrayBuffer ? await file.arrayBuffer() : file;
        setStatus('Uploading audio…');
        try {
          updated.audioRef = await Repo.uploadMedia(bytes, file.type || 'audio/mpeg', 'audio');
          setStatus('Audio uploaded for all computers.', 3000);
        } catch (err) {
          await Repo.putBlob('audio:' + soundId, bytes, file.type || 'audio/mpeg');
          updated.audioRef = 'blob:audio:' + soundId;
          setStatus('Could not upload the audio (' + (err && err.message ? err.message : 'error') + '). It only plays on this computer until you reload while signed in.', 8000);
        }
      }
      // Look the sound up again: the board may have been refreshed from
      // another computer while the upload was running.
      const sound = findSound(soundId);
      if (sound) Object.assign(sound, updated);
      const board = getBoard();
      Repo.setBoard(board);
      hotkeyMap = buildHotkeyMap();
      Audio.clearCache();
      closeModal();
      render();
    });

    modal.querySelector('[data-action="cancel"]').addEventListener('click', closeModal);
    modal.querySelector('[data-action="delete"]').addEventListener('click', function () {
      if (!editingId || !confirm('Delete this sound?')) return;
      const board = getBoard();
      board.sounds = board.sounds.filter(function (s) { return String(s.id) !== String(editingId); });
      Repo.setBoard(board);
      closeModal();
      render();
    });
    modal.querySelector('[data-action="preview"]').addEventListener('click', function () {
      const sound = findSound(editingId);
      if (!sound) return;
      const tmp = soundFromModalForm(sound);
      if (pendingAudioBlob) {
        const url = URL.createObjectURL(pendingAudioBlob);
        tmp.audioRef = url;
        tmp.fileUrl = url;
      }
      const play = Schema.soundForPlayback(tmp);
      play.id = 'preview';
      Audio.resumeContext().then(function () {
        return Audio.playPreviewSound(play, { loop: false });
      }).then(function () {
        updateTrimBar(Audio.getDurationSeconds(play.fileUrl));
      }).catch(function () {
        modalError.textContent = 'Preview failed — check audio URL or upload a file.';
      });
    });
    modal.querySelector('.modal__backdrop').addEventListener('click', closeModal);

    modalForm.volume.addEventListener('input', function () {
      document.getElementById('volume-percent').textContent = modalForm.volume.value + '%';
    });

    modalForm.playbackRate.addEventListener('input', function () {
      updateSpeedValue(modalForm.playbackRate.value);
    });

    modalForm.querySelector('[name="startSec"]').addEventListener('input', function () {
      updateTrimBar();
    });
    modalForm.querySelector('[name="endSec"]').addEventListener('input', function () {
      updateTrimBar();
    });

    const uploadInput = document.getElementById('upload-audio-input');
    if (uploadInput) {
      uploadInput.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        const hint = document.getElementById('uploaded-audio-hint');
        if (!file) return;
        pendingAudioBlob = file;
        if (hint) hint.textContent = 'Ready to save: ' + file.name;
        const url = URL.createObjectURL(file);
        Audio.loadBuffer(url, { fileUrl: url }).then(function () {
          updateTrimBar(Audio.getDurationSeconds(url));
        });
      });
    }

    modalForm.audioRef.addEventListener('change', function () {
      const sound = findSound(editingId);
      if (!sound) return;
      const play = Schema.soundForPlayback(Object.assign({}, sound, { audioRef: modalForm.audioRef.value.trim() }));
      Audio.loadBuffer(play.fileUrl, play).then(function () {
        updateTrimBar();
      }).catch(function () {
        updateTrimBar();
      });
    });

    if (modalForm.hotkey && Hotkeys) {
      modalForm.hotkey.addEventListener('keydown', function (e) {
        Hotkeys.captureHotkeyFromInputKeydown(e);
      });
      modalForm.hotkey.addEventListener('keyup', function (e) {
        Hotkeys.captureHotkeyFromInputKeyup(e);
      });
      modalForm.hotkey.addEventListener('change', function () {
        modalForm.hotkey.value = Hotkeys.normalizeHotkeyInput(modalForm.hotkey.value);
      });
    }

    const hotkeyClearBtn = document.getElementById('hotkey-clear');
    if (hotkeyClearBtn && modalForm.hotkey && Hotkeys && Hotkeys.clearHotkeyField) {
      hotkeyClearBtn.addEventListener('click', function () {
        Hotkeys.clearHotkeyField(modalForm.hotkey);
        modalForm.hotkey.focus();
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        searchQuery = searchInput.value;
        render();
      });
    }
    document.getElementById('search-clear').addEventListener('click', function () {
      searchInput.value = '';
      searchQuery = '';
      render();
    });

    if (favouritesReorderToggleEl) {
      favouritesReorderToggleEl.addEventListener('click', function () {
        favouriteReorderMode = !favouriteReorderMode;
        render();
      });
    }
    if (favouritesRowsSelectEl) {
      favouritesRowsSelectEl.addEventListener('change', function () {
        setFavouriteStripRows(favouritesRowsSelectEl.value);
      });
    }
    if (recentsRowsSelectEl) {
      recentsRowsSelectEl.addEventListener('change', function () {
        setRecentStripRows(recentsRowsSelectEl.value);
      });
    }
    if (recentsCollapseToggleEl) {
      recentsCollapseToggleEl.addEventListener('click', function () {
        toggleQuickAccessSectionCollapse('recents');
      });
    }
    if (favouritesCollapseToggleEl) {
      favouritesCollapseToggleEl.addEventListener('click', function () {
        toggleQuickAccessSectionCollapse('favourites');
      });
    }

    if (globalVolume) {
      globalVolume.addEventListener('input', function () {
        Audio.setMasterVolumeFromPercent(Number(globalVolume.value));
        if (globalVolumeLabel) globalVolumeLabel.textContent = 'Volume ' + globalVolume.value + '%';
      });
    }

    const popout = document.getElementById('header-popout');
    const toggle = document.getElementById('header-toggle');
    toggle.addEventListener('click', function () {
      const open = popout.hidden;
      popout.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.getElementById('header-popout-close').addEventListener('click', function () {
      popout.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    });
    popout.querySelector('.header__popout-backdrop').addEventListener('click', function () {
      popout.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    });

    if (boardNameEl) {
      boardNameEl.addEventListener('click', function () {
        const board = getBoard();
        const name = prompt('Board name:', board.name || '');
        if (name == null) return;
        board.name = String(name).trim() || board.name;
        Repo.setBoard(board);
        render();
      });
    }

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') Repo.saveNow();
    });
  }

  /** Another computer changed the board (or our save was merged with theirs). */
  function onSharedBoardChanged(board, reason) {
    if (!board) return;
    applyLocalRecents(board);
    hotkeyMap = buildHotkeyMap();
    render();
    Audio.preloadSounds(soundsForRender(board.sounds));
    if (reason === 'remote-change') setStatus('Updated with changes from another computer.', 3000);
  }

  /**
   * Older versions saved some sounds only inside one browser. Upload them (if this
   * browser has them) or restore their original source, so they play everywhere.
   */
  async function repairBrowserOnlySounds() {
    const board = getBoard();
    if (!board || !Repo.repairBrowserOnlyRefs) return;
    try {
      const r = await Repo.repairBrowserOnlyRefs(board, {
        onProgress: function (i, total) { setStatus('Sharing sounds saved on this computer ' + i + '/' + total + '…'); }
      });
      if (!r.changed && !r.missing) return;
      if (r.changed) {
        Repo.setBoard(getBoard(), { save: false });
        // Save first, so the "Saved" status doesn't replace the message below.
        await Repo.saveNow();
        hotkeyMap = buildHotkeyMap();
        Audio.clearCache();
        render();
        Audio.preloadSounds(soundsForRender(getBoard().sounds));
      }
      let msg = r.changed ? 'Shared ' + r.fixed + ' file(s) so every computer can play them.' : '';
      if (r.missing) {
        msg += (msg ? ' ' : '') + r.missing + ' sound(s) were saved only on another computer — open the sound board there once to share them.';
      }
      setStatus(msg, 8000);
    } catch (err) {
      console.warn('soundboard: repair failed', err);
    }
  }

  function initHotkeyKeyboard() {
    if (!Hotkeys || !Hotkeys.initKeyboard) return;
    Hotkeys.initKeyboard({
      getHotkeyMap: function () { return hotkeyMap; },
      onPlay: onPlay,
      isBlocked: function (e) {
        if (modal && !modal.hidden) return true;
        if (blerpModal && !blerpModal.hidden) return true;
        const popout = document.getElementById('header-popout');
        if (popout && !popout.hidden && e.target && popout.contains(e.target)) return true;
        return false;
      },
      onMomentaryCancel: function () {
        Audio.stopSound();
        playingId = null;
        render();
      }
    });
  }

  async function init() {
    wireEvents();
    initHotkeyKeyboard();
    favouriteStripRows = loadFavouriteStripRows();
    recentStripRows = loadRecentStripRows();
    setStatus('Loading board…');
    try {
      const result = await Repo.loadInitial();
      const board = result.board;
      applyLocalRecents(board);
      hotkeyMap = buildHotkeyMap();
      quickAccessCollapsed = loadQuickAccessCollapsedState();
      await prewarmBlobImages(board.sounds);
      render();
      Audio.preloadSounds(soundsForRender(board.sounds));
      if (globalVolume && Audio.setMasterVolumeFromPercent) {
        Audio.setMasterVolumeFromPercent(Number(globalVolume.value));
      }
      if (autoLevelToggleEl && Audio.getAutoLevelEnabled && Audio.getAutoLevelEnabled()) {
        runAutoAnalyzeOnLoad();
      }
      let statusMsg = 'Loaded ' + board.sounds.length + ' sounds (' + result.source + ').';
      if (result.added > 0) {
        statusMsg = 'Added ' + result.added + ' new sound(s) from default board: ' + (result.addedTitles || []).join(', ') + '.';
      }
      setStatus(statusMsg, result.added > 0 ? 6000 : 3500);
      Repo.startSync({
        onRemoteBoard: onSharedBoardChanged,
        isBusy: function () {
          return (modal && !modal.hidden) || (blerpModal && !blerpModal.hidden) || analyzeInProgress;
        }
      });
      repairBrowserOnlySounds();
    } catch (err) {
      console.error(err);
      setStatus('Failed to load board. Check console.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
