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
  const activeMomentaryKeys = new Set();

  const gridEl = document.getElementById('sound-grid');
  const toolbarEl = document.getElementById('toolbar');
  const importInput = document.getElementById('import-input');
  const importDropzoneEl = document.getElementById('import-dropzone');
  const modalEl = document.getElementById('modal');
  const modalForm = document.getElementById('modal-form');
  const modalError = document.getElementById('modal-error');
  const boardNameEl = document.getElementById('board-name');
  const downloadStatus = document.getElementById('download-status');
  const storageInfoEl = document.getElementById('storage-info');
  const fileModeControlsEl = document.getElementById('file-mode-controls');
  const fileModeAttachBtn = document.getElementById('file-mode-attach');
  const fileModeDetachBtn = document.getElementById('file-mode-detach');
  const fileModeStatusEl = document.getElementById('file-mode-status');
  const globalVolumeEl = document.getElementById('global-volume');
  const globalVolumeLabel = document.getElementById('global-volume-label');
  const durationHint = document.getElementById('duration-hint');
  const searchInputEl = document.getElementById('search-input');
  const searchClearEl = document.getElementById('search-clear');
  const searchCountEl = document.getElementById('search-count');
  const autoLevelToggleEl = document.getElementById('auto-level-toggle');
  const quickBarEl = document.getElementById('quick-bar');
  const themeToggleBtn = toolbarEl && toolbarEl.querySelector('[data-action="theme-toggle"]');
  const quickThemeBtn = quickBarEl && quickBarEl.querySelector('[data-action="quick-theme"]');
  const settingsScreenEl = document.getElementById('settings-screen');
  const settingsListEl = document.getElementById('settings-list');
  const settingsSearchEl = document.getElementById('settings-search');
  const settingsSearchCountEl = document.getElementById('settings-search-count');
  const categoryOptionsEl = document.getElementById('category-options');
  const settingsFeedbackEl = document.getElementById('settings-feedback');
  const settingsLoadMoreBtn = document.getElementById('settings-load-more');
  const settingsRenderedCountEl = document.getElementById('settings-rendered-count');
  const settingsClearSearchBtn = document.getElementById('settings-clear-search');
  const languageSelectEl = document.getElementById('language-select');
  const helpScreenEl = document.getElementById('help-screen');
  const headerEl = document.querySelector('.header');
  const headerToggleBtn = document.getElementById('header-toggle');
  const headerPopoutEl = document.getElementById('header-popout');
  const headerPopoutCloseBtn = document.getElementById('header-popout-close');
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
  const portableReportEl = document.getElementById('portable-report');
  const portableReportCloseBtn = document.getElementById('portable-report-close');
  const portableReportCopyBtn = document.getElementById('portable-report-copy');
  const portableReportTitleEl = document.getElementById('portable-report-title');
  const portableReportSummaryEl = document.getElementById('portable-report-summary');
  const portableReportListEl = document.getElementById('portable-report-list');

  function getBoardJsonPath() {
    const base = window.location.pathname.replace(/\/[^/]*$/, '') || '/';
    return base + (base.endsWith('/') ? '' : '/') + 'boards/sample-board.json';
  }

  const CATEGORY_UI_KEY_PREFIX = 'soundboard-category-state:';
  const CATEGORY_ORDER_KEY_PREFIX = 'soundboard-category-order:';
  const AUTO_LEVEL_KEY = 'soundboard-auto-level';
  const LANGUAGE_KEY = 'soundboard-language';
  const THEME_KEY = 'soundboard-theme';
  const FAVOURITES_KEY_PREFIX = 'soundboard-favourites:';
  const RECENTS_KEY_PREFIX = 'soundboard-recents:';

  // Allowed values: 'system' (default), 'light', 'dark'
  let themePreference = 'system';
  const QUICK_ACCESS_COLLAPSED_KEY_PREFIX = 'soundboard-quick-access-collapsed:';
  const FAVOURITES_ROWS_KEY = 'soundboard-favourites-rows';
  const RECENTS_ROWS_KEY = 'soundboard-recents-rows';
  const FAVOURITES_ROWS_MIN = 1;
  const FAVOURITES_ROWS_MAX = 4;
  const MAX_RECENT_SOUNDS = 20;
  const SETTINGS_BATCH_SIZE = 80;
  const I18N = {
    en: {
      'header.hint': 'Tip: click the board name to rename it.',
      'header.moreButton': 'Settings',
      'header.menu.settings': 'Manage All Sounds',
      'header.menu.help': 'How to Use',
      'header.menu.compactOn': 'Compact Top Bar: On',
      'header.menu.compactOff': 'Compact Top Bar: Off',
      'toolbar.group.create': 'Create/Edit',
      'toolbar.add': 'Add Sound',
      'toolbar.webAdd': 'Add Web Sound',
      'toolbar.webAddTitle': 'Paste a Blerp or YouTube link to auto-import',
      'toolbar.manageAll': 'Manage All Sounds',
      'toolbar.manageAllTitle': 'Edit all sounds in one long list',
      'toolbar.reorder': 'Reorder',
      'toolbar.reorderTitle': 'Toggle reorder mode to drag and drop tiles',
      'toolbar.help': 'How to Use',
      'toolbar.group.board': 'Board File',
      'toolbar.export': 'Export Board',
      'toolbar.exportPortable': 'Export Portable ZIP',
      'toolbar.exportPortableTitle': 'Export a .zip with board + audio + images (offline portable)',
      'toolbar.portableCheck': 'Portable readiness check',
      'toolbar.portableCheckTitle': 'Check if your board is ready for portable ZIP (offline) export',
      'toolbar.clearData': 'Clear All Data',
      'toolbar.clearDataTitle': 'Clear all saved board/app data and reset to defaults',
      'toolbar.importDropzone': 'Import Sounds (Drag and drop or click)',
      'toolbar.importDropzoneTitle': 'Import sounds: drag and drop a .json board file, or click to choose one',
      'toolbar.group.audio': 'Audio Tools',
      'toolbar.downloadMedia': 'Download media',
      'toolbar.downloadMediaTitle': 'Download audio + images, save into the app, and update the board to use local copies',
      'toolbar.autoLevel': 'Auto level',
      'toolbar.analyzeAll': 'Analyze all',
      'toolbar.analyzeAllTitle': 'Analyze all sounds for consistent volume (recommended once per board)',
      'toolbar.group.search': 'Search',
      'toolbar.group.language': 'Language',
      'toolbar.language': 'Language',
      'search.placeholder': 'Search (title or category)…',
      'search.clear': 'Clear',
      'quick.add': 'Add',
      'quick.web': 'Web',
      'quick.search': 'Search',
      'quick.hotkeys': 'Hotkeys',
      'quick.settings': 'Settings',
      'quick.help': 'Help',
      'quick.reorder': 'Reorder',
      'quick.analyze': 'Analyze',
      'help.title': 'How to Use',
      'help.close': 'Close',
      'help.enHeader': 'English Guide',
      'help.enIntro': 'Use this soundboard to quickly play, organize, and manage sounds.',
      'help.en1': 'Add sounds with Add Sound or Add Web Sound.',
      'help.en2': 'Edit a tile with the pencil icon (or right-click on desktop).',
      'help.en3': 'Assign hotkeys like Q, Shift+A, or Shift+.',
      'help.en4': 'Use Hotkeys only to show only sounds with hotkeys.',
      'help.en5': 'Use Reorder to drag sounds/categories into new positions.',
      'help.en6': 'Use Manage All Sounds for bulk editing and saving.',
      'help.hotkeysHeader': 'Useful Hotkeys for default sounds',
      'help.hk1': '3 - Mario Kart 3-2-1 Go',
      'help.hk2': 'X - Wrong answer buzzer',
      'help.hk3': 'R - Great!',
      'help.hk4': 'A - Anime Wow',
      'help.hk5': '9 - Sad music',
      'help.hk6': 'P - Perfect',
      'help.hk7': 'M - Stop, wait a minute',
      'help.hk8': 'V - Victory sound',
      'help.hk9': '1 - One more Time',
      'help.koHeader': 'Korean Guide',
      'help.koIntro': 'Korean instructions are shown below for bilingual users.',
      'help.ko1': 'You can switch app language at any time.',
      'help.ko2': 'Use this section as a Korean reference.',
      'help.ko3': 'Hotkeys support combos like Shift+A and Shift+.',
      'help.ko4': 'Use Hotkeys only to filter assigned sounds.',
      'help.ko5': 'Use Reorder to drag and reorder.',
      'help.ko6': 'Use Manage All Sounds for bulk edits.',
      'hotkey.only.on': 'Hotkeys only: ON',
      'hotkey.only.off': 'Hotkeys only',
      'search.hotkeysSuffix': ' hotkeys',
      'settings.loadedCount': 'Loaded {loaded} of {total} rows',
      'label.volume': 'Volume {pct}%',
      'status.noSoundsToAnalyze': 'No sounds to analyze.',
      'status.analysisUnavailable': 'Analysis not available.',
      'status.analyzingProgress': 'Analyzing {current}/{total}…',
      'status.analyzeComplete': 'Analyze complete.',
      'status.invalidImportFile': 'Please drop a valid .json or .zip board file.',
      'status.clearedAllData': 'All saved data cleared. Loaded default board.',
      'confirm.clearAllData': 'Clear all saved data (board, settings, local audio cache) and reset to defaults?',
      'board.defaultName': 'Soundboard',
      'board.renameTitle': 'Click to change board name',
      'ui.dragToReorderPrefix': 'Drag to reorder',
      'ui.playPrefix': 'Play',
      'ui.noSounds': 'No sounds. Add a sound or import a board.',
      'ui.noSearchMatches': 'No sounds match your search.',
      'quickAccess.favourites': 'Favourites',
      'quickAccess.recents': 'Recents',
      'quickAccess.emptyFavourites': 'No favourites yet. Tap the star on a sound tile.',
      'quickAccess.emptyRecents': 'No recent plays yet. Play a sound to populate this list.',
      'quickAccess.rowsLabel': 'Rows',
      'quickAccess.reorderFavourites': 'Reorder',
      'quickAccess.doneReorderingFavourites': 'Done',
      'quickAccess.collapse': 'Collapse',
      'quickAccess.expand': 'Expand',
      'quickAccess.soundCount': '{count} sounds'
    },
    ko: {
      'header.hint': '팁: 보드 이름을 클릭하면 이름을 변경할 수 있습니다.',
      'header.moreButton': '설정',
      'header.menu.settings': '전체 사운드 관리',
      'header.menu.help': '사용 방법',
      'header.menu.compactOn': '상단바 간단 모드: 켜짐',
      'header.menu.compactOff': '상단바 간단 모드: 꺼짐',
      'toolbar.group.create': '생성/편집',
      'toolbar.add': '사운드 추가',
      'toolbar.webAdd': '웹 사운드 추가',
      'toolbar.webAddTitle': 'Blerp 또는 YouTube 링크를 붙여넣어 자동 가져오기',
      'toolbar.manageAll': '전체 사운드 관리',
      'toolbar.manageAllTitle': '긴 목록에서 모든 사운드 편집',
      'toolbar.reorder': '순서 변경',
      'toolbar.reorderTitle': '순서 변경 모드를 켜고 타일을 드래그하세요',
      'toolbar.help': '사용 방법',
      'toolbar.group.board': '보드 파일',
      'toolbar.export': '보드 내보내기',
      'toolbar.exportPortable': '휴대용 ZIP 내보내기',
      'toolbar.exportPortableTitle': '보드 + 오디오 + 이미지가 포함된 .zip 내보내기(오프라인용)',
      'toolbar.portableCheck': '휴대용 준비 상태 점검',
      'toolbar.portableCheckTitle': '보드가 휴대용 ZIP(오프라인) 내보내기 준비가 되었는지 점검',
      'toolbar.clearData': '전체 데이터 삭제',
      'toolbar.clearDataTitle': '저장된 보드/앱 데이터를 모두 삭제하고 기본값으로 재설정',
      'toolbar.importDropzone': '사운드 가져오기 (드래그 앤 드롭 또는 클릭)',
      'toolbar.importDropzoneTitle': '사운드 가져오기: .json 보드 파일을 드래그 앤 드롭하거나 클릭해 선택하세요',
      'toolbar.group.audio': '오디오 도구',
      'toolbar.downloadMedia': '미디어 다운로드',
      'toolbar.downloadMediaTitle': '오디오 + 이미지를 다운로드해 앱에 저장하고 로컬 파일로 업데이트',
      'toolbar.autoLevel': '자동 레벨',
      'toolbar.analyzeAll': '전체 분석',
      'toolbar.analyzeAllTitle': '모든 사운드를 분석해 볼륨을 맞춥니다(보드당 1회 권장)',
      'toolbar.group.search': '검색',
      'toolbar.group.language': '언어',
      'toolbar.language': '언어',
      'search.placeholder': '검색 (제목 또는 카테고리)…',
      'search.clear': '지우기',
      'quick.add': '추가',
      'quick.web': '웹',
      'quick.search': '검색',
      'quick.hotkeys': '단축키',
      'quick.settings': '설정',
      'quick.help': '도움말',
      'quick.reorder': '정렬',
      'quick.analyze': '분석',
      'help.title': '사용 방법',
      'help.close': '닫기',
      'help.enHeader': 'English Guide',
      'help.enIntro': 'For English instructions, read this section.',
      'help.en1': 'Add sounds with Add Sound or Add Web Sound.',
      'help.en2': 'Edit a tile with the pencil icon (or right-click on desktop).',
      'help.en3': 'Assign hotkeys like Q, Shift+A, or Shift+.',
      'help.en4': 'Use Hotkeys only to show only sounds with hotkeys.',
      'help.en5': 'Use Reorder to drag sounds/categories into new positions.',
      'help.en6': 'Use Manage All Sounds for bulk editing and saving.',
      'help.hotkeysHeader': '기본 사운드 유용한 단축키',
      'help.hk1': '3 - Mario Kart 3-2-1 Go',
      'help.hk2': 'X - 오답 버저',
      'help.hk3': 'R - Great!',
      'help.hk4': 'A - Anime Wow',
      'help.hk5': '9 - 슬픈 음악',
      'help.hk6': 'P - Perfect',
      'help.hk7': 'M - Stop, wait a minute',
      'help.hk8': 'V - 승리 사운드',
      'help.hk9': '1 - One more Time',
      'help.koHeader': '한국어 안내',
      'help.koIntro': '이 사운드보드는 사운드를 빠르게 재생하고 정리/관리할 수 있도록 만들어졌습니다.',
      'help.ko1': 'Add Sound 또는 Add Web Sound로 사운드를 추가하세요.',
      'help.ko2': '타일의 연필 아이콘(PC는 우클릭)으로 편집할 수 있습니다.',
      'help.ko3': 'Q, Shift+A, Shift+. 같은 단축키를 지정할 수 있습니다.',
      'help.ko4': 'Hotkeys only로 단축키가 있는 사운드만 볼 수 있습니다.',
      'help.ko5': 'Reorder에서 드래그하여 사운드/카테고리 순서를 바꿀 수 있습니다.',
      'help.ko6': 'Manage All Sounds에서 전체 일괄 편집 후 저장할 수 있습니다.',
      'hotkey.only.on': '단축키만 보기: 켜짐',
      'hotkey.only.off': '단축키만',
      'search.hotkeysSuffix': ' 단축키',
      'settings.loadedCount': '{total}개 중 {loaded}개 로드됨',
      'label.volume': '볼륨 {pct}%',
      'status.noSoundsToAnalyze': '분석할 사운드가 없습니다.',
      'status.analysisUnavailable': '분석 기능을 사용할 수 없습니다.',
      'status.analyzingProgress': '{current}/{total} 분석 중…',
      'status.analyzeComplete': '분석 완료.',
      'status.invalidImportFile': '올바른 .json 또는 .zip 보드 파일을 드롭해 주세요.',
      'status.clearedAllData': '저장된 모든 데이터를 삭제하고 기본 보드를 불러왔습니다.',
      'confirm.clearAllData': '저장된 모든 데이터(보드, 설정, 로컬 오디오 캐시)를 삭제하고 기본값으로 재설정할까요?',
      'board.defaultName': '사운드보드',
      'board.renameTitle': '클릭하여 보드 이름 변경',
      'ui.dragToReorderPrefix': '드래그하여 순서 변경',
      'ui.playPrefix': '재생',
      'ui.noSounds': '사운드가 없습니다. 사운드를 추가하거나 보드를 가져오세요.',
      'ui.noSearchMatches': '검색 결과가 없습니다.',
      'quickAccess.favourites': '즐겨찾기',
      'quickAccess.recents': '최근 재생',
      'quickAccess.emptyFavourites': '아직 즐겨찾기가 없습니다. 사운드 타일의 별을 눌러 추가하세요.',
      'quickAccess.emptyRecents': '최근 재생 목록이 비어 있습니다. 사운드를 재생하면 여기에 표시됩니다.',
      'quickAccess.rowsLabel': '행',
      'quickAccess.reorderFavourites': '순서 변경',
      'quickAccess.doneReorderingFavourites': '완료',
      'quickAccess.collapse': '접기',
      'quickAccess.expand': '펼치기',
      'quickAccess.soundCount': '{count}개'
    }
  };
  let currentLanguage = 'en';
  let searchQuery = '';
  let showHotkeyOnly = false;
  let categoryUiState = {};
  let categoryOrder = [];
  let favouriteIds = new Set();
  let recentIds = [];
  let favouriteStripRows = 1;
  let recentStripRows = 1;
  let favouriteReorderMode = false;
  let quickAccessCollapsed = { recents: false, favourites: false };
  let settingsDirty = false;
  let settingsRenderIndex = 0;
  let settingsPreviouslyFocused = null;
  let analyzeInProgress = false;

  function hasTranslationKey(key) {
    const dict = I18N[currentLanguage] || {};
    if (Object.prototype.hasOwnProperty.call(dict, key)) return true;
    return Object.prototype.hasOwnProperty.call(I18N.en || {}, key);
  }

  function t(key, vars = {}) {
    const dict = I18N[currentLanguage] || I18N.en;
    const template = dict[key] || I18N.en[key];
    if (template == null) return null;
    return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : '';
    });
  }

  function applyTranslations() {
    const textEls = Array.from(document.querySelectorAll('[data-i18n]'));
    textEls.forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key || !hasTranslationKey(key)) return;
      const translated = t(key);
      if (translated != null) el.textContent = translated;
    });
    const titleEls = Array.from(document.querySelectorAll('[data-i18n-title]'));
    titleEls.forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (!key || !hasTranslationKey(key)) return;
      const translated = t(key);
      if (translated != null) el.title = translated;
    });
    const placeholderEls = Array.from(document.querySelectorAll('[data-i18n-placeholder]'));
    placeholderEls.forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (!key || !hasTranslationKey(key)) return;
      const translated = t(key);
      if (translated != null) el.setAttribute('placeholder', translated);
    });
    if (searchInputEl) {
      searchInputEl.setAttribute('aria-label', currentLanguage === 'ko'
        ? '제목 또는 카테고리로 사운드 검색'
        : 'Search sounds by title or category');
    }
    if (globalVolumeEl && globalVolumeLabel) {
      const pct = parseInt(globalVolumeEl.value, 10);
      globalVolumeLabel.textContent = t('label.volume', { pct: isNaN(pct) ? 100 : pct });
    }
    updateHotkeyOnlyButton();
    updateSearchCount((getFilteredSounds() || []).length, currentBoard && currentBoard.sounds ? currentBoard.sounds.length : 0);
    updateSettingsRenderedCount();
    if (headerToggleBtn) headerToggleBtn.title = t('header.moreButton') || 'Settings';
  }

  function setLanguage(lang) {
    const next = lang === 'ko' ? 'ko' : 'en';
    currentLanguage = next;
    try { localStorage.setItem(LANGUAGE_KEY, next); } catch (_) {}
    if (languageSelectEl) languageSelectEl.value = next;
    if (boardNameEl && !boardNameEl.querySelector('input')) {
      boardNameEl.title = t('board.renameTitle');
    }
    applyTranslations();
    render();
  }

  function initI18n() {
    let initial = 'en';
    try {
      const saved = localStorage.getItem(LANGUAGE_KEY);
      if (saved === 'ko' || saved === 'en') initial = saved;
    } catch (_) {}
    currentLanguage = initial;
    if (languageSelectEl) {
      languageSelectEl.value = currentLanguage;
      languageSelectEl.addEventListener('change', function () {
        setLanguage(languageSelectEl.value || 'en');
      });
    }
    window.SoundboardI18n = { t };
    applyTranslations();
  }

  function setHeaderPopoutOpen(open) {
    if (!headerPopoutEl || !headerToggleBtn) return;
    const isOpen = !!open;
    headerPopoutEl.hidden = !isOpen;
    headerToggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }

  function toggleHeaderPopout() {
    if (!headerPopoutEl) return;
    setHeaderPopoutOpen(!!headerPopoutEl.hidden);
  }

  function openPortableReport(title, summary, warnings) {
    if (!portableReportEl) return;
    if (portableReportTitleEl) portableReportTitleEl.textContent = title || 'Portable report';
    if (portableReportSummaryEl) portableReportSummaryEl.textContent = summary || '';
    if (portableReportListEl) {
      portableReportListEl.textContent = '';
      (Array.isArray(warnings) ? warnings : []).forEach((w) => {
        const li = document.createElement('li');
        li.textContent = String(w);
        portableReportListEl.appendChild(li);
      });
    }
    portableReportEl.hidden = false;
    portableReportEl.setAttribute('aria-hidden', 'false');
  }

  function closePortableReport() {
    if (!portableReportEl) return;
    portableReportEl.hidden = true;
    portableReportEl.setAttribute('aria-hidden', 'true');
  }

  async function copyPortableReportToClipboard() {
    const title = portableReportTitleEl ? portableReportTitleEl.textContent : 'Portable report';
    const summary = portableReportSummaryEl ? portableReportSummaryEl.textContent : '';
    const items = portableReportListEl ? Array.from(portableReportListEl.querySelectorAll('li')).map((li) => li.textContent) : [];
    const text = [title, summary, '', ...items.map((x) => '- ' + x)].filter((x) => x != null).join('\n');

    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      if (downloadStatus) {
        downloadStatus.textContent = 'Warnings copied to clipboard.';
        setTimeout(function () { if (downloadStatus) downloadStatus.textContent = ''; }, 1800);
      }
    } catch (e) {
      alert('Copy failed. You can select and copy the list manually.');
    }
  }

  function initHeaderMenu() {
    if (!headerToggleBtn || !headerPopoutEl) return;
    setHeaderPopoutOpen(false);

    headerToggleBtn.addEventListener('click', function (e) {
      e.preventDefault();
      toggleHeaderPopout();
    });
    if (headerPopoutCloseBtn) {
      headerPopoutCloseBtn.addEventListener('click', function () {
        setHeaderPopoutOpen(false);
      });
    }
    headerPopoutEl.addEventListener('click', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('header__popout-backdrop')) {
        setHeaderPopoutOpen(false);
      }
    });
    document.addEventListener('click', function (e) {
      if (headerPopoutEl.hidden) return;
      if (headerPopoutEl.contains(e.target)) return;
      if (headerToggleBtn.contains(e.target)) return;
      setHeaderPopoutOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (headerPopoutEl.hidden) return;
      e.preventDefault();
      setHeaderPopoutOpen(false);
    });
  }

  function getCategoryStorageKey() {
    const boardId = currentBoard && currentBoard.id ? String(currentBoard.id) : 'default';
    return CATEGORY_UI_KEY_PREFIX + boardId;
  }

  function getCategoryOrderStorageKey() {
    const boardId = currentBoard && currentBoard.id ? String(currentBoard.id) : 'default';
    return CATEGORY_ORDER_KEY_PREFIX + boardId;
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

  function loadCategoryOrder() {
    try {
      const raw = localStorage.getItem(getCategoryOrderStorageKey());
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((x) => String(x));
    } catch (_) {
      return [];
    }
  }

  function saveCategoryOrder() {
    try {
      localStorage.setItem(getCategoryOrderStorageKey(), JSON.stringify(categoryOrder || []));
    } catch (_) {}
  }

  function getFavouritesStorageKey() {
    const boardId = currentBoard && currentBoard.id ? String(currentBoard.id) : 'default';
    return FAVOURITES_KEY_PREFIX + boardId;
  }

  function getRecentsStorageKey() {
    const boardId = currentBoard && currentBoard.id ? String(currentBoard.id) : 'default';
    return RECENTS_KEY_PREFIX + boardId;
  }

  function getQuickAccessCollapsedStorageKey() {
    const boardId = currentBoard && currentBoard.id ? String(currentBoard.id) : 'default';
    return QUICK_ACCESS_COLLAPSED_KEY_PREFIX + boardId;
  }

  function loadFavourites() {
    try {
      const raw = localStorage.getItem(getFavouritesStorageKey());
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.map((id) => String(id)));
    } catch (_) {
      return new Set();
    }
  }

  function saveFavourites() {
    try {
      localStorage.setItem(getFavouritesStorageKey(), JSON.stringify(Array.from(favouriteIds)));
    } catch (_) {}
  }

  function loadRecents() {
    try {
      const raw = localStorage.getItem(getRecentsStorageKey());
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((id) => String(id));
    } catch (_) {
      return [];
    }
  }

  function saveRecents() {
    try {
      localStorage.setItem(getRecentsStorageKey(), JSON.stringify(recentIds));
    } catch (_) {}
  }

  function applyQuickAccessFromBoard(board) {
    const qa = board && typeof board === 'object' ? board.quickAccess : null;
    if (!qa) return;
    try {
      const favs = Array.isArray(qa.favourites) ? qa.favourites.map((id) => String(id)) : null;
      const recs = Array.isArray(qa.recents) ? qa.recents.map((id) => String(id)) : null;
      if (favs) {
        favouriteIds = new Set(favs);
        // Mirror to legacy localStorage so other code paths see the same state.
        saveFavourites();
      }
      if (recs) {
        recentIds = recs;
        saveRecents();
      }
    } catch (err) {
      console.warn('soundboard: applyQuickAccessFromBoard failed', err);
    }
  }

  function loadQuickAccessCollapsedState() {
    try {
      const raw = localStorage.getItem(getQuickAccessCollapsedStorageKey());
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
      localStorage.setItem(getQuickAccessCollapsedStorageKey(), JSON.stringify({
        recents: !!quickAccessCollapsed.recents,
        favourites: !!quickAccessCollapsed.favourites
      }));
    } catch (_) {}
  }

  function clampFavouriteRows(value) {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) return FAVOURITES_ROWS_MIN;
    return Math.max(FAVOURITES_ROWS_MIN, Math.min(FAVOURITES_ROWS_MAX, parsed));
  }

  function loadFavouriteRows() {
    try {
      const raw = localStorage.getItem(FAVOURITES_ROWS_KEY);
      return clampFavouriteRows(raw == null ? FAVOURITES_ROWS_MIN : raw);
    } catch (_) {
      return FAVOURITES_ROWS_MIN;
    }
  }

  function saveFavouriteRows() {
    try {
      localStorage.setItem(FAVOURITES_ROWS_KEY, String(clampFavouriteRows(favouriteStripRows)));
    } catch (_) {}
  }

  function loadRecentRows() {
    try {
      const raw = localStorage.getItem(RECENTS_ROWS_KEY);
      return clampFavouriteRows(raw == null ? FAVOURITES_ROWS_MIN : raw);
    } catch (_) {
      return FAVOURITES_ROWS_MIN;
    }
  }

  function saveRecentRows() {
    try {
      localStorage.setItem(RECENTS_ROWS_KEY, String(clampFavouriteRows(recentStripRows)));
    } catch (_) {}
  }

  function loadThemePreference() {
    try {
      const raw = localStorage.getItem(THEME_KEY);
      if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
    } catch (_) {}
    return 'system';
  }

  function saveThemePreference(value) {
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch (_) {}
  }

  function updateThemeButtons() {
    const label = themePreference === 'system' ? 'Theme: Auto' : themePreference === 'light' ? 'Theme: Light' : 'Theme: Dark';
    if (themeToggleBtn) {
      themeToggleBtn.textContent = label;
      themeToggleBtn.setAttribute('aria-pressed', themePreference === 'system' ? 'false' : 'true');
      themeToggleBtn.title = 'Theme: Auto / Light / Dark';
    }
    if (quickThemeBtn) {
      quickThemeBtn.textContent = themePreference === 'system' ? 'Auto' : (themePreference === 'light' ? 'Light' : 'Dark');
      quickThemeBtn.setAttribute('aria-pressed', themePreference === 'system' ? 'false' : 'true');
    }
  }

  function applyThemePreference(value) {
    themePreference = (value === 'light' || value === 'dark' || value === 'system') ? value : 'system';
    const root = document && document.documentElement ? document.documentElement : null;
    if (root) {
      if (themePreference === 'system') delete root.dataset.theme;
      else root.dataset.theme = themePreference;
    }
    updateThemeButtons();
  }

  function cycleThemePreference() {
    const next = themePreference === 'system' ? 'light' : themePreference === 'light' ? 'dark' : 'system';
    saveThemePreference(next);
    applyThemePreference(next);
  }

  function pruneQuickAccessState() {
    const ids = new Set((currentBoard && Array.isArray(currentBoard.sounds) ? currentBoard.sounds : []).map((s) => String(s.id)));
    favouriteIds = new Set(Array.from(favouriteIds).filter((id) => ids.has(id)));
    recentIds = recentIds.filter((id) => ids.has(id)).slice(0, MAX_RECENT_SOUNDS);
    saveFavourites();
    saveRecents();
  }

  function normalizeCategoryKey(category) {
    const raw = (category || '').trim();
    return raw ? raw : 'Uncategorized';
  }

  function escapeAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function normalizeHotkeyInput(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    const compact = text.replace(/\s*\+\s*/g, '+');
    const rawParts = compact.split('+').map((part) => part.trim()).filter(Boolean);
    if (rawParts.length === 0) return '';

    const modifierAliases = new Map([
      ['CTRL', 'Ctrl'],
      ['CONTROL', 'Ctrl'],
      ['ALT', 'Alt'],
      ['OPTION', 'Alt'],
      ['SHIFT', 'Shift'],
      ['META', 'Meta'],
      ['CMD', 'Meta'],
      ['COMMAND', 'Meta'],
      ['WIN', 'Meta'],
      ['WINDOWS', 'Meta']
    ]);
    const keyAliases = new Map([
      ['SPACE', 'Space'],
      ['SPACEBAR', 'Space'],
      ['ESC', 'Escape'],
      ['RETURN', 'Enter'],
      ['UP', 'ArrowUp'],
      ['DOWN', 'ArrowDown'],
      ['LEFT', 'ArrowLeft'],
      ['RIGHT', 'ArrowRight'],
      ['PERIOD', '.'],
      ['DOT', '.'],
      ['COMMA', ','],
      ['SLASH', '/'],
      ['QUESTION', '/'],
      ['BACKSLASH', '\\'],
      ['SEMICOLON', ';'],
      ['COLON', ';'],
      ['QUOTE', "'"],
      ['APOSTROPHE', "'"],
      ['BACKQUOTE', '`'],
      ['GRAVE', '`'],
      ['MINUS', '-'],
      ['DASH', '-'],
      ['EQUAL', '='],
      ['PLUS', '='],
      ['LBRACKET', '['],
      ['RBRACKET', ']'],
      ['BRACKETLEFT', '['],
      ['BRACKETRIGHT', ']']
    ]);
    const modifierOrder = ['Ctrl', 'Alt', 'Shift', 'Meta'];
    const modifiers = new Set();

    const keyRaw = rawParts.pop();
    rawParts.forEach((part) => {
      const normalized = modifierAliases.get(part.toUpperCase());
      if (normalized) modifiers.add(normalized);
    });
    if (rawParts.length !== modifiers.size) return '';

    function normalizeKeyToken(token) {
      const trimmed = String(token || '').trim();
      if (!trimmed) return '';
      if (trimmed.length === 1) {
        const ch = trimmed;
        if (/^[a-z]$/i.test(ch)) return ch.toUpperCase();
        return ch;
      }
      const upper = trimmed.toUpperCase();
      if (/^F([1-9]|1[0-2])$/.test(upper)) return upper;
      if (keyAliases.has(upper)) return keyAliases.get(upper);
      const canonicalNames = new Map([
        ['ENTER', 'Enter'],
        ['TAB', 'Tab'],
        ['ESCAPE', 'Escape'],
        ['BACKSPACE', 'Backspace'],
        ['DELETE', 'Delete'],
        ['INSERT', 'Insert'],
        ['HOME', 'Home'],
        ['END', 'End'],
        ['PAGEUP', 'PageUp'],
        ['PAGEDOWN', 'PageDown'],
        ['ARROWUP', 'ArrowUp'],
        ['ARROWDOWN', 'ArrowDown'],
        ['ARROWLEFT', 'ArrowLeft'],
        ['ARROWRIGHT', 'ArrowRight']
      ]);
      if (canonicalNames.has(upper)) return canonicalNames.get(upper);
      return '';
    }

    const key = normalizeKeyToken(keyRaw);
    if (!key) return '';
    if (modifierAliases.has(String(keyRaw).toUpperCase()) || modifierAliases.has(String(key).toUpperCase())) return '';

    const orderedModifiers = modifierOrder.filter((mod) => modifiers.has(mod));
    return orderedModifiers.length ? (orderedModifiers.join('+') + '+' + key) : key;
  }

  function getHotkeySignatureFromKeyboardEvent(e) {
    if (!e) return '';
    const shiftedCharToBase = {
      '~': '`',
      '!': '1',
      '@': '2',
      '#': '3',
      '$': '4',
      '%': '5',
      '^': '6',
      '&': '7',
      '*': '8',
      '(': '9',
      ')': '0',
      '_': '-',
      '+': '=',
      '{': '[',
      '}': ']',
      '|': '\\',
      ':': ';',
      '"': "'",
      '<': ',',
      '>': '.',
      '?': '/'
    };
    const keyAlias = {
      ' ': 'Space',
      Spacebar: 'Space',
      Esc: 'Escape',
      Return: 'Enter',
      Up: 'ArrowUp',
      Down: 'ArrowDown',
      Left: 'ArrowLeft',
      Right: 'ArrowRight'
    };

    function keyFromCode(code) {
      const c = String(code || '');
      if (!c) return '';
      if (c === 'Space') return 'Space';
      if (c === 'Tab') return 'Tab';
      if (c === 'Enter') return 'Enter';
      if (c === 'Escape') return 'Escape';
      if (c === 'Backspace') return 'Backspace';
      if (c === 'Delete') return 'Delete';
      if (c === 'Insert') return 'Insert';
      if (c === 'Home') return 'Home';
      if (c === 'End') return 'End';
      if (c === 'PageUp') return 'PageUp';
      if (c === 'PageDown') return 'PageDown';
      if (c === 'ArrowUp') return 'ArrowUp';
      if (c === 'ArrowDown') return 'ArrowDown';
      if (c === 'ArrowLeft') return 'ArrowLeft';
      if (c === 'ArrowRight') return 'ArrowRight';
      if (/^Key[A-Z]$/.test(c)) return c.slice(3);
      if (/^Digit[0-9]$/.test(c)) return c.slice(5);
      if (/^F([1-9]|1[0-2])$/.test(c)) return c;
      const punct = {
        Backquote: '`',
        Minus: '-',
        Equal: '=',
        BracketLeft: '[',
        BracketRight: ']',
        Backslash: '\\',
        IntlBackslash: '\\',
        Semicolon: ';',
        Quote: "'",
        Comma: ',',
        Period: '.',
        Slash: '/'
      };
      if (punct[c]) return punct[c];
      return '';
    }

    let key = e.key || '';
    if (!key) key = keyFromCode(e.code);
    if (!key) return '';
    // Newer Chromium + some IME layouts report these instead of the actual key.
    if (key === 'Dead' || key === 'Process' || key === 'Unidentified') {
      const fallback = keyFromCode(e.code);
      if (fallback) key = fallback;
    }
    // Treat AltGraph as a modifier, not a standalone hotkey key.
    if (key === 'AltGraph') return '';
    if (keyAlias[key]) key = keyAlias[key];
    if (key.length === 1) {
      if (e.shiftKey && shiftedCharToBase[key]) key = shiftedCharToBase[key];
      if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
    }

    const altGraph = typeof e.getModifierState === 'function' && e.getModifierState('AltGraph');
    const signature = normalizeHotkeyInput(
      ((e.ctrlKey && !altGraph) ? 'Ctrl+' : '')
      + ((e.altKey || altGraph) ? 'Alt+' : '')
      + (e.shiftKey ? 'Shift+' : '')
      + (e.metaKey ? 'Meta+' : '')
      + key
    );
    return signature;
  }

  function captureHotkeyFromInputKeydown(e, onEnter) {
    if (!e) return;
    const key = e.key || '';
    if (key === 'Tab') return;
    if (key === 'Enter') {
      e.preventDefault();
      if (typeof onEnter === 'function') onEnter();
      return;
    }
    if (key === 'Backspace' || key === 'Delete') {
      e.preventDefault();
      if (e.target) e.target.value = '';
      return;
    }
    if (key === 'Escape') {
      if (e.target && typeof e.target.blur === 'function') e.target.blur();
      return;
    }
    const signature = getHotkeySignatureFromKeyboardEvent(e);
    if (!signature) return;
    e.preventDefault();
    if (e.target) e.target.value = signature;
  }

  function clearSettingsFeedback() {
    if (!settingsFeedbackEl) return;
    settingsFeedbackEl.textContent = '';
    settingsFeedbackEl.classList.remove('settings-screen__feedback--error', 'settings-screen__feedback--success');
  }

  function setSettingsFeedback(message, kind) {
    if (!settingsFeedbackEl) return;
    settingsFeedbackEl.textContent = message || '';
    settingsFeedbackEl.classList.remove('settings-screen__feedback--error', 'settings-screen__feedback--success');
    if (kind === 'error') settingsFeedbackEl.classList.add('settings-screen__feedback--error');
    if (kind === 'success') settingsFeedbackEl.classList.add('settings-screen__feedback--success');
  }

  function clearSettingsValidationState() {
    if (!settingsListEl) return;
    const rows = Array.from(settingsListEl.querySelectorAll('.settings-row'));
    rows.forEach((row) => {
      row.classList.remove('settings-row--invalid');
      const rowError = row.querySelector('.settings-row__error');
      if (rowError) rowError.textContent = '';
      row.querySelectorAll('.field__input--invalid').forEach((el) => el.classList.remove('field__input--invalid'));
    });
  }

  function setSettingsRowError(row, fieldName, message) {
    if (!row) return;
    row.classList.add('settings-row--invalid');
    if (fieldName) {
      const field = row.querySelector('[data-field="' + fieldName + '"]');
      if (field && field.classList) field.classList.add('field__input--invalid');
    }
    const rowError = row.querySelector('.settings-row__error');
    if (rowError) rowError.textContent = message;
  }

  function setSettingsDirty(isDirty) {
    settingsDirty = !!isDirty;
    if (!settingsDirty && settingsFeedbackEl && settingsFeedbackEl.classList.contains('settings-screen__feedback--error')) {
      clearSettingsFeedback();
    }
  }

  function hasUnsavedSettingsChanges() {
    return !!settingsDirty;
  }

  function updateSettingsRenderedCount() {
    if (!settingsRenderedCountEl || !currentBoard || !Array.isArray(currentBoard.sounds)) return;
    const total = currentBoard.sounds.length;
    settingsRenderedCountEl.textContent = t('settings.loadedCount', { loaded: settingsRenderIndex, total });
  }

  function updateSettingsLoadMoreVisibility() {
    if (!settingsLoadMoreBtn || !currentBoard || !Array.isArray(currentBoard.sounds)) return;
    const hasMore = settingsRenderIndex < currentBoard.sounds.length;
    settingsLoadMoreBtn.hidden = !hasMore;
  }

  function buildSettingsRow(sound, idx) {
    const row = document.createElement('article');
    row.className = 'settings-row';
    row.dataset.soundId = sound.id;
    row.dataset.searchText = [
      sound.title || '',
      sound.category || '',
      sound.fileUrl || '',
      sound.imageUrl || '',
      sound.hotkey || ''
    ].join(' ').toLowerCase();

    function el(tag, className, text) {
      const n = document.createElement(tag);
      if (className) n.className = className;
      if (text != null) n.textContent = String(text);
      return n;
    }

    function makeLabeledInput(labelText, field, type, value, attrs = {}) {
      const label = document.createElement('label');
      const lab = el('span', 'field__label', labelText);
      const input = document.createElement('input');
      input.className = 'field__input';
      input.type = type;
      input.dataset.field = field;
      input.value = value == null ? '' : String(value);
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v == null) return;
        if (k === 'list') input.setAttribute('list', String(v));
        else input.setAttribute(k, String(v));
      });
      label.appendChild(lab);
      label.appendChild(input);
      return label;
    }

    function makeCheckboxLabel(className, field, checked, text) {
      const label = document.createElement('label');
      if (className) label.className = className;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.field = field;
      input.checked = !!checked;
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + text));
      return label;
    }

    const top = el('div', 'settings-row__top');
    const name = el('div', 'settings-row__name', (idx + 1) + '. ' + (sound.title || 'Untitled'));
    const flags = el('div', 'settings-row__flags');
    flags.appendChild(makeCheckboxLabel('settings-row__favorite', 'favorite', favouriteIds.has(String(sound.id)), 'Favourite'));
    flags.appendChild(makeCheckboxLabel('settings-row__delete', 'delete', false, 'Delete'));
    top.appendChild(name);
    top.appendChild(flags);

    const grid = el('div', 'settings-row__grid');
    grid.appendChild(makeLabeledInput('Title', 'title', 'text', sound.title || ''));
    grid.appendChild(makeLabeledInput('Audio URL', 'fileUrl', 'text', sound.fileUrl || ''));
    grid.appendChild(makeLabeledInput('Image URL', 'imageUrl', 'text', sound.imageUrl || ''));
    grid.appendChild(makeLabeledInput('Category', 'category', 'text', sound.category || '', { list: 'category-options' }));
    grid.appendChild(makeLabeledInput('Hotkey (press combo, e.g. Q, Shift+., Ctrl+Alt+P)', 'hotkey', 'text', normalizeHotkeyInput(sound.hotkey || '')));
    grid.appendChild(makeLabeledInput('Volume %', 'volume', 'number', Math.round((sound.volume != null ? sound.volume : 1) * 100), { min: 0, max: 100, step: 1 }));
    grid.appendChild(makeLabeledInput('Speed', 'playbackRate', 'number', (sound.playbackRate != null ? sound.playbackRate : 1), { min: 0.5, max: 2, step: 0.1 }));
    grid.appendChild(makeLabeledInput('Start sec', 'startSec', 'number', (sound.startMs != null ? (sound.startMs / 1000) : ''), { min: 0, step: 0.01 }));
    grid.appendChild(makeLabeledInput('End sec', 'endSec', 'number', (sound.endMs != null ? (sound.endMs / 1000) : ''), { min: 0, step: 0.01 }));

    const loopLabel = document.createElement('label');
    loopLabel.className = 'field--checkbox';
    const loopInput = document.createElement('input');
    loopInput.type = 'checkbox';
    loopInput.dataset.field = 'loop';
    loopInput.checked = !!sound.loop;
    const loopText = el('span', 'field__label', 'Loop');
    loopLabel.appendChild(loopInput);
    loopLabel.appendChild(loopText);
    grid.appendChild(loopLabel);

    const momentaryLabel = document.createElement('label');
    momentaryLabel.className = 'field--checkbox';
    const momentaryInput = document.createElement('input');
    momentaryInput.dataset.field = 'momentary';
    momentaryInput.type = 'checkbox';
    momentaryInput.checked = !!sound.momentary;
    const momentaryText = el('span', 'field__label', 'Momentary');
    momentaryLabel.appendChild(momentaryInput);
    momentaryLabel.appendChild(momentaryText);
    grid.appendChild(momentaryLabel);

    const rowError = el('p', 'settings-row__error');
    rowError.setAttribute('aria-live', 'polite');

    row.appendChild(top);
    row.appendChild(grid);
    row.appendChild(rowError);
    return row;
  }

  function appendSettingsRows(limit) {
    if (!settingsListEl || !currentBoard || !Array.isArray(currentBoard.sounds)) return;
    const sounds = currentBoard.sounds;
    const target = Math.min(sounds.length, settingsRenderIndex + Math.max(1, limit || SETTINGS_BATCH_SIZE));
    for (let i = settingsRenderIndex; i < target; i += 1) {
      settingsListEl.appendChild(buildSettingsRow(sounds[i], i));
    }
    settingsRenderIndex = target;
    updateSettingsRenderedCount();
    updateSettingsLoadMoreVisibility();
  }

  function ensureAllSettingsRowsRendered() {
    if (!currentBoard || !Array.isArray(currentBoard.sounds)) return;
    const remaining = currentBoard.sounds.length - settingsRenderIndex;
    if (remaining > 0) appendSettingsRows(remaining);
  }

  function soundMatchesQuery(sound, q) {
    if (!q) return true;
    const title = (sound && sound.title ? String(sound.title) : '').toLowerCase();
    const cat = (sound && sound.category ? String(sound.category) : '').toLowerCase();
    return title.includes(q) || cat.includes(q);
  }

  function soundHasAssignedHotkey(sound) {
    return !!normalizeHotkeyInput(sound && sound.hotkey);
  }

  function getFilteredSounds() {
    const sounds = currentBoard && Array.isArray(currentBoard.sounds) ? currentBoard.sounds : [];
    const q = (searchQuery || '').trim().toLowerCase();
    return sounds.filter((s) => {
      if (showHotkeyOnly && !soundHasAssignedHotkey(s)) return false;
      return soundMatchesQuery(s, q);
    });
  }

  function getQuickAccessSounds(filteredSounds) {
    const source = currentBoard && Array.isArray(currentBoard.sounds) ? currentBoard.sounds : [];
    const byId = new Map(source.map((s) => [String(s.id), s]));
    const visibleIds = new Set((Array.isArray(filteredSounds) ? filteredSounds : []).map((s) => String(s.id)));
    const favourites = Array.from(favouriteIds)
      .map((id) => byId.get(id))
      .filter((s) => !!s && visibleIds.has(String(s.id)));
    const recents = (recentIds || [])
      .map((id) => byId.get(id))
      .filter((s) => !!s && visibleIds.has(String(s.id)));
    return { favourites, recents };
  }

  /**
   * Mirror the live favouriteIds/recentIds onto currentBoard.quickAccess so that
   * any consumer reading the board (saveToStorage, exportPortableZip, etc.)
   * sees the latest state — not the snapshot from the previous save.
   */
  function syncQuickAccessToBoard() {
    if (!currentBoard || typeof currentBoard !== 'object') return;
    try {
      currentBoard.quickAccess = {
        favourites: Array.from(favouriteIds || []).map((id) => String(id)),
        recents: (recentIds || []).map((id) => String(id))
      };
    } catch (err) {
      console.warn('soundboard: syncQuickAccessToBoard failed', err);
    }
  }

  function toggleFavourite(sound) {
    if (!sound || !sound.id) return;
    const id = String(sound.id);
    if (favouriteIds.has(id)) favouriteIds.delete(id);
    else favouriteIds.add(id);
    saveFavourites();
    syncQuickAccessToBoard();
    saveToStorage();
    render();
  }

  function reorderFavourites(fromIndex, toIndex) {
    const ordered = Array.from(favouriteIds);
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= ordered.length || toIndex >= ordered.length || fromIndex === toIndex) return;
    const moved = ordered.splice(fromIndex, 1)[0];
    ordered.splice(toIndex, 0, moved);
    favouriteIds = new Set(ordered);
    saveFavourites();
    syncQuickAccessToBoard();
    saveToStorage();
    render();
  }

  function setFavouriteStripRows(nextRows) {
    const clamped = clampFavouriteRows(nextRows);
    if (clamped === favouriteStripRows) return;
    favouriteStripRows = clamped;
    saveFavouriteRows();
    render();
  }

  function setRecentStripRows(nextRows) {
    const clamped = clampFavouriteRows(nextRows);
    if (clamped === recentStripRows) return;
    recentStripRows = clamped;
    saveRecentRows();
    render();
  }

  function updateFavouritesControls(labels) {
    if (favouritesRowsSelectEl) {
      const normalized = String(clampFavouriteRows(favouriteStripRows));
      if (favouritesRowsSelectEl.value !== normalized) favouritesRowsSelectEl.value = normalized;
    }
    if (favouritesReorderToggleEl) {
      favouritesReorderToggleEl.classList.toggle('btn--active', favouriteReorderMode);
      favouritesReorderToggleEl.setAttribute('aria-pressed', favouriteReorderMode ? 'true' : 'false');
      favouritesReorderToggleEl.textContent = favouriteReorderMode
        ? labels.doneReorderingFavourites
        : labels.reorderFavourites;
    }
  }

  function updateRecentsControls() {
    if (recentsRowsSelectEl) {
      const normalized = String(clampFavouriteRows(recentStripRows));
      if (recentsRowsSelectEl.value !== normalized) recentsRowsSelectEl.value = normalized;
    }
  }

  function updateQuickAccessCollapseControls(labels, counts) {
    const isRecentsCollapsed = !!quickAccessCollapsed.recents;
    const isFavouritesCollapsed = !!quickAccessCollapsed.favourites;
    if (recentsSectionEl) recentsSectionEl.classList.toggle('quick-access__section--collapsed', isRecentsCollapsed);
    if (favouritesSectionEl) favouritesSectionEl.classList.toggle('quick-access__section--collapsed', isFavouritesCollapsed);
    if (recentsStripEl) recentsStripEl.style.display = isRecentsCollapsed ? 'none' : '';
    if (favouritesStripEl) favouritesStripEl.style.display = isFavouritesCollapsed ? 'none' : '';

    if (recentsCountEl) recentsCountEl.textContent = labels.soundCount.replace('{count}', String(counts.recents));
    if (favouritesCountEl) favouritesCountEl.textContent = labels.soundCount.replace('{count}', String(counts.favourites));

    if (recentsCollapseToggleEl) {
      recentsCollapseToggleEl.setAttribute('aria-expanded', isRecentsCollapsed ? 'false' : 'true');
      recentsCollapseToggleEl.setAttribute(
        'aria-label',
        (isRecentsCollapsed ? labels.expand : labels.collapse) + ' ' + labels.recents
      );
      recentsCollapseToggleEl.title = (isRecentsCollapsed ? labels.expand : labels.collapse) + ' ' + labels.recents;
      const recentsCaret = recentsCollapseToggleEl.querySelector('.quick-access__caret');
      if (recentsCaret) recentsCaret.textContent = isRecentsCollapsed ? '\u25B6' : '\u25BC';
    }
    if (favouritesCollapseToggleEl) {
      favouritesCollapseToggleEl.setAttribute('aria-expanded', isFavouritesCollapsed ? 'false' : 'true');
      favouritesCollapseToggleEl.setAttribute(
        'aria-label',
        (isFavouritesCollapsed ? labels.expand : labels.collapse) + ' ' + labels.favourites
      );
      favouritesCollapseToggleEl.title = (isFavouritesCollapsed ? labels.expand : labels.collapse) + ' ' + labels.favourites;
      const favouritesCaret = favouritesCollapseToggleEl.querySelector('.quick-access__caret');
      if (favouritesCaret) favouritesCaret.textContent = isFavouritesCollapsed ? '\u25B6' : '\u25BC';
    }
  }

  function toggleQuickAccessSectionCollapse(sectionKey) {
    const key = sectionKey === 'favourites' ? 'favourites' : 'recents';
    quickAccessCollapsed[key] = !quickAccessCollapsed[key];
    saveQuickAccessCollapsedState();
    render();
  }

  function recordRecentPlay(soundId) {
    const id = String(soundId || '').trim();
    if (!id) return;
    recentIds = [id].concat((recentIds || []).filter((x) => x !== id)).slice(0, MAX_RECENT_SOUNDS);
    saveRecents();
    syncQuickAccessToBoard();
    saveToStorage();
  }

  function renderQuickAccess(filteredSounds, hotkeyCounts) {
    if (!quickAccessEl || !UI || !UI.renderHorizontalStrip) return;
    const labels = {
      favourites: t('quickAccess.favourites') || 'Favourites',
      recents: t('quickAccess.recents') || 'Recents',
      emptyFavourites: t('quickAccess.emptyFavourites') || 'No favourites yet. Tap the star on a sound tile.',
      emptyRecents: t('quickAccess.emptyRecents') || 'No recent plays yet. Play a sound to populate this list.',
      reorderFavourites: t('quickAccess.reorderFavourites') || 'Reorder',
      doneReorderingFavourites: t('quickAccess.doneReorderingFavourites') || 'Done',
      collapse: t('quickAccess.collapse') || 'Collapse',
      expand: t('quickAccess.expand') || 'Expand',
      soundCount: t('quickAccess.soundCount', { count: '{count}' }) || '{count} sounds'
    };
    const favouriteTitle = favouritesSectionEl && favouritesSectionEl.querySelector('.quick-access__title');
    const recentTitle = recentsSectionEl && recentsSectionEl.querySelector('.quick-access__title');
    if (favouriteTitle) favouriteTitle.textContent = labels.favourites;
    if (recentTitle) recentTitle.textContent = labels.recents;

    const strips = getQuickAccessSounds(filteredSounds);
    const hasFavourites = strips.favourites.length > 0;
    const hasRecents = strips.recents.length > 0;
    if (favouritesSectionEl) favouritesSectionEl.hidden = false;
    if (recentsSectionEl) recentsSectionEl.hidden = false;
    quickAccessEl.hidden = false;
    updateFavouritesControls(labels);
    updateRecentsControls();
    updateQuickAccessCollapseControls(labels, {
      recents: strips.recents.length,
      favourites: strips.favourites.length
    });
    const stripRows = clampFavouriteRows(favouriteStripRows);
    if (favouritesStripEl) {
      favouritesStripEl.classList.toggle('sound-strip--multirow', stripRows > 1);
      favouritesStripEl.style.setProperty('--favorites-strip-rows', String(stripRows));
    }
    const recentRows = clampFavouriteRows(recentStripRows);
    if (recentsStripEl) {
      recentsStripEl.classList.toggle('sound-strip--multirow', recentRows > 1);
      recentsStripEl.style.setProperty('--recents-strip-rows', String(recentRows));
    }

    if (hasFavourites && favouritesStripEl) {
      UI.renderHorizontalStrip(
        favouritesStripEl,
        strips.favourites,
        playingId,
        errorIds,
        onPlay,
        onEditSound,
        {
          hotkeyCounts,
          isFavorite: (s) => favouriteIds.has(String(s.id)),
          onToggleFavorite: toggleFavourite,
          reorderMode: favouriteReorderMode,
          onReorder: reorderFavourites
        }
      );
    } else if (favouritesStripEl) {
      favouritesStripEl.textContent = '';
      const empty = document.createElement('p');
      empty.className = 'sound-strip__empty';
      empty.textContent = labels.emptyFavourites;
      favouritesStripEl.appendChild(empty);
    }

    if (hasRecents && recentsStripEl) {
      UI.renderHorizontalStrip(
        recentsStripEl,
        strips.recents,
        playingId,
        errorIds,
        onPlay,
        onEditSound,
        {
          hotkeyCounts,
          isFavorite: (s) => favouriteIds.has(String(s.id)),
          onToggleFavorite: toggleFavourite
        }
      );
    } else if (recentsStripEl) {
      recentsStripEl.textContent = '';
      const empty = document.createElement('p');
      empty.className = 'sound-strip__empty';
      empty.textContent = labels.emptyRecents;
      recentsStripEl.appendChild(empty);
    }
  }

  function buildGroups(sounds) {
    const map = new Map();
    (Array.isArray(sounds) ? sounds : []).forEach((s) => {
      const key = normalizeCategoryKey(s && s.category);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    });

    const keys = Array.from(map.keys());
    const orderRank = new Map((categoryOrder || []).map((k, i) => [String(k), i]));
    keys.sort((a, b) => {
      const ai = orderRank.has(a) ? orderRank.get(a) : Number.POSITIVE_INFINITY;
      const bi = orderRank.has(b) ? orderRank.get(b) : Number.POSITIVE_INFINITY;
      if (ai !== bi) return ai - bi;
      if (a === 'Uncategorized' && b !== 'Uncategorized') return -1;
      if (b === 'Uncategorized' && a !== 'Uncategorized') return 1;
      return a.localeCompare(b);
    });

    return keys.map((k) => ({
      key: k,
      label: k === 'Uncategorized' ? (currentLanguage === 'ko' ? '미분류' : 'Uncategorized') : k,
      sounds: map.get(k)
    }));
  }

  function reorderCategories(fromKey, toKey) {
    const from = String(fromKey || '');
    const to = String(toKey || '');
    if (!from || !to || from === to) return;
    const arr = (categoryOrder || []).slice();
    if (!arr.includes(from)) arr.push(from);
    if (!arr.includes(to)) arr.push(to);
    const fromIdx = arr.indexOf(from);
    const toIdx = arr.indexOf(to);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const item = arr.splice(fromIdx, 1)[0];
    arr.splice(toIdx, 0, item);
    categoryOrder = arr;
    saveCategoryOrder();
    render();
  }

  function updateSearchCount(count, total) {
    if (!searchCountEl) return;
    const q = (searchQuery || '').trim();
    if (!q && !showHotkeyOnly) {
      searchCountEl.textContent = '';
      return;
    }
    const suffix = showHotkeyOnly ? t('search.hotkeysSuffix') : '';
    searchCountEl.textContent = String(count) + '/' + String(total) + suffix;
  }

  function updateHotkeyOnlyButton() {
    const btn = toolbarEl && toolbarEl.querySelector('[data-action="hotkey-only-toggle"]');
    const quickBtn = quickBarEl && quickBarEl.querySelector('[data-action="quick-hotkey-only"]');
    const label = showHotkeyOnly ? t('hotkey.only.on') : t('hotkey.only.off');
    if (btn) {
      btn.classList.toggle('btn--active', showHotkeyOnly);
      btn.setAttribute('aria-pressed', showHotkeyOnly ? 'true' : 'false');
      btn.textContent = label;
    }
    if (quickBtn) {
      quickBtn.classList.toggle('btn--active', showHotkeyOnly);
      quickBtn.setAttribute('aria-pressed', showHotkeyOnly ? 'true' : 'false');
    }
  }

  function toggleHotkeyOnlyFilter() {
    showHotkeyOnly = !showHotkeyOnly;
    render();
  }

  function bindTapAndClick(button, handler) {
    if (!button || typeof handler !== 'function') return;
    let handledByTouch = false;
    button.addEventListener('touchstart', function (e) {
      if (e && e.cancelable) e.preventDefault();
      handledByTouch = true;
      handler();
      setTimeout(function () { handledByTouch = false; }, 300);
    }, { passive: false });
    button.addEventListener('click', function () {
      if (handledByTouch) return;
      handler();
    });
  }

  // ------- File-on-disk mode (File System Access API) -------
  // On supported browsers (Chrome/Edge desktop) we let the user attach a
  // portable ZIP file. We then read from it on startup and write to it on
  // every save, so the user's data survives even if localStorage is wiped.

  let fileModeAttached = false;
  let fileModeFilename = '';
  let fileModeWriteTimer = null;
  let fileModeWriteInFlight = false;
  let fileModeWritePending = false;
  const FILE_MODE_WRITE_DEBOUNCE_MS = 1500;

  function isFileModeSupported() {
    return !!(window.SoundboardFileMode && window.SoundboardFileMode.isSupported && window.SoundboardFileMode.isSupported());
  }

  function setFileModeStatus(text) {
    if (fileModeStatusEl) fileModeStatusEl.textContent = text || '';
  }

  function setFileModeUiState(attached, filename, permission) {
    fileModeAttached = !!attached;
    fileModeFilename = filename || '';
    if (fileModeDetachBtn) fileModeDetachBtn.hidden = !attached;
    if (fileModeAttachBtn) {
      fileModeAttachBtn.textContent = attached ? 'Re-link or change file…' : 'Sync to file…';
    }
    if (attached) {
      const permNote = permission === 'granted' ? 'synced' : (permission === 'prompt' ? 'click to re-link' : 'permission needed');
      setFileModeStatus('File: ' + (filename || '(unnamed)') + ' — ' + permNote);
    } else if (isFileModeSupported()) {
      setFileModeStatus('Not synced to a file. Click "Sync to file…" to keep your board in a ZIP on disk.');
    } else {
      setFileModeStatus('');
    }
  }

  async function refreshFileModeStatus() {
    if (!isFileModeSupported()) {
      if (fileModeControlsEl) fileModeControlsEl.hidden = true;
      setFileModeStatus('');
      return;
    }
    if (fileModeControlsEl) fileModeControlsEl.hidden = false;
    try {
      const info = await window.SoundboardFileMode.getAttachmentInfo();
      setFileModeUiState(info.attached, info.name, info.permission);
    } catch (err) {
      console.warn('[soundboard] file-mode: status refresh failed', err);
      setFileModeUiState(false, '', null);
    }
  }

  async function tryLoadFromAttachedFile() {
    if (!isFileModeSupported()) return null;
    try {
      const res = await window.SoundboardFileMode.readAttachedFile();
      if (!res.ok) {
        if (res.reason === 'no-handle') return null;
        if (res.reason === 'no-permission') {
          // We have a handle but the browser requires a user gesture to grant
          // permission. Surface UI so the user can re-link with a single click.
          setFileModeStatus('Attached file needs permission. Click "Re-link" to restore from your ZIP.');
        } else {
          console.warn('[soundboard] file-mode: load failed', res.reason);
        }
        return null;
      }
      // We have a File; import it using the existing portable-zip path.
      console.info('[soundboard] file-mode: restoring from attached file', res.file && res.file.name);
      setFileModeStatus('Restoring from ' + (res.file && res.file.name) + '…');
      await importPortableZip(res.file, { fromFileMode: true });
      setFileModeUiState(true, res.file && res.file.name, 'granted');
      return true;
    } catch (err) {
      console.warn('[soundboard] file-mode: tryLoadFromAttachedFile threw', err);
      return null;
    }
  }

  function scheduleFileModeWrite() {
    if (!fileModeAttached || !isFileModeSupported()) return;
    fileModeWritePending = true;
    if (fileModeWriteTimer) clearTimeout(fileModeWriteTimer);
    fileModeWriteTimer = setTimeout(function () {
      fileModeWriteTimer = null;
      writeFileModeNow();
    }, FILE_MODE_WRITE_DEBOUNCE_MS);
  }

  async function buildPortableZipBlob() {
    // Reuses the exportPortableZip path's logic in-line. We don't reuse
    // exportPortableZip() because that triggers a download/share. Instead we
    // construct the same ZIP and return the Blob for our writer.
    if (!currentBoard || !window.JSZip) return null;
    const LocalAudio = window.SoundboardLocalAudio;
    const LocalImages = window.SoundboardLocalImages;
    syncQuickAccessToBoard();
    const zip = new window.JSZip();
    const normalized = Board.normalizeBoard(currentBoard);
    const portable = JSON.parse(JSON.stringify(normalized));
    const audioFolder = zip.folder('audio');
    const imagesFolder = zip.folder('images');

    for (const s of (portable.sounds || [])) {
      const id = String(s.id || '');
      try {
        const fileUrl = String(s.fileUrl || '');
        if (fileUrl.startsWith('local:') && LocalAudio && LocalAudio.getBlob) {
          const blobId = fileUrl.slice(6);
          const buf = await LocalAudio.getBlob(blobId);
          if (buf) {
            const audioName = safeFilenamePart(id) + '.mp3';
            audioFolder.file(audioName, buf);
            s.fileUrl = 'zip:audio/' + audioName;
          }
        }
      } catch (err) { console.warn('[soundboard] file-mode: audio pack failed', id, err); }
      try {
        const imageUrl = String(s.imageUrl || '').trim();
        if (imageUrl.startsWith('local-image:') && LocalImages && LocalImages.getBlob) {
          const rec = await LocalImages.getBlob(imageUrl.slice('local-image:'.length));
          if (rec && rec.arrayBuffer) {
            const mime = String(rec.mime || 'image/jpeg').toLowerCase();
            const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
            const imgName = safeFilenamePart(id) + '.' + ext;
            imagesFolder.file(imgName, rec.arrayBuffer);
            s.imageUrl = 'zip:images/' + imgName;
          }
        }
      } catch (err) { console.warn('[soundboard] file-mode: image pack failed', id, err); }
    }
    zip.file('board.json', JSON.stringify(portable, null, 2));
    zip.file('manifest.json', JSON.stringify({
      type: 'soundboard-portable',
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      boardName: portable.name || ''
    }, null, 2));
    return zip.generateAsync({ type: 'blob' });
  }

  async function writeFileModeNow() {
    if (!fileModeAttached || !isFileModeSupported()) return;
    if (fileModeWriteInFlight) {
      // Another write is in-flight; mark pending so we'll write again after.
      fileModeWritePending = true;
      return;
    }
    fileModeWriteInFlight = true;
    fileModeWritePending = false;
    try {
      setFileModeStatus('Saving to file…');
      const blob = await buildPortableZipBlob();
      if (!blob) {
        setFileModeStatus('File save skipped (no board).');
        return;
      }
      const res = await window.SoundboardFileMode.writeAttachedFile(blob);
      if (res.ok) {
        const stamp = new Date().toLocaleTimeString();
        setFileModeStatus('File: ' + (fileModeFilename || 'attached') + ' — saved ' + stamp);
        console.info('[soundboard] file-mode: write ok at ' + stamp);
      } else {
        setFileModeStatus('File save failed (' + (res.reason || 'unknown') + ').');
        console.warn('[soundboard] file-mode: write failed', res.reason);
      }
    } catch (err) {
      console.warn('[soundboard] file-mode: write threw', err);
      setFileModeStatus('File save error.');
    } finally {
      fileModeWriteInFlight = false;
      if (fileModeWritePending) scheduleFileModeWrite();
    }
  }

  async function onAttachFileClick() {
    if (!isFileModeSupported()) {
      alert('"Sync to file" is only available on Chrome/Edge desktop browsers.');
      return;
    }
    // Two-step prompt: open existing or save new.
    const choice = window.confirm('OK = pick an existing portable ZIP to sync.\nCancel = save current board as a new portable ZIP and sync.');
    if (choice) {
      const res = await window.SoundboardFileMode.pickAndAttach();
      if (!res.ok) {
        if (res.reason !== 'cancelled') alert('Could not attach file (' + res.reason + ').');
        return;
      }
      setFileModeUiState(true, res.file && res.file.name, 'granted');
      try {
        await importPortableZip(res.file, { fromFileMode: true });
      } catch (err) {
        console.warn('[soundboard] file-mode: import after attach failed', err);
      }
    } else {
      const blob = await buildPortableZipBlob();
      if (!blob) { alert('Nothing to save yet.'); return; }
      const suggested = (currentBoard && currentBoard.name ? currentBoard.name : 'soundboard') + '-portable.zip';
      const res = await window.SoundboardFileMode.saveAndAttach(blob, suggested);
      if (!res.ok) {
        if (res.reason !== 'cancelled') alert('Could not save file (' + res.reason + ').');
        return;
      }
      setFileModeUiState(true, res.handle && res.handle.name, 'granted');
    }
  }

  async function onDetachFileClick() {
    if (!window.confirm('Stop syncing to the attached file? Your local board copy stays put; just the file link is removed.')) return;
    await window.SoundboardFileMode.detach();
    setFileModeUiState(false, '', null);
  }

  function loadInitialBoard() {
    // Diagnostics so we can tell whether persistence is actually working on
    // this device. Visible in DevTools Console.
    try {
      const lsRaw = localStorage.getItem('soundboard-board');
      const lsLocation = localStorage.getItem('soundboard-board-location');
      console.info('[soundboard] load: localStorage entry present?', !!lsRaw, 'size=', lsRaw ? lsRaw.length : 0, 'location=', lsLocation);
    } catch (e) {
      console.warn('[soundboard] load: localStorage probe failed', e);
    }

    // Show the file-mode controls/status immediately.
    refreshFileModeStatus();

    // First try file-on-disk mode: if the user has attached a ZIP previously,
    // it is the source of truth.
    Promise.resolve(isFileModeSupported() ? tryLoadFromAttachedFile() : null)
      .then((loadedFromFile) => {
        if (loadedFromFile) return;
        loadFromStorageOrSample();
      })
      .catch((err) => {
        console.warn('[soundboard] file-mode: startup load threw', err);
        loadFromStorageOrSample();
      });
  }

  function loadFromStorageOrSample() {
    // Prefer the freshest of localStorage and IndexedDB (compares updatedAt).
    // Falls through to sample board only when both stores are empty/invalid.
    const latestPromise = Storage && Storage.loadBoardLatest
      ? Storage.loadBoardLatest()
      : Promise.resolve(Storage && Storage.loadBoard ? Storage.loadBoard() : null);

    latestPromise.then((saved) => {
      if (saved && Board.validateBoard(saved).ok) {
        const soundCount = Array.isArray(saved.sounds) ? saved.sounds.length : 0;
        console.info('[soundboard] load: restored saved board (' + soundCount + ' sounds, updatedAt=' + (saved.updatedAt || 'n/a') + ')');
        if (downloadStatus) {
          downloadStatus.textContent = 'Loaded saved board (' + soundCount + ' sound' + (soundCount === 1 ? '' : 's') + ').';
          setTimeout(function () {
            if (downloadStatus && downloadStatus.textContent && downloadStatus.textContent.startsWith('Loaded saved board')) {
              downloadStatus.textContent = '';
            }
          }, 3000);
        }
        setBoard(Board.normalizeBoard(saved));
        return;
      }
      if (saved) {
        const validation = Board.validateBoard(saved);
        console.warn('[soundboard] load: saved board failed validation', validation && validation.error);
      } else {
        console.info('[soundboard] load: no saved board found in localStorage or IndexedDB; loading sample.');
      }
      loadSampleBoardOrEmpty();
    }).catch((err) => {
      console.warn('[soundboard] load: loadBoardLatest failed', err);
      loadSampleBoardOrEmpty();
    });
  }

  function loadSampleBoardOrEmpty() {
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

  // Map<localImageId, objectUrl> populated as IDB resolution completes.
  const resolvedImageUrls = new Map();

  /**
   * If the URL is a data:image URL, store the bytes in IndexedDB and return
   * a `local-image:<id>` reference. Otherwise return the URL unchanged.
   * Falls back to returning the data URL if IndexedDB is unavailable.
   */
  function internImageUrl(url) {
    const LocalImages = window.SoundboardLocalImages;
    if (typeof url !== 'string' || !url.startsWith('data:image')) return Promise.resolve(url);
    if (!LocalImages || !LocalImages.putDataUrl) return Promise.resolve(url);
    return LocalImages.putDataUrl(url).then((id) => {
      // Warm the resolved-url cache immediately so the next render picks it up.
      LocalImages.getObjectUrl(id).then((objUrl) => {
        if (objUrl) resolvedImageUrls.set(id, objUrl);
      }).catch(() => {});
      return 'local-image:' + id;
    }).catch((err) => {
      console.warn('soundboard: intern image failed; keeping data URL', err);
      return url;
    });
  }

  function isLocalImageRef(url) {
    return typeof url === 'string' && url.startsWith('local-image:');
  }

  function localImageIdOf(url) {
    return isLocalImageRef(url) ? url.slice('local-image:'.length) : '';
  }

  function resolveImageUrl(url) {
    if (!url) return '';
    if (!isLocalImageRef(url)) return url;
    const id = localImageIdOf(url);
    return resolvedImageUrls.get(id) || '';
  }

  // Expose a synchronous resolver so the renderer doesn't need to know about IDB.
  window.SoundboardImageResolver = {
    resolve: resolveImageUrl,
    isLocalImageRef: isLocalImageRef
  };

  function prewarmLocalImages(sounds) {
    const LocalImages = window.SoundboardLocalImages;
    if (!LocalImages || !LocalImages.getObjectUrl) return;
    const ids = new Set();
    (Array.isArray(sounds) ? sounds : []).forEach((s) => {
      if (s && isLocalImageRef(s.imageUrl)) ids.add(localImageIdOf(s.imageUrl));
    });
    if (!ids.size) return;
    let resolved = 0;
    ids.forEach((id) => {
      if (resolvedImageUrls.has(id)) { resolved++; return; }
      LocalImages.getObjectUrl(id).then((url) => {
        if (url) resolvedImageUrls.set(id, url);
        resolved++;
        // Re-render once all have completed so tiles pick up the image URLs.
        if (resolved >= ids.size) {
          try { render(); } catch (e) { console.warn('soundboard: render after image prewarm failed', e); }
        }
      }).catch((err) => {
        console.warn('soundboard: local-image resolve failed', id, err);
        resolved++;
        if (resolved >= ids.size) {
          try { render(); } catch (e) { console.warn('soundboard: render after image prewarm failed', e); }
        }
      });
    });
  }

  /**
   * One-time migration: any sound with a data:image/... URL is pulled out of
   * the board JSON and stored as local-image:<id> in IndexedDB. This keeps the
   * board JSON small enough to fit in localStorage even with many images.
   * Idempotent (skips sounds already using local-image:).
   */
  function migrateInlineImagesToIdb(board) {
    if (!board || !Array.isArray(board.sounds)) return Promise.resolve(false);
    const LocalImages = window.SoundboardLocalImages;
    if (!LocalImages || !LocalImages.putDataUrl) return Promise.resolve(false);
    const targets = board.sounds.filter((s) => s && typeof s.imageUrl === 'string' && s.imageUrl.startsWith('data:image'));
    if (!targets.length) return Promise.resolve(false);
    let migrated = 0;
    return targets.reduce((p, s) => p.then(() => {
      return LocalImages.putDataUrl(s.imageUrl).then((newId) => {
        s.imageUrl = 'local-image:' + newId;
        migrated++;
        return LocalImages.getObjectUrl(newId).then((u) => {
          if (u) resolvedImageUrls.set(newId, u);
        });
      }).catch((err) => {
        console.warn('soundboard: image migration skipped', err);
      });
    }), Promise.resolve()).then(() => {
      if (migrated > 0 && Storage && Storage.setSchemaVersion) {
        Storage.setSchemaVersion(Storage.SCHEMA_VERSION || 2);
        saveToStorageNow();
      }
      return migrated > 0;
    });
  }

  function setBoard(board) {
    currentBoard = board;
    if (boardNameEl) {
      boardNameEl.textContent = board.name || t('board.defaultName');
      boardNameEl.title = t('board.renameTitle');
    }
    categoryUiState = loadCategoryUiState();
    categoryOrder = loadCategoryOrder();
    favouriteIds = loadFavourites();
    recentIds = loadRecents();
    applyQuickAccessFromBoard(board);
    quickAccessCollapsed = loadQuickAccessCollapsedState();
    favouriteReorderMode = false;
    reorderMode = false;
    pruneQuickAccessState();
    buildHotkeyMap();
    refreshCategorySuggestions();
    prewarmLocalImages(board.sounds);
    render();
    initBoardTitle();
    updateStorageInfo();
    if (Audio && board.sounds && board.sounds.length) {
      Audio.preloadSounds(board.sounds);
    }
    runAutoAnalyzeOnLoad();
    // Background-migrate inline data: images to IDB so the JSON shrinks. We do
    // this AFTER initial render so the user sees the board immediately.
    setTimeout(function () {
      migrateInlineImagesToIdb(board).then(function (migrated) {
        if (migrated) {
          // Re-resolve any newly stored local-image: refs and re-render.
          prewarmLocalImages(board.sounds);
          render();
        }
      }).catch(function (err) {
        console.warn('soundboard: image migration failed', err);
      });
    }, 100);
  }

  function shouldAnalyzeSound(sound) {
    if (!sound || !sound.fileUrl) return false;
    const gain = sound.extra && typeof sound.extra === 'object' ? sound.extra.normGain : null;
    return !(typeof gain === 'number' && isFinite(gain));
  }

  function runAutoAnalyzeOnLoad() {
    if (!Audio || !Audio.analyzeFileUrl) return;
    if (!Audio.getAutoLevelEnabled || !Audio.getAutoLevelEnabled()) return;
    analyzeAllSounds({ onlyMissing: true, silent: true });
  }

  function buildHotkeyMap() {
    hotkeyMap.clear();
    if (!currentBoard || !currentBoard.sounds) return;
    currentBoard.sounds.forEach((s) => {
      const key = normalizeHotkeyInput(s.hotkey || '');
      s.hotkey = key;
      if (!key) return;
      if (!hotkeyMap.has(key)) hotkeyMap.set(key, s);
    });
  }

  function getHotkeyCounts(sounds) {
    const counts = new Map();
    (Array.isArray(sounds) ? sounds : []).forEach((s) => {
      const key = normalizeHotkeyInput(s && s.hotkey);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }

  function render() {
    if (!UI || !gridEl) return;
    const allSounds = currentBoard ? currentBoard.sounds : [];
    const filtered = getFilteredSounds();
    const hotkeyCounts = getHotkeyCounts(allSounds);
    const sharedRenderOptions = {
      hotkeyCounts,
      isFavorite: (s) => favouriteIds.has(String(s && s.id)),
      onToggleFavorite: toggleFavourite
    };
    updateSearchCount(filtered.length, Array.isArray(allSounds) ? allSounds.length : 0);
    renderQuickAccess(filtered, hotkeyCounts);

    if (!Array.isArray(allSounds) || allSounds.length === 0) {
      UI.renderGrid(gridEl, [], playingId, errorIds, onPlay, onEditSound, reorderMode, reorderSounds, sharedRenderOptions);
      updateHotkeyOnlyButton();
      updateReorderButton();
      return;
    }

    if (UI.renderGroupedGrid) {
      const groups = buildGroups(filtered);
      UI.renderGroupedGrid(
        gridEl,
        groups,
        playingId,
        errorIds,
        onPlay,
        onEditSound,
        reorderMode,
        null,
        sharedRenderOptions,
        {
          isCollapsed: (key) => categoryUiState && categoryUiState[String(key)] === false,
          onToggleCategory: (key) => {
            const k = String(key);
            const current = categoryUiState && Object.prototype.hasOwnProperty.call(categoryUiState, k) ? categoryUiState[k] : true;
            categoryUiState[k] = !current;
            saveCategoryUiState();
            render();
          },
          onReorderCategory: reorderCategories,
          onReorderSound: reorderSoundById
        }
      );
    } else {
      UI.renderGrid(gridEl, filtered, playingId, errorIds, onPlay, onEditSound, reorderMode, reorderSounds, sharedRenderOptions);
    }
    updateHotkeyOnlyButton();
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

  function normalizeCategoryValue(categoryKey) {
    const key = String(categoryKey || '').trim();
    return key === 'Uncategorized' ? '' : key;
  }

  function reorderSoundById(soundId, targetCategoryKey, beforeSoundId, place) {
    if (!currentBoard || !Array.isArray(currentBoard.sounds)) return;
    const arr = currentBoard.sounds;
    const fromIndex = arr.findIndex((s) => s.id === soundId);
    if (fromIndex < 0) return;

    const moving = arr[fromIndex];
    const targetCategory = normalizeCategoryValue(targetCategoryKey);
    moving.category = targetCategory;

    arr.splice(fromIndex, 1);

    let insertAt = arr.length;
    if (beforeSoundId) {
      const toIndex = arr.findIndex((s) => s.id === beforeSoundId);
      if (toIndex >= 0) insertAt = place === 'after' ? toIndex + 1 : toIndex;
    } else {
      for (let i = arr.length - 1; i >= 0; i--) {
        const cat = normalizeCategoryValue(arr[i].category || '');
        if (cat === targetCategory) {
          insertAt = i + 1;
          break;
        }
      }
    }

    arr.splice(insertAt, 0, moving);
    saveToStorage();
    refreshCategorySuggestions();
    render();
  }

  function setReorderMode(active) {
    reorderMode = !!active;
    if (reorderMode) favouriteReorderMode = false;
    render();
  }

  function setFavouriteReorderMode(active) {
    favouriteReorderMode = !!active;
    if (favouriteReorderMode) reorderMode = false;
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

  function ensureAutoAnalysis(sound) {
    if (!sound || !Audio) return;
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
  }

  function startPlayback(sound, options = {}) {
    if (!sound || !Audio) return;
    const squelch = options.squelch !== false;
    ensureAutoAnalysis(sound);
    recordRecentPlay(sound.id);
    if (squelch) {
      if (Audio.stopSound) Audio.stopSound();
      playingId = null;
      render();
    }
    playingId = sound.id;
    render();
    Audio.playSound(sound).then(async (played) => {
      if (!played) {
        errorIds.add(sound.id);
        if (UI && gridEl) UI.updateTileState(gridEl, sound.id, 'error');
        if (downloadStatus) {
          let msg = 'Audio failed to load.';
          try {
            const fileUrl = String(sound && sound.fileUrl ? sound.fileUrl : '');
            if (fileUrl.startsWith('local:')) {
              const LocalAudio = window.SoundboardLocalAudio;
              const blobId = fileUrl.slice(6);
              if (LocalAudio && LocalAudio.getBlob) {
                const buf = await LocalAudio.getBlob(blobId);
                if (!buf) msg = 'Audio missing from local storage. Re-import the ZIP (or run “Download all sounds”, then export again).';
              } else {
                msg = 'Local audio storage not available in this browser session.';
              }
            }
          } catch (_) {}
          downloadStatus.textContent = msg;
          setTimeout(function () { if (downloadStatus) downloadStatus.textContent = ''; }, 4000);
        }
      }
      if (playingId === sound.id) {
        playingId = null;
        if (UI && gridEl) UI.updateTileState(gridEl, sound.id, 'idle');
      }
      render();
    });
  }

  function onPlay(sound, mode) {
    if (!sound || !Audio) return;
    if (mode === 'momentary-stop') {
      if (Audio.stopSound) Audio.stopSound(sound.id);
      if (playingId === sound.id) {
        playingId = null;
        render();
      }
      return;
    }
    if (mode === 'momentary-start' || sound.momentary) {
      if (playingId === sound.id) return;
      startPlayback(sound, { squelch: false });
      return;
    }
    if (playingId === sound.id) {
      if (Audio.stopSound) Audio.stopSound();
      playingId = null;
      render();
      return;
    }
    startPlayback(sound);
  }

  function onEditSound(sound) {
    if (!modalEl || !modalForm) return;
    openModal(sound);
  }

  // Debounced save: many UI actions trigger saveToStorage() in rapid succession.
  // We coalesce them into a single persistence write (~300 ms after the last
  // edit) to avoid repeated JSON.stringify of multi-MB boards and to reduce
  // the chance of repeatedly tripping the localStorage quota.
  const SAVE_DEBOUNCE_MS = 300;
  let savePendingTimer = null;
  let savePending = false;
  let lastSavePromise = Promise.resolve();

  function saveToStorageNow() {
    if (!currentBoard || !Storage) return Promise.resolve();
    savePending = false;
    if (savePendingTimer) {
      clearTimeout(savePendingTimer);
      savePendingTimer = null;
    }
    // Embed favourites/recents in the board itself so portable ZIP and
    // cross-device restore retains quick-access state.
    syncQuickAccessToBoard();
    currentBoard.updatedAt = new Date().toISOString();
    const soundCount = Array.isArray(currentBoard.sounds) ? currentBoard.sounds.length : 0;
    console.info('[soundboard] save: starting (sounds=' + soundCount + ', updatedAt=' + currentBoard.updatedAt + ')');
    // Also persist to the attached portable ZIP file, if any.
    scheduleFileModeWrite();
    lastSavePromise = Promise.resolve(Storage.saveBoard(currentBoard))
      .then((location) => {
        console.info('[soundboard] save: success -> ' + location);
        if (location === 'idb' && downloadStatus) {
          // Friendly note when we transition into IDB (typically because the
          // board has grown beyond the localStorage quota).
          downloadStatus.textContent = 'Saved to local database.';
          setTimeout(function () {
            if (downloadStatus && downloadStatus.textContent === 'Saved to local database.') {
              downloadStatus.textContent = '';
            }
          }, 1800);
        }
        updateStorageInfo();
        return location;
      })
      .catch((err) => {
        console.warn('[soundboard] save: FAILED', err);
        if (downloadStatus) {
          downloadStatus.textContent = 'Save failed. Storage may be full or blocked.';
          setTimeout(function () {
            if (downloadStatus && downloadStatus.textContent === 'Save failed. Storage may be full or blocked.') {
              downloadStatus.textContent = '';
            }
          }, 4000);
        }
      });
    return lastSavePromise;
  }

  function updateStorageInfo() {
    if (!storageInfoEl) return;
    try {
      const location = Storage && Storage.getBoardLocation ? Storage.getBoardLocation() : 'local';
      const soundCount = currentBoard && Array.isArray(currentBoard.sounds) ? currentBoard.sounds.length : 0;
      const locationLabel = location === 'idb' ? 'IndexedDB' : 'browser storage';
      storageInfoEl.textContent = 'Saved to ' + locationLabel + ' \u00b7 ' + soundCount + ' sound' + (soundCount === 1 ? '' : 's') + '.';
    } catch (err) {
      console.warn('soundboard: updateStorageInfo failed', err);
    }
  }

  function saveToStorage() {
    if (!currentBoard || !Storage) return;
    savePending = true;
    if (savePendingTimer) clearTimeout(savePendingTimer);
    savePendingTimer = setTimeout(function () {
      savePendingTimer = null;
      saveToStorageNow();
    }, SAVE_DEBOUNCE_MS);
  }

  function flushSaveToStorage() {
    if (!savePending) return lastSavePromise;
    return saveToStorageNow();
  }

  // Make sure the last edit is persisted before the user navigates away.
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', function () {
      if (savePending) {
        // Synchronous-ish: we still call saveToStorageNow, but Storage.saveBoard
        // will at least attempt localStorage synchronously (the IDB fallback
        // promise may not finish before unload — acceptable since it began).
        try { saveToStorageNow(); } catch (err) { console.warn('soundboard: flush on unload failed', err); }
      }
    });
    window.addEventListener('pagehide', function () {
      if (savePending) {
        try { saveToStorageNow(); } catch (err) { console.warn('soundboard: flush on pagehide failed', err); }
      }
    });
  }

  function refreshCategorySuggestions() {
    if (!categoryOptionsEl || !currentBoard || !Array.isArray(currentBoard.sounds)) return;
    const set = new Set();
    currentBoard.sounds.forEach((s) => {
      const category = (s && s.category ? String(s.category) : '').trim();
      if (category) set.add(category);
    });
    const categories = Array.from(set).sort((a, b) => a.localeCompare(b));
    categoryOptionsEl.textContent = '';
    categories.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      categoryOptionsEl.appendChild(opt);
    });
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
    favouriteIds.delete(String(sound.id));
    recentIds = (recentIds || []).filter((id) => id !== String(sound.id));
    saveFavourites();
    saveRecents();
    saveToStorageNow();
    closeModal();
    render();
  }

  function syncOverlayBodyLock() {
    if (!document || !document.body) return;
    const modalOpen = !!(modalEl && !modalEl.hidden);
    const settingsOpen = !!(settingsScreenEl && !settingsScreenEl.hidden);
    const helpOpen = !!(helpScreenEl && !helpScreenEl.hidden);
    document.body.classList.toggle('body--overlay-open', modalOpen || settingsOpen || helpOpen);
  }

  function focusWithoutScroll(el) {
    if (!el || typeof el.focus !== 'function') return;
    try {
      el.focus({ preventScroll: true });
    } catch (_) {
      el.focus();
    }
  }

  function openModal(sound) {
    if (!modalEl || !modalForm) return;
    modalEl.dataset.soundId = sound ? sound.id : '';
    const uploadInput = document.getElementById('upload-audio-input');
    const uploadedHint = document.getElementById('uploaded-audio-hint');
    if (uploadInput) uploadInput.value = '';
    if (modalForm.dataset) delete modalForm.dataset.pendingBlobId;
    if (modalForm.dataset) delete modalForm.dataset.originalLocalFileUrl;
    if (uploadedHint) uploadedHint.textContent = '';
    if (modalForm) {
      const rawFileUrl = sound && sound.fileUrl != null ? String(sound.fileUrl) : '';
      const trimmedFileUrl = rawFileUrl.trim();
      const isLocal = !!trimmedFileUrl && trimmedFileUrl.startsWith('local:');
      // Important: keep local blob id so saving hotkeys/edits doesn't fail with
      // "Provide an audio URL or upload a file." after ZIP/local import.
      if (isLocal && modalForm.dataset) {
        modalForm.dataset.pendingBlobId = trimmedFileUrl.slice(6);
        modalForm.dataset.originalLocalFileUrl = trimmedFileUrl;
      }
      modalForm.querySelector('[name="title"]').value = sound ? sound.title : '';
      modalForm.querySelector('[name="fileUrl"]').value = isLocal ? '' : (sound ? String(sound.fileUrl || '') : '');
      if (isLocal && uploadedHint) uploadedHint.textContent = 'Audio: saved locally';
      modalForm.querySelector('[name="imageUrl"]').value = sound ? sound.imageUrl || '' : '';
      modalForm.querySelector('[name="category"]').value = sound ? sound.category || '' : '';
      modalForm.querySelector('[name="hotkey"]').value = sound ? normalizeHotkeyInput(sound.hotkey || '') : '';
      const volPct = sound ? Math.round((sound.volume != null ? sound.volume : 1) * 100) : 100;
      modalForm.querySelector('[name="volume"]').value = String(volPct);
      const speed = sound && sound.playbackRate != null ? sound.playbackRate : 1;
      modalForm.querySelector('[name="playbackRate"]').value = String(Math.max(0.5, Math.min(2, speed)));
      updateSpeedValue(parseFloat(modalForm.querySelector('[name="playbackRate"]').value));
      const loopCheck = modalForm.querySelector('[name="loop"]');
      if (loopCheck) loopCheck.checked = !!(sound && sound.loop);
      const momentaryCheck = modalForm.querySelector('[name="momentary"]');
      if (momentaryCheck) momentaryCheck.checked = !!(sound && sound.momentary);
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
    syncOverlayBodyLock();
    if (modalError) modalError.textContent = '';
    const titleInput = modalForm.querySelector('[name="title"]');
    if (titleInput && window && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => {
        if (!modalEl.hidden) focusWithoutScroll(titleInput);
      });
    }
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
    syncOverlayBodyLock();
  }

  function confirmDiscardSettingsChanges() {
    return window.confirm('You have unsaved settings changes. Discard them?');
  }

  function openSettingsScreen() {
    if (!settingsScreenEl || !settingsListEl || !currentBoard) return;
    if (!settingsScreenEl.hidden) {
      focusWithoutScroll(settingsSearchEl);
      return;
    }
    settingsListEl.textContent = '';
    if (settingsSearchEl) settingsSearchEl.value = '';
    if (settingsSearchCountEl) settingsSearchCountEl.textContent = '';
    clearSettingsFeedback();
    clearSettingsValidationState();
    setSettingsDirty(false);
    settingsRenderIndex = 0;
    appendSettingsRows(SETTINGS_BATCH_SIZE);
    settingsPreviouslyFocused = document.activeElement;
    filterSettingsRows('');
    settingsScreenEl.hidden = false;
    settingsScreenEl.setAttribute('aria-hidden', 'false');
    settingsScreenEl.classList.add('settings-screen--open');
    syncOverlayBodyLock();
    focusWithoutScroll(settingsSearchEl);
  }

  function closeSettingsScreen(options = {}) {
    if (!settingsScreenEl) return;
    const force = !!options.force;
    if (!force && hasUnsavedSettingsChanges() && !confirmDiscardSettingsChanges()) {
      setSettingsFeedback('Continue editing or save your changes before closing.', 'error');
      return false;
    }
    settingsScreenEl.classList.remove('settings-screen--open');
    settingsScreenEl.hidden = true;
    settingsScreenEl.setAttribute('aria-hidden', 'true');
    clearSettingsValidationState();
    clearSettingsFeedback();
    setSettingsDirty(false);
    syncOverlayBodyLock();
    if (settingsPreviouslyFocused && typeof settingsPreviouslyFocused.focus === 'function') {
      focusWithoutScroll(settingsPreviouslyFocused);
    }
    return true;
  }

  function openHelpScreen() {
    if (!helpScreenEl) return;
    helpScreenEl.hidden = false;
    helpScreenEl.setAttribute('aria-hidden', 'false');
    syncOverlayBodyLock();
  }

  function closeHelpScreen() {
    if (!helpScreenEl) return;
    helpScreenEl.hidden = true;
    helpScreenEl.setAttribute('aria-hidden', 'true');
    syncOverlayBodyLock();
  }

  function trapFocusInSettingsScreen(e) {
    if (!settingsScreenEl || settingsScreenEl.hidden || e.key !== 'Tab') return;
    const focusables = Array.from(settingsScreenEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
      return;
    }
    if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function parseBlerpSoundId(url) {
    const m = String(url || '').match(/\/soundbites\/([a-zA-Z0-9]+)/);
    return m ? m[1] : null;
  }

  function parseYouTubeVideoId(url) {
    const text = String(url || '').trim();
    let m = text.match(/[?&]v=([a-zA-Z0-9_-]{6,})/);
    if (m && m[1]) return m[1];
    m = text.match(/youtu\.be\/([a-zA-Z0-9_-]{6,})/);
    if (m && m[1]) return m[1];
    m = text.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{6,})/);
    if (m && m[1]) return m[1];
    return null;
  }

  function detectWebSource(url) {
    const text = String(url || '').toLowerCase();
    if (text.includes('blerp.com/soundbites/')) return 'blerp';
    if (text.includes('youtube.com') || text.includes('youtu.be')) return 'youtube';
    return null;
  }

  function parseFirstAudioUrlFromText(text) {
    if (!text) return null;
    // Prefer direct audio links found in HTML/JSON blobs.
    const direct = text.match(/https?:\/\/[^"'\\\s<>]+?\.(mp3|wav|ogg|m4a)(\?[^"'\\\s<>]*)?/i);
    if (direct && direct[0]) return direct[0];
    // Fallback: look for escaped URL chunks that include common audio hosts/paths.
    const escaped = text.match(/https?:\\\/\\\/[^"'<>]+/i);
    if (escaped && escaped[0]) {
      return escaped[0].replace(/\\\//g, '/');
    }
    return null;
  }

  function createDraftWebSound(params) {
    const sound = Board.normalizeSound({
      id: Board.generateId(),
      title: params.title || 'New Web Sound',
      fileUrl: params.fileUrl || '',
      imageUrl: params.imageUrl || '',
      category: params.category || 'Web',
      tags: [],
      volume: 1,
      playbackRate: 1,
      loop: false,
      startMs: null,
      endMs: null,
      hotkey: '',
      color: '#6b7280',
      extra: params.extra || {}
    });
    currentBoard.sounds.push(sound);
    buildHotkeyMap();
    saveToStorage();
    render();
    openModal(sound);
  }

  async function addFromWebUrl() {
    if (!currentBoard) return;
    const url = window.prompt(
      'Add Web Sound\n\nSupported source links:\n- Blerp sound link\n- YouTube video link\n\nPaste one link below:',
      'https://blerp.com/soundbites/'
    );
    if (!url) return;
    const normalized = String(url).trim();
    if (!/^https?:\/\//i.test(normalized)) {
      alert('Please enter a full URL that starts with http:// or https://');
      return;
    }

    const source = detectWebSource(normalized);
    if (!source) {
      alert('Unsupported link. Please paste a Blerp sound URL or a YouTube video URL.');
      return;
    }

    if (source === 'blerp') {
      const soundId = parseBlerpSoundId(normalized);
      if (!soundId) {
        alert('That does not look like a Blerp sound URL. Example: https://blerp.com/soundbites/<id>');
        return;
      }
      const fetchTargets = [
        normalized,
        'https://r.jina.ai/http://' + normalized.replace(/^https?:\/\//i, '')
      ];
      let title = 'Blerp ' + soundId;
      let fileUrl = null;
      let imageUrl = '';
      for (const target of fetchTargets) {
        try {
          const res = await fetch(target);
          if (!res.ok) continue;
          const text = await res.text();
          const titleMatch = text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
          if (titleMatch && titleMatch[1]) title = titleMatch[1];
          const imgMatch = text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
          if (imgMatch && imgMatch[1]) imageUrl = imgMatch[1];
          const parsedAudio = parseFirstAudioUrlFromText(text);
          if (parsedAudio) {
            fileUrl = parsedAudio;
            break;
          }
        } catch (_) {}
      }
      if (!fileUrl) {
        createDraftWebSound({
          title,
          fileUrl: '',
          imageUrl,
          category: 'Blerp',
          extra: { source: 'blerp', blerpUrl: normalized, blerpId: soundId }
        });
        alert('Could not auto-extract audio from Blerp. I opened the sound editor with details pre-filled so you can paste the final audio URL and save.');
        return;
      }
      createDraftWebSound({
        title,
        fileUrl,
        imageUrl,
        category: 'Blerp',
        extra: { source: 'blerp', blerpUrl: normalized, blerpId: soundId }
      });
      return;
    }

    if (source === 'youtube') {
      const videoId = parseYouTubeVideoId(normalized);
      if (!videoId) {
        alert('That does not look like a valid YouTube video URL.');
        return;
      }
      let title = 'YouTube ' + videoId;
      let imageUrl = 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg';
      let fileUrl = null;

      // Metadata is usually easy; direct playable audio URL is often restricted.
      try {
        const noembed = await fetch('https://noembed.com/embed?url=' + encodeURIComponent(normalized));
        if (noembed.ok) {
          const data = await noembed.json();
          if (data && data.title) title = data.title;
          if (data && data.thumbnail_url) imageUrl = data.thumbnail_url;
        }
      } catch (_) {}

      const fetchTargets = [
        normalized,
        'https://r.jina.ai/http://' + normalized.replace(/^https?:\/\//i, '')
      ];
      for (const target of fetchTargets) {
        try {
          const res = await fetch(target);
          if (!res.ok) continue;
          const text = await res.text();
          const parsedAudio = parseFirstAudioUrlFromText(text);
          if (parsedAudio) {
            fileUrl = parsedAudio;
            break;
          }
        } catch (_) {}
      }

      createDraftWebSound({
        title,
        fileUrl: fileUrl || '',
        imageUrl,
        category: 'YouTube',
        extra: { source: 'youtube', youtubeUrl: normalized, youtubeVideoId: videoId }
      });

      if (!fileUrl) {
        alert('Imported YouTube metadata, but could not auto-extract a direct audio file URL. I opened the editor so you can paste an audio URL and save.');
      }
    }
  }

  function saveAllSettingsChanges(options = {}) {
    if (!settingsScreenEl || !settingsListEl || !currentBoard) return;
    const closeAfterSave = options.closeAfterSave !== false;
    ensureAllSettingsRowsRendered();
    clearSettingsValidationState();
    clearSettingsFeedback();
    const rows = Array.from(settingsListEl.querySelectorAll('.settings-row'));
    const nextSounds = [];
    const firstInvalid = { row: null, field: null };
    const hotkeyOwners = new Map();
    const pendingById = new Map();
    const nextFavouriteIds = new Set();

    function trackInvalid(row, field, message) {
      setSettingsRowError(row, field, message);
      if (!firstInvalid.row) {
        firstInvalid.row = row;
        firstInvalid.field = field;
      }
    }

    for (const row of rows) {
      const id = row.dataset.soundId;
      const existing = currentBoard.sounds.find((s) => s.id === id);
      if (!existing) continue;

      const shouldDelete = !!(row.querySelector('[data-field="delete"]') && row.querySelector('[data-field="delete"]').checked);
      if (shouldDelete) continue;
      const shouldFavorite = !!(row.querySelector('[data-field="favorite"]') && row.querySelector('[data-field="favorite"]').checked);

      const title = ((row.querySelector('[data-field="title"]') || {}).value || '').trim();
      const fileUrl = ((row.querySelector('[data-field="fileUrl"]') || {}).value || '').trim();
      if (!title || !fileUrl) {
        trackInvalid(row, !title ? 'title' : 'fileUrl', 'Each kept sound needs both Title and Audio URL.');
        continue;
      }

      const volumeRaw = parseFloat(((row.querySelector('[data-field="volume"]') || {}).value || '100'));
      const volume = isNaN(volumeRaw) ? 1 : Math.max(0, Math.min(1, volumeRaw / 100));
      const speedRaw = parseFloat(((row.querySelector('[data-field="playbackRate"]') || {}).value || '1'));
      const playbackRate = isNaN(speedRaw) ? 1 : Math.max(0.5, Math.min(2, speedRaw));

      const startRaw = ((row.querySelector('[data-field="startSec"]') || {}).value || '').trim();
      const endRaw = ((row.querySelector('[data-field="endSec"]') || {}).value || '').trim();
      const startNum = startRaw === '' ? null : parseFloat(startRaw);
      const endNum = endRaw === '' ? null : parseFloat(endRaw);
      if ((startNum != null && isNaN(startNum)) || (endNum != null && isNaN(endNum))) {
        trackInvalid(row, isNaN(startNum) ? 'startSec' : 'endSec', 'Start/End seconds must be valid numbers.');
        continue;
      }
      const startMs = startNum == null ? null : Math.round(startNum * 1000);
      const endMs = endNum == null ? null : Math.round(endNum * 1000);
      if (startMs != null && endMs != null && startMs >= endMs) {
        trackInvalid(row, 'startSec', 'Start sec must be less than End sec.');
        continue;
      }

      const hotkeyRaw = ((row.querySelector('[data-field="hotkey"]') || {}).value || '').trim();
      const hotkey = normalizeHotkeyInput(hotkeyRaw);
      const hotkeyInput = row.querySelector('[data-field="hotkey"]');
      if (hotkeyInput) hotkeyInput.value = hotkey;
      if (hotkeyRaw && !hotkey) {
        trackInvalid(row, 'hotkey', 'Use a valid hotkey format (examples: Q, Shift+., Shift+A, Ctrl+Alt+P).');
        continue;
      }
      if (hotkey) {
        if (!hotkeyOwners.has(hotkey)) hotkeyOwners.set(hotkey, []);
        hotkeyOwners.get(hotkey).push({ row, title });
      }

      pendingById.set(existing.id, {
        title,
        fileUrl,
        imageUrl: ((row.querySelector('[data-field="imageUrl"]') || {}).value || '').trim(),
        category: ((row.querySelector('[data-field="category"]') || {}).value || '').trim(),
        hotkey,
        volume,
        playbackRate,
        startMs,
        endMs,
        loop: !!(row.querySelector('[data-field="loop"]') && row.querySelector('[data-field="loop"]').checked),
        momentary: !!(row.querySelector('[data-field="momentary"]') && row.querySelector('[data-field="momentary"]').checked)
      });
      nextSounds.push(existing);
      if (shouldFavorite) nextFavouriteIds.add(existing.id);
    }

    hotkeyOwners.forEach((owners, key) => {
      if (owners.length <= 1) return;
      owners.forEach((owner) => {
        trackInvalid(owner.row, 'hotkey', 'Hotkey "' + key + '" is used more than once. Choose unique keys.');
      });
    });

    if (firstInvalid.row) {
      setSettingsFeedback('Fix highlighted rows before saving.', 'error');
      firstInvalid.row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const invalidField = firstInvalid.row.querySelector('[data-field="' + firstInvalid.field + '"]');
      focusWithoutScroll(invalidField || firstInvalid.row);
      return;
    }

    nextSounds.forEach((sound) => {
      const pending = pendingById.get(sound.id);
      if (!pending) return;
      sound.title = pending.title;
      sound.fileUrl = pending.fileUrl;
      sound.imageUrl = pending.imageUrl;
      sound.category = pending.category;
      sound.hotkey = pending.hotkey;
      sound.volume = pending.volume;
      sound.playbackRate = pending.playbackRate;
      sound.startMs = pending.startMs;
      sound.endMs = pending.endMs;
      sound.loop = pending.loop;
      sound.momentary = pending.momentary;
    });

    currentBoard.sounds = nextSounds;
    favouriteIds = nextFavouriteIds;
    saveFavourites();
    buildHotkeyMap();
    saveToStorage();
    refreshCategorySuggestions();
    setSettingsDirty(false);
    setSettingsFeedback('Settings saved successfully.', 'success');
    if (closeAfterSave) closeSettingsScreen({ force: true });
    if (!closeAfterSave && downloadStatus) {
      downloadStatus.textContent = 'Settings saved.';
      setTimeout(function () { if (downloadStatus) downloadStatus.textContent = ''; }, 1400);
    }
    render();
  }

  function filterSettingsRows(query) {
    if (!settingsListEl) return;
    const q = String(query || '').trim().toLowerCase();
    if (q) ensureAllSettingsRowsRendered();
    const rows = Array.from(settingsListEl.querySelectorAll('.settings-row'));
    let shown = 0;
    rows.forEach((row) => {
      const text = (row.dataset.searchText || '').toLowerCase();
      const visible = !q || text.includes(q);
      row.hidden = !visible;
      if (visible) shown++;
    });
    if (settingsSearchCountEl) {
      settingsSearchCountEl.textContent = shown + '/' + rows.length;
    }
    updateSettingsRenderedCount();
    updateSettingsLoadMoreVisibility();
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
    let fileUrl = pendingBlobId ? ('local:' + pendingBlobId) : (modalForm.querySelector('[name="fileUrl"]').value || '').trim();
    if (!fileUrl) {
      const originalLocal = modalForm.dataset && modalForm.dataset.originalLocalFileUrl ? String(modalForm.dataset.originalLocalFileUrl).trim() : '';
      if (originalLocal.startsWith('local:')) fileUrl = originalLocal;
    }
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
    const momentaryCheck = modalForm.querySelector('[name="momentary"]');
    const momentary = momentaryCheck ? momentaryCheck.checked : false;
    const startSecRaw = modalForm.querySelector('[name="startSec"]').value.trim();
    const endSecRaw = modalForm.querySelector('[name="endSec"]').value.trim();
    const startSec = startSecRaw === '' ? null : parseFloat(startSecRaw);
    const endSec = endSecRaw === '' ? null : parseFloat(endSecRaw);
    if ((startSec != null && isNaN(startSec)) || (endSec != null && isNaN(endSec))) {
      if (modalError) modalError.textContent = 'Start/End must be valid numbers.';
      return;
    }
    const startMs = startSec == null ? null : Math.round(startSec * 1000);
    const endMs = endSec == null ? null : Math.round(endSec * 1000);
    if (startMs != null && endMs != null && startMs >= endMs) {
      if (modalError) modalError.textContent = 'Start must be less than end.';
      return;
    }
    const hotkeyRaw = (modalForm.querySelector('[name="hotkey"]').value || '').trim();
    const hotkey = normalizeHotkeyInput(hotkeyRaw);
    if (hotkeyRaw && !hotkey) {
      if (modalError) modalError.textContent = 'Use a valid hotkey format (examples: Q, Shift+., Shift+A, Ctrl+Alt+P).';
      return;
    }

    let sound = currentBoard.sounds.find((s) => s.id === id);
    const conflict = hotkey
      ? currentBoard.sounds.find((s) => s.id !== (sound ? sound.id : id) && normalizeHotkeyInput(s.hotkey) === hotkey)
      : null;
    if (conflict) {
      if (modalError) modalError.textContent = 'Hotkey "' + hotkey + '" is already used by "' + (conflict.title || 'another sound') + '".';
      return;
    }
    const rawImageUrl = (modalForm.querySelector('[name="imageUrl"]').value || '').trim();
    if (sound) {
      sound.title = title;
      sound.fileUrl = fileUrl;
      sound.imageUrl = rawImageUrl;
      sound.category = (modalForm.querySelector('[name="category"]').value || '').trim();
      sound.hotkey = hotkey;
      sound.volume = volume;
      sound.playbackRate = playbackRate;
      sound.loop = loop;
      sound.momentary = momentary;
      sound.startMs = startMs;
      sound.endMs = endMs;
    } else {
      sound = Board.normalizeSound({
        id: Board.generateId(),
        title,
        fileUrl,
        imageUrl: rawImageUrl,
        category: (modalForm.querySelector('[name="category"]').value || '').trim(),
        tags: [],
        volume,
        playbackRate,
        loop,
        momentary,
        startMs,
        endMs,
        hotkey,
        color: '#6b7280',
        extra: {}
      });
      currentBoard.sounds.push(sound);
    }
    const finishSave = () => {
      saveToStorage();
      buildHotkeyMap();
      refreshCategorySuggestions();
      closeModal();
      render();
    };
    // If the user pasted a data: image URL, intern it into IDB so the board JSON
    // stays small. The intern is async; we still finish the rest of the save now.
    if (rawImageUrl.startsWith('data:image')) {
      internImageUrl(rawImageUrl).then((newUrl) => {
        sound.imageUrl = newUrl;
        finishSave();
      }).catch(() => finishSave());
    } else {
      finishSave();
    }
  }

  function exportBoard() {
    if (!currentBoard) return;
    syncQuickAccessToBoard();
    const json = JSON.stringify(Board.normalizeBoard(currentBoard), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const name = (currentBoard.name || 'board').replace(/[^a-z0-9-_]/gi, '-') + '.json';
    shareOrDownloadBlob(blob, name, 'application/json');
  }

  function guessMimeFromPath(path, fallback = 'application/octet-stream') {
    const p = String(path || '').toLowerCase();
    if (p.endsWith('.png')) return 'image/png';
    if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
    if (p.endsWith('.webp')) return 'image/webp';
    if (p.endsWith('.gif')) return 'image/gif';
    if (p.endsWith('.svg')) return 'image/svg+xml';
    if (p.endsWith('.mp3')) return 'audio/mpeg';
    if (p.endsWith('.wav')) return 'audio/wav';
    if (p.endsWith('.ogg')) return 'audio/ogg';
    if (p.endsWith('.m4a')) return 'audio/mp4';
    return fallback;
  }

  function safeFilenamePart(value) {
    return String(value || '')
      .trim()
      .replace(/[^a-z0-9-_\.]/gi, '-')
      .replace(/-+/g, '-')
      .slice(0, 80) || 'file';
  }

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function shareOrDownloadBlob(blob, filename, mime) {
    const name = safeFilenamePart(filename || 'file');
    const type = String(mime || (blob && blob.type) || 'application/octet-stream');
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const canFile = typeof File === 'function';
    try {
      if (nav && typeof nav.canShare === 'function' && typeof nav.share === 'function' && canFile) {
        const file = new File([blob], name, { type });
        if (nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: name });
          return;
        }
      }
    } catch (_) {}

    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      a.remove();
      // Safari/iOS can cancel downloads if we revoke too quickly.
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (_) {} }, 15000);
    }
  }

  async function exportPortableZip() {
    if (!currentBoard) return;
    if (!window.JSZip) {
      alert('ZIP export not available (JSZip missing).');
      return;
    }
    const LocalAudio = window.SoundboardLocalAudio;
    const canReadLocalAudio = !!(LocalAudio && LocalAudio.getBlob);

    // Ensure favourites/recents are written into the board snapshot BEFORE
    // we serialize it, otherwise we'd capture the stale quickAccess from the
    // last save (e.g. if the user just toggled a favourite).
    syncQuickAccessToBoard();

    const zip = new window.JSZip();
    const normalized = Board.normalizeBoard(currentBoard);
    const portable = JSON.parse(JSON.stringify(normalized));
    const warnings = [];

    const audioFolder = zip.folder('audio');
    const imagesFolder = zip.folder('images');

    const total = Array.isArray(portable.sounds) ? portable.sounds.length : 0;
    let done = 0;
    if (downloadStatus) downloadStatus.textContent = 'Building portable zip…';

    for (const s of portable.sounds) {
      done++;
      if (downloadStatus) downloadStatus.textContent = 'Packing ' + done + '/' + total + '…';
      const id = String(s.id || '');

      // Audio
      try {
        const fileUrl = String(s.fileUrl || '');
        const urlExtMatch = fileUrl && !fileUrl.startsWith('local:') ? String(fileUrl).toLowerCase().match(/\.(mp3|wav|ogg|m4a)(\?|#|$)/) : null;
        const ext = urlExtMatch ? urlExtMatch[1] : 'mp3';
        const audioName = safeFilenamePart(id) + '.' + ext;
        const audioPath = 'audio/' + audioName;
        if (fileUrl.startsWith('local:')) {
          if (!canReadLocalAudio) {
            warnings.push('Cannot access local audio storage on this device/browser. Sound may not be portable: ' + (s.title || id));
          } else {
            const blobId = fileUrl.slice(6);
            const buf = await LocalAudio.getBlob(blobId);
            if (buf) {
              audioFolder.file(audioName, buf);
              s.fileUrl = 'zip:' + audioPath;
            } else {
              warnings.push('Missing local audio for ' + id);
            }
          }
        } else if (fileUrl) {
          const res = await fetch(fileUrl, { mode: 'cors' });
          if (!res.ok) throw new Error(res.statusText || 'fetch failed');
          const buf = await res.arrayBuffer();
          audioFolder.file(audioName, buf);
          s.fileUrl = 'zip:' + audioPath;
        }
      } catch (e) {
        warnings.push('Audio fetch failed for ' + (s.title || s.id) + ': ' + (e && e.message ? e.message : 'error'));
      }

      // Image
      try {
        const imageUrl = String(s.imageUrl || '').trim();
        if (!imageUrl) continue;
        if (imageUrl.startsWith('data:')) continue; // already portable
        if (imageUrl.startsWith('zip:')) continue;

        if (imageUrl.startsWith('local-image:')) {
          // Bundle the bytes from the IDB image store.
          const LocalImages = window.SoundboardLocalImages;
          if (!LocalImages || !LocalImages.getBlob) {
            warnings.push('Local image storage unavailable for ' + (s.title || s.id));
            continue;
          }
          const localId = imageUrl.slice('local-image:'.length);
          const rec = await LocalImages.getBlob(localId);
          if (!rec || !rec.arrayBuffer) {
            warnings.push('Missing local image for ' + (s.title || s.id));
            continue;
          }
          const mime = String(rec.mime || 'image/jpeg').toLowerCase();
          const ext = mime.includes('png') ? 'png'
            : mime.includes('webp') ? 'webp'
              : mime.includes('gif') ? 'gif'
                : 'jpg';
          const imgName = safeFilenamePart(id) + '.' + ext;
          imagesFolder.file(imgName, rec.arrayBuffer);
          s.imageUrl = 'zip:images/' + imgName;
          continue;
        }

        const res = await fetch(imageUrl, { mode: 'cors' });
        if (!res.ok) throw new Error(res.statusText || 'fetch failed');
        const buf = await res.arrayBuffer();
        const contentType = res.headers && res.headers.get ? res.headers.get('content-type') : '';
        const ext = (contentType && contentType.includes('png')) ? 'png'
          : (contentType && (contentType.includes('jpeg') || contentType.includes('jpg'))) ? 'jpg'
            : (contentType && contentType.includes('webp')) ? 'webp'
              : 'jpg';
        const imgName = safeFilenamePart(id) + '.' + ext;
        imagesFolder.file(imgName, buf);
        s.imageUrl = 'zip:images/' + imgName;
      } catch (e) {
        warnings.push('Image fetch failed for ' + (s.title || s.id) + ': ' + (e && e.message ? e.message : 'error'));
      }
    }

    zip.file('board.json', JSON.stringify(portable, null, 2));
    zip.file('manifest.json', JSON.stringify({
      type: 'soundboard-portable',
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      boardName: portable.name || ''
    }, null, 2));

    const out = await zip.generateAsync({ type: 'blob' });
    const name = safeFilenamePart(portable.name || 'board') + '-portable.zip';
    await shareOrDownloadBlob(out, name, 'application/zip');

    if (downloadStatus) downloadStatus.textContent = warnings.length ? ('Portable ZIP exported (with ' + warnings.length + ' warnings).') : 'Portable ZIP exported.';
    if (warnings.length) {
      console.warn('portable export warnings', warnings);
      openPortableReport('Portable export warnings', 'Some files could not be bundled. Those sounds/images may still require an internet connection.', warnings);
      setTimeout(function () { if (downloadStatus) downloadStatus.textContent = ''; }, 4500);
    } else {
      setTimeout(function () { if (downloadStatus) downloadStatus.textContent = ''; }, 2500);
    }
  }

  async function importPortableZip(file, options) {
    if (!file) return;
    const fromFileMode = !!(options && options.fromFileMode);
    if (!window.JSZip) {
      alert('ZIP import not available (JSZip missing).');
      return;
    }
    const LocalAudio = window.SoundboardLocalAudio;
    const canPersistAudio = !!(LocalAudio && LocalAudio.putBlob);
    if (downloadStatus) downloadStatus.textContent = 'Reading zip…';
    const buf = await (file.arrayBuffer ? file.arrayBuffer() : new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(file);
    }));
    const zip = await window.JSZip.loadAsync(buf);
    const boardFile = zip.file('board.json');
    if (!boardFile) {
      alert('ZIP missing board.json');
      return;
    }
    const boardText = await boardFile.async('text');
    const parsed = JSON.parse(boardText);
    const result = Board.validateBoard(parsed);
    if (!result.ok) {
      alert('Invalid board in ZIP: ' + (result.error || 'unknown'));
      return;
    }
    const board = Board.normalizeBoard(parsed);
    const sounds = Array.isArray(board.sounds) ? board.sounds : [];
    const importNonce = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const warnings = [];
    let importedAudioCount = 0;
    let i = 0;
    for (const s of sounds) {
      i++;
      if (downloadStatus) downloadStatus.textContent = 'Importing ' + i + '/' + sounds.length + '…';

      // Audio from zip:
      const fu = String(s.fileUrl || '');
      if (fu.startsWith('zip:')) {
        const path = fu.slice(4);
        const zf = zip.file(path);
        if (zf) {
          const ab = await zf.async('arraybuffer');
          if (canPersistAudio) {
            const blobId = 'portable-' + String(board.id || 'board') + '-' + importNonce + '-' + String(s.id);
            await LocalAudio.putBlob(blobId, ab);
            s.fileUrl = 'local:' + blobId;
          } else {
            const mime = guessMimeFromPath(path, 'audio/mpeg');
            const blobUrl = URL.createObjectURL(new Blob([ab], { type: mime }));
            s.fileUrl = blobUrl;
            warnings.push('Audio is loaded for this session only (no IndexedDB): ' + (s.title || s.id));
          }
          importedAudioCount++;
        } else {
          warnings.push('Missing audio in zip: ' + path);
        }
      }

      // Image from zip -> embed as data URL:
      const iu = String(s.imageUrl || '');
      if (iu.startsWith('zip:')) {
        const path = iu.slice(4);
        const zf = zip.file(path);
        if (zf) {
          const ab = await zf.async('arraybuffer');
          const mime = guessMimeFromPath(path, 'image/jpeg');
          const LocalImages = window.SoundboardLocalImages;
          if (LocalImages && LocalImages.putBlob) {
            const newId = LocalImages.generateId();
            try {
              await LocalImages.putBlob(newId, ab, mime);
              s.imageUrl = 'local-image:' + newId;
            } catch (e) {
              console.warn('soundboard: ZIP image intern failed; falling back to data URL', e);
              const b64 = arrayBufferToBase64(ab);
              s.imageUrl = 'data:' + mime + ';base64,' + b64;
            }
          } else {
            const b64 = arrayBufferToBase64(ab);
            s.imageUrl = 'data:' + mime + ';base64,' + b64;
          }
        } else {
          warnings.push('Missing image in zip: ' + path);
        }
      }
    }

    setBoard(board);
    // Only persist when audio is persistable; otherwise we would save blob: URLs that break on refresh.
    // When we're loading from the attached file (fromFileMode), we still
    // persist to localStorage/IDB so the in-session save path is consistent.
    if (canPersistAudio) saveToStorageNow();
    if (fromFileMode) {
      // Skip writing back to the file we just read (avoid noisy round-trips).
      fileModeWritePending = false;
      if (fileModeWriteTimer) { clearTimeout(fileModeWriteTimer); fileModeWriteTimer = null; }
    }
    if (Audio && Audio.clearCache) Audio.clearCache();
    render();
    if (warnings.length) {
      openPortableReport('Portable import warnings', 'Some files referenced in the board could not be found in the ZIP.', warnings);
    }
    if (downloadStatus) {
      downloadStatus.textContent = warnings.length ? 'Portable ZIP imported (with warnings).' : 'Portable ZIP imported.';
      setTimeout(function () { if (downloadStatus) downloadStatus.textContent = ''; }, warnings.length ? 4500 : 2500);
    }
  }

  async function runPortableReadinessCheck() {
    if (!currentBoard || !Array.isArray(currentBoard.sounds)) return;
    const LocalAudio = window.SoundboardLocalAudio;
    const warnings = [];
    const sounds = currentBoard.sounds.slice();
    const total = sounds.length;

    let okAudio = 0;
    let okImage = 0;
    let needsNetAudio = 0;
    let needsNetImage = 0;

    for (let i = 0; i < total; i++) {
      const s = sounds[i];
      if (downloadStatus) downloadStatus.textContent = 'Checking portable readiness ' + (i + 1) + '/' + total + '…';

      const title = (s && (s.title || s.id)) ? String(s.title || s.id) : 'sound';
      const fileUrl = String((s && s.fileUrl) || '').trim();
      const imageUrl = String((s && s.imageUrl) || '').trim();

      // Audio
      if (!fileUrl) {
        warnings.push('Missing audio URL: ' + title);
      } else if (fileUrl.startsWith('local:')) {
        if (LocalAudio && LocalAudio.getBlob) {
          try {
            const blobId = fileUrl.slice(6);
            const buf = await LocalAudio.getBlob(blobId);
            if (buf) okAudio++;
            else warnings.push('Missing local audio blob: ' + title + ' (' + blobId + ')');
          } catch (_) {
            warnings.push('Failed reading local audio blob: ' + title);
          }
        } else {
          warnings.push('Local audio storage not available: ' + title);
        }
      } else {
        // Remote – may be blocked by CORS on export.
        needsNetAudio++;
      }

      // Image
      if (!imageUrl) {
        okImage++; // images are optional
      } else if (imageUrl.startsWith('data:')) {
        okImage++;
      } else if (imageUrl.startsWith('zip:')) {
        okImage++;
      } else if (imageUrl.startsWith('local-image:')) {
        const LocalImages = window.SoundboardLocalImages;
        if (LocalImages && LocalImages.getBlob) {
          try {
            const rec = await LocalImages.getBlob(imageUrl.slice('local-image:'.length));
            if (rec && rec.arrayBuffer) okImage++;
            else warnings.push('Missing local image: ' + title);
          } catch (_) {
            warnings.push('Failed reading local image: ' + title);
          }
        } else {
          warnings.push('Local image storage unavailable: ' + title);
        }
      } else {
        needsNetImage++;
      }
    }

    if (downloadStatus) downloadStatus.textContent = '';
    const summary = [
      'Audio: ' + okAudio + '/' + total + ' already local; ' + needsNetAudio + ' remote (may be blocked by CORS).',
      'Images: ' + okImage + '/' + total + ' already portable/blank; ' + needsNetImage + ' remote (may be blocked by CORS).',
      '',
      'Tip: run “Download all sounds” first, then export Portable ZIP.'
    ].join(' ');

    const list = warnings.slice();
    if (needsNetAudio > 0) list.push('Remote audio files will only bundle if the host allows browser downloads (CORS).');
    if (needsNetImage > 0) list.push('Remote image files will only bundle if the host allows browser downloads (CORS).');

    openPortableReport('Portable readiness check', summary, list.length ? list : ['Looks good — no obvious blockers found.']);
  }

  function downloadAllMedia() {
    if (!currentBoard || !currentBoard.sounds || currentBoard.sounds.length === 0) {
      if (downloadStatus) downloadStatus.textContent = 'No media to download.';
      return;
    }
    const LocalAudio = window.SoundboardLocalAudio;
    if (!LocalAudio || !LocalAudio.putBlob) {
      if (downloadStatus) downloadStatus.textContent = 'Local storage not available.';
      return;
    }
    var pendingAudio = currentBoard.sounds.filter(function (s) {
      return s && s.fileUrl && s.fileUrl.trim() && !String(s.fileUrl).startsWith('local:');
    });
    var pendingImages = currentBoard.sounds.filter(function (s) {
      const url = s && s.imageUrl ? String(s.imageUrl).trim() : '';
      if (!url) return false;
      if (url.startsWith('data:')) return false;
      if (url.startsWith('zip:')) return false;
      return true;
    });
    if (pendingAudio.length === 0 && pendingImages.length === 0) {
      if (downloadStatus) downloadStatus.textContent = 'All media already saved locally.';
      setTimeout(function () { if (downloadStatus) downloadStatus.textContent = ''; }, 2500);
      return;
    }
    const btn = toolbarEl && toolbarEl.querySelector('[data-action="download-sounds"]');
    if (btn) btn.disabled = true;
    const total = pendingAudio.length + pendingImages.length;
    const results = [];
    const imgResults = [];
    const warnings = [];

    function fetchAudio(index) {
      if (index >= pendingAudio.length) {
        fetchImage(0);
        return;
      }
      const s = pendingAudio[index];
      const filename = (s.title || s.id || 'sound-' + (index + 1)).replace(/[^a-z0-9-_\.]/gi, '-').slice(0, 80) + '.mp3';
      const stepN = index + 1;
      if (downloadStatus) downloadStatus.textContent = 'Downloading audio ' + stepN + '/' + total + '…';
      fetch(s.fileUrl, { mode: 'cors' })
        .then(function (r) { return r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText)); })
        .then(function (arrayBuffer) {
          results.push({ sound: s, arrayBuffer: arrayBuffer, filename: filename });
          fetchAudio(index + 1);
        })
        .catch(function (err) {
          warnings.push('Audio download failed for ' + (s.title || s.id) + ': ' + (err.message || 'fetch'));
          fetchAudio(index + 1);
        });
    }

    function fetchImage(index) {
      if (index >= pendingImages.length) {
        applyLocalAndSave(results, imgResults);
        return;
      }
      const s = pendingImages[index];
      const url = String(s.imageUrl || '').trim();
      const stepN = pendingAudio.length + index + 1;
      if (downloadStatus) downloadStatus.textContent = 'Downloading images ' + stepN + '/' + total + '…';
      fetch(url, { mode: 'cors' })
        .then(function (r) { return r.ok ? Promise.all([r.arrayBuffer(), r.headers ? r.headers.get('content-type') : '']) : Promise.reject(new Error(r.statusText)); })
        .then(function (pair) {
          imgResults.push({ sound: s, arrayBuffer: pair[0], contentType: pair[1] || '' });
          fetchImage(index + 1);
        })
        .catch(function (err) {
          warnings.push('Image download failed for ' + (s.title || s.id) + ': ' + (err.message || 'fetch'));
          fetchImage(index + 1);
        });
    }

    function applyLocalAndSave(results, imgResults) {
      if (downloadStatus) downloadStatus.textContent = 'Saving into board…';
      const LocalAudio = window.SoundboardLocalAudio;
      const LocalImages = window.SoundboardLocalImages;
      let saved = 0;
      function storeNext() {
        if (saved >= results.length) {
          results.forEach(function (r) {
            r.sound.fileUrl = 'local:downloaded-' + r.sound.id;
          });
          // Store downloaded images in IDB (local-image:) so they don't bloat the
          // board JSON and trip the localStorage quota.
          const imageStores = imgResults.map(function (r) {
            const ct = r.contentType || guessMimeFromPath(r.sound.imageUrl || '', 'image/jpeg');
            if (LocalImages && LocalImages.putBlob) {
              const newId = LocalImages.generateId();
              return LocalImages.putBlob(newId, r.arrayBuffer, ct)
                .then(function () {
                  r.sound.imageUrl = 'local-image:' + newId;
                  return LocalImages.getObjectUrl(newId).then(function (objUrl) {
                    if (objUrl) resolvedImageUrls.set(newId, objUrl);
                  });
                })
                .catch(function (e) {
                  console.warn('soundboard: image intern failed; falling back to data URL', e);
                  const b64 = arrayBufferToBase64(r.arrayBuffer);
                  r.sound.imageUrl = 'data:' + ct + ';base64,' + b64;
                });
            }
            const b64 = arrayBufferToBase64(r.arrayBuffer);
            r.sound.imageUrl = 'data:' + ct + ';base64,' + b64;
            return Promise.resolve();
          });
          Promise.all(imageStores).then(function () {
            currentBoard.updatedAt = new Date().toISOString();
            saveToStorageNow();
            if (Audio && Audio.clearCache) Audio.clearCache();
            render();
            if (warnings.length) {
              openPortableReport('Download media warnings', 'Some audio/images could not be downloaded (CORS/URL errors).', warnings);
            }
            saveFilesToDirectory(results);
          });
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

    fetchAudio(0);
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
    const momentaryCheck = modalForm.querySelector('[name="momentary"]');
    const momentary = momentaryCheck ? momentaryCheck.checked : false;
    const temp = {
      id: 'preview',
      title: 'Preview',
      fileUrl,
      volume: isNaN(volPct) ? 1 : Math.max(0, Math.min(1, volPct / 100)),
      playbackRate,
      loop,
      momentary,
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
    const isZip = /\.zip$/i.test(file.name || '') || String(file.type || '').includes('zip');
    if (isZip) {
      importPortableZip(file).catch(function (e) {
        alert('Invalid ZIP file.');
        console.warn('zip import failed', e);
      });
      return;
    }
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
        saveToStorageNow();
      } catch (e) {
        alert('Invalid JSON file.');
      }
    };
    reader.readAsText(file);
  }

  function clearLocalAudioDatabase() {
    return new Promise((resolve) => {
      if (!window || !window.indexedDB || typeof window.indexedDB.deleteDatabase !== 'function') {
        resolve();
        return;
      }
      try {
        const req = window.indexedDB.deleteDatabase('soundboard-audio');
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { resolve(); };
        req.onblocked = function () { resolve(); };
      } catch (_) {
        resolve();
      }
    });
  }

  function clearAllDataAndReset() {
    if (!window.confirm(t('confirm.clearAllData'))) return;
    if (Audio && Audio.stopSound) Audio.stopSound();
    playingId = null;
    errorIds = new Set();
    favouriteIds = new Set();
    recentIds = [];
    activeMomentaryKeys.clear();
    hotkeyMap.clear();
    try {
      if (Storage && Storage.clearBoard) Storage.clearBoard();
    } catch (_) {}
    try {
      localStorage.removeItem('soundboard-board');
      const keysToDelete = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && (
          k.startsWith('soundboard-category-state:')
          || k.startsWith('soundboard-category-order:')
          || k.startsWith(FAVOURITES_KEY_PREFIX)
          || k.startsWith(RECENTS_KEY_PREFIX)
          || k === AUTO_LEVEL_KEY
          || k === LANGUAGE_KEY
        )) {
          keysToDelete.push(k);
        }
      }
      keysToDelete.forEach((k) => localStorage.removeItem(k));
    } catch (_) {}
    clearLocalAudioDatabase().finally(function () {
      if (Audio && Audio.clearCache) Audio.clearCache();
      const url = getBoardJsonPath();
      fetch(url, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Failed to load board'))))
        .then((data) => {
          const result = Board.validateBoard(data);
          if (!result.ok) throw new Error(result.error);
          setBoard(Board.normalizeBoard(data));
        })
        .catch(() => {
          loadInitialBoard();
        })
        .finally(() => {
          if (downloadStatus) {
            downloadStatus.textContent = t('status.clearedAllData');
            setTimeout(function () {
              if (downloadStatus) downloadStatus.textContent = '';
            }, 2200);
          }
        });
    });
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
      input.value = currentBoard.name || t('board.defaultName');
      input.setAttribute('aria-label', currentLanguage === 'ko' ? '보드 이름' : 'Board name');
      function commit() {
        var name = (input.value || '').trim() || t('board.defaultName');
        currentBoard.name = name;
        saveToStorage();
        boardNameEl.removeChild(input);
        boardNameEl.textContent = name;
        boardNameEl.title = t('board.renameTitle');
      }
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
        if (e.key === 'Escape') {
          boardNameEl.removeChild(input);
          boardNameEl.textContent = currentBoard.name || t('board.defaultName');
          boardNameEl.title = t('board.renameTitle');
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
    const boardFileGroupEl = toolbarEl.querySelector('.toolbar__group--board-file');
    const addBtn = toolbarEl.querySelector('[data-action="add"]');
    const importBtn = toolbarEl.querySelector('[data-action="import"]');
    const exportBtn = toolbarEl.querySelector('[data-action="export"]');
    const exportPortableBtn = toolbarEl.querySelector('[data-action="export-portable"]');
    const portableCheckBtn = toolbarEl.querySelector('[data-action="portable-check"]');
    const clearDataBtn = toolbarEl.querySelector('[data-action="clear-data"]');
    const downloadBtn = toolbarEl.querySelector('[data-action="download-sounds"]');
    const webAddBtn = toolbarEl.querySelector('[data-action="web-add"]');
    const settingsBtn = toolbarEl.querySelector('[data-action="settings-open"]');
    const reorderBtn = toolbarEl.querySelector('[data-action="reorder-toggle"]');
    const hotkeyOnlyBtn = toolbarEl.querySelector('[data-action="hotkey-only-toggle"]');
    const analyzeAllBtn = toolbarEl.querySelector('[data-action="analyze-all"]');
    const helpBtn = toolbarEl.querySelector('[data-action="help-open"]');
    const themeBtn = toolbarEl.querySelector('[data-action="theme-toggle"]');
    if (addBtn) addBtn.addEventListener('click', addSound);
    if (importBtn && importInput) importBtn.addEventListener('click', () => importInput.click());
    if (importInput) importInput.addEventListener('change', (e) => { if (e.target.files[0]) importBoard(e.target.files[0]); e.target.value = ''; });
    if (importDropzoneEl && importInput) {
      const dropTargets = [importDropzoneEl];
      if (boardFileGroupEl) dropTargets.push(boardFileGroupEl);

      function hasFileDrag(e) {
        const types = e && e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
        return types.includes('Files');
      }

      function clearDropActiveState() {
        importDropzoneEl.classList.remove('import-dropzone--active');
        if (boardFileGroupEl) boardFileGroupEl.classList.remove('toolbar__group--drop-active');
      }

      function setDropActiveState() {
        importDropzoneEl.classList.add('import-dropzone--active');
        if (boardFileGroupEl) boardFileGroupEl.classList.add('toolbar__group--drop-active');
      }

      function processDroppedFiles(e) {
        const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
        if (!files.length) return;
        const file = files.find((f) => /\.(json|zip)$/i.test(f.name || '')) || files[0];
        if (!file || !/\.(json|zip)$/i.test(file.name || '')) {
          if (downloadStatus) {
            downloadStatus.textContent = t('status.invalidImportFile');
            setTimeout(function () {
              if (downloadStatus) downloadStatus.textContent = '';
            }, 2200);
          }
          return;
        }
        importBoard(file);
      }

      importDropzoneEl.addEventListener('click', function () {
        importInput.click();
      });
      importDropzoneEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          importInput.click();
        }
      });

      dropTargets.forEach((target) => {
        ['dragenter', 'dragover'].forEach((evtName) => {
          target.addEventListener(evtName, function (e) {
            if (!hasFileDrag(e)) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            setDropActiveState();
          });
        });
        ['dragleave', 'dragend'].forEach((evtName) => {
          target.addEventListener(evtName, function (e) {
            if (!hasFileDrag(e)) return;
            e.preventDefault();
            e.stopPropagation();
            clearDropActiveState();
          });
        });
        target.addEventListener('drop', function (e) {
          if (!hasFileDrag(e)) return;
          e.preventDefault();
          e.stopPropagation();
          clearDropActiveState();
          processDroppedFiles(e);
        });
      });

      document.addEventListener('dragover', function (e) {
        if (!hasFileDrag(e)) return;
        e.preventDefault();
      });
      document.addEventListener('drop', function (e) {
        if (!hasFileDrag(e)) return;
        if (!boardFileGroupEl || !boardFileGroupEl.contains(e.target)) {
          e.preventDefault();
          clearDropActiveState();
        }
      });
    }
    if (exportBtn) exportBtn.addEventListener('click', exportBoard);
    if (exportPortableBtn) exportPortableBtn.addEventListener('click', function () {
      exportPortableZip().catch(function (e) {
        alert('Portable export failed.');
        console.warn('portable export failed', e);
      });
    });
    if (portableCheckBtn) portableCheckBtn.addEventListener('click', function () {
      runPortableReadinessCheck().catch(function (e) {
        alert('Portable readiness check failed.');
        console.warn('portable check failed', e);
      });
    });
    if (clearDataBtn) clearDataBtn.addEventListener('click', clearAllDataAndReset);
    if (downloadBtn) downloadBtn.addEventListener('click', downloadAllMedia);
    if (fileModeAttachBtn) fileModeAttachBtn.addEventListener('click', function () {
      onAttachFileClick().catch((err) => console.warn('[soundboard] file-mode attach failed', err));
    });
    if (fileModeDetachBtn) fileModeDetachBtn.addEventListener('click', function () {
      onDetachFileClick().catch((err) => console.warn('[soundboard] file-mode detach failed', err));
    });
    if (webAddBtn) webAddBtn.addEventListener('click', addFromWebUrl);
    if (settingsBtn) settingsBtn.addEventListener('click', openSettingsScreen);
    if (reorderBtn) reorderBtn.addEventListener('click', () => setReorderMode(!reorderMode));
    if (hotkeyOnlyBtn) bindTapAndClick(hotkeyOnlyBtn, toggleHotkeyOnlyFilter);
    if (analyzeAllBtn) analyzeAllBtn.addEventListener('click', analyzeAllSounds);
    if (helpBtn) helpBtn.addEventListener('click', openHelpScreen);
    if (themeBtn) themeBtn.addEventListener('click', cycleThemePreference);
    if (favouritesReorderToggleEl) {
      bindTapAndClick(favouritesReorderToggleEl, function () {
        setFavouriteReorderMode(!favouriteReorderMode);
      });
    }
    if (favouritesRowsSelectEl) {
      favouritesRowsSelectEl.value = String(clampFavouriteRows(favouriteStripRows));
      favouritesRowsSelectEl.addEventListener('change', function () {
        setFavouriteStripRows(favouritesRowsSelectEl.value);
      });
    }
    if (recentsRowsSelectEl) {
      recentsRowsSelectEl.value = String(clampFavouriteRows(recentStripRows));
      recentsRowsSelectEl.addEventListener('change', function () {
        setRecentStripRows(recentsRowsSelectEl.value);
      });
    }
    if (recentsCollapseToggleEl) {
      bindTapAndClick(recentsCollapseToggleEl, function () {
        toggleQuickAccessSectionCollapse('recents');
      });
    }
    if (favouritesCollapseToggleEl) {
      bindTapAndClick(favouritesCollapseToggleEl, function () {
        toggleQuickAccessSectionCollapse('favourites');
      });
    }
    if (globalVolumeEl && Audio) {
      globalVolumeEl.addEventListener('input', function () {
        const pct = parseInt(globalVolumeEl.value, 10);
        if (Audio.setMasterVolume) Audio.setMasterVolume(pct / 100);
        if (globalVolumeLabel) globalVolumeLabel.textContent = t('label.volume', { pct: isNaN(pct) ? 100 : pct });
      });
      if (globalVolumeLabel) globalVolumeLabel.textContent = t('label.volume', {
        pct: Audio.getMasterVolume ? Math.round(Audio.getMasterVolume() * 100) : 100
      });
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
      if (initial) runAutoAnalyzeOnLoad();
      autoLevelToggleEl.addEventListener('change', function () {
        const enabled = !!autoLevelToggleEl.checked;
        try { localStorage.setItem(AUTO_LEVEL_KEY, String(enabled)); } catch (_) {}
        if (Audio && Audio.setAutoLevelEnabled) Audio.setAutoLevelEnabled(enabled);
        if (enabled) runAutoAnalyzeOnLoad();
      });
    }

    if (quickBarEl) {
      const quickAdd = quickBarEl.querySelector('[data-action="quick-add"]');
      const quickWeb = quickBarEl.querySelector('[data-action="quick-web"]');
      const quickSearch = quickBarEl.querySelector('[data-action="quick-search"]');
      const quickHotkeyOnly = quickBarEl.querySelector('[data-action="quick-hotkey-only"]');
      const quickTheme = quickBarEl.querySelector('[data-action="quick-theme"]');
      const quickSettings = quickBarEl.querySelector('[data-action="quick-settings"]');
      const quickHelp = quickBarEl.querySelector('[data-action="quick-help"]');
      const quickReorder = quickBarEl.querySelector('[data-action="quick-reorder"]');
      const quickAnalyze = quickBarEl.querySelector('[data-action="quick-analyze"]');

      if (quickAdd) quickAdd.addEventListener('click', addSound);
      if (quickWeb) quickWeb.addEventListener('click', addFromWebUrl);
      if (quickSearch) {
        quickSearch.addEventListener('click', function () {
          if (searchInputEl) {
            searchInputEl.focus();
            searchInputEl.select();
          }
        });
      }
      if (quickHotkeyOnly) bindTapAndClick(quickHotkeyOnly, toggleHotkeyOnlyFilter);
      if (quickTheme) quickTheme.addEventListener('click', cycleThemePreference);
      if (quickReorder) {
        quickReorder.addEventListener('click', function () {
          setReorderMode(!reorderMode);
        });
      }
      if (quickSettings) quickSettings.addEventListener('click', openSettingsScreen);
      if (quickHelp) quickHelp.addEventListener('click', openHelpScreen);
      if (quickAnalyze) quickAnalyze.addEventListener('click', analyzeAllSounds);
    }

    if (settingsScreenEl) {
      const saveBtn = settingsScreenEl.querySelector('[data-action="settings-save"]');
      const cancelBtn = settingsScreenEl.querySelector('[data-action="settings-cancel"]');
      if (saveBtn) saveBtn.addEventListener('click', saveAllSettingsChanges);
      if (cancelBtn) cancelBtn.addEventListener('click', () => closeSettingsScreen());
      if (settingsSearchEl) {
        settingsSearchEl.addEventListener('input', function () {
          filterSettingsRows(settingsSearchEl.value || '');
        });
      }
      if (settingsClearSearchBtn) {
        settingsClearSearchBtn.addEventListener('click', function () {
          if (settingsSearchEl) settingsSearchEl.value = '';
          filterSettingsRows('');
          focusWithoutScroll(settingsSearchEl);
        });
      }
      if (settingsLoadMoreBtn) {
        settingsLoadMoreBtn.addEventListener('click', function () {
          appendSettingsRows(SETTINGS_BATCH_SIZE);
          filterSettingsRows(settingsSearchEl ? settingsSearchEl.value : '');
        });
      }
      settingsScreenEl.addEventListener('input', function (e) {
        const t = e.target;
        if (t && t.matches && t.matches('[data-field]')) setSettingsDirty(true);
      });
      settingsScreenEl.addEventListener('change', function (e) {
        const t = e.target;
        if (t && t.matches && t.matches('[data-field]')) setSettingsDirty(true);
        if (t && t.matches && t.matches('[data-field="hotkey"]')) {
          const normalized = normalizeHotkeyInput(t.value);
          t.value = normalized;
        }
      });
      settingsScreenEl.addEventListener('keydown', function (e) {
        trapFocusInSettingsScreen(e);
        const t = e.target;
        if (t && t.matches && t.matches('[data-field="hotkey"]')) {
          captureHotkeyFromInputKeydown(e, function () {
            saveAllSettingsChanges({ closeAfterSave: false });
          });
          if (e.defaultPrevented) return;
        }
        if (e.key === 'Enter') {
          if (t && (t.tagName || '').toLowerCase() === 'textarea') return;
          const type = (t && t.type ? String(t.type) : '').toLowerCase();
          if (type === 'button' || type === 'checkbox' || type === 'search') return;
          e.preventDefault();
          saveAllSettingsChanges({ closeAfterSave: false });
        }
      });
      settingsScreenEl.addEventListener('click', function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('settings-screen__backdrop')) {
          closeSettingsScreen();
        }
      });
    }

    if (helpScreenEl) {
      const closeBtn = helpScreenEl.querySelector('[data-action="help-close"]');
      if (closeBtn) closeBtn.addEventListener('click', closeHelpScreen);
      helpScreenEl.addEventListener('click', function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('help-screen__backdrop')) {
          closeHelpScreen();
        }
      });
    }
  }

  function analyzeAllSounds(options = {}) {
    const onlyMissing = options.onlyMissing === true;
    const silent = options.silent === true;
    if (analyzeInProgress) return;
    if (!currentBoard || !currentBoard.sounds || currentBoard.sounds.length === 0) {
      if (!silent && downloadStatus) downloadStatus.textContent = t('status.noSoundsToAnalyze');
      return;
    }
    if (!Audio || !Audio.analyzeFileUrl) {
      if (!silent && downloadStatus) downloadStatus.textContent = t('status.analysisUnavailable');
      return;
    }
    const sounds = currentBoard.sounds.slice().filter((s) => (onlyMissing ? shouldAnalyzeSound(s) : true));
    if (sounds.length === 0) return;
    analyzeInProgress = true;
    let i = 0;
    let updated = 0;
    const total = sounds.length;
    if (!silent && downloadStatus) downloadStatus.textContent = t('status.analyzingProgress', { current: 0, total });

    function step() {
      if (i >= total) {
        if (updated > 0) saveToStorage();
        analyzeInProgress = false;
        if (!silent && downloadStatus) {
          downloadStatus.textContent = t('status.analyzeComplete');
          setTimeout(function () { if (downloadStatus) downloadStatus.textContent = ''; }, 2500);
        }
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
        if (!silent && downloadStatus) downloadStatus.textContent = t('status.analyzingProgress', { current: i, total });
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
    const hotkeyInput = modalForm.querySelector('[name="hotkey"]');
    modalForm.addEventListener('submit', function (e) {
      e.preventDefault();
      saveSoundFromModal();
    });
    if (saveBtn) saveBtn.addEventListener('click', function (e) {
      e.preventDefault();
      saveSoundFromModal();
    });
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
    if (hotkeyInput) {
      hotkeyInput.addEventListener('keydown', function (e) {
        captureHotkeyFromInputKeydown(e, saveSoundFromModal);
      });
      hotkeyInput.addEventListener('change', function () {
        const normalized = normalizeHotkeyInput(hotkeyInput.value);
        hotkeyInput.value = normalized;
      });
    }
    const uploadInput = document.getElementById('upload-audio-input');
    if (uploadInput) uploadInput.addEventListener('change', function () { handleUploadAudio(uploadInput); });
    initTrimBarDrag();
    modalEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal__backdrop') || !e.target.closest('.modal__panel')) closeModal();
    });
  }

  function initKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (settingsScreenEl && !settingsScreenEl.hidden && e.key === 'Escape') {
        e.preventDefault();
        closeSettingsScreen();
        return;
      }
      if (helpScreenEl && !helpScreenEl.hidden && e.key === 'Escape') {
        e.preventDefault();
        closeHelpScreen();
        return;
      }
      const isTypingTarget = !!(e.target && (
        e.target.closest('input')
        || e.target.closest('textarea')
        || e.target.closest('[contenteditable="true"]')
      ));
      const key = (e.key || '').toUpperCase();
      if (!isTypingTarget && !e.metaKey && !e.ctrlKey && !e.altKey && e.shiftKey && key === 'H' && !hotkeyMap.has('Shift+H')) {
        e.preventDefault();
        if (!(modalEl && !modalEl.hidden) && !(settingsScreenEl && !settingsScreenEl.hidden)) {
          toggleHotkeyOnlyFilter();
        }
        return;
      }
      if (modalEl && !modalEl.hidden) return;
      if (settingsScreenEl && !settingsScreenEl.hidden) return;
      if (e.repeat) return;
      if (isTypingTarget) return;
      const signature = getHotkeySignatureFromKeyboardEvent(e);
      const sound = signature ? hotkeyMap.get(signature) : null;
      if (sound) {
        e.preventDefault();
        if (sound.momentary) {
          if (activeMomentaryKeys.has(signature)) return;
          activeMomentaryKeys.add(signature);
          onPlay(sound, 'momentary-start');
          return;
        }
        onPlay(sound);
      }
    });
    document.addEventListener('keyup', (e) => {
      const signature = getHotkeySignatureFromKeyboardEvent(e);
      if (!activeMomentaryKeys.has(signature)) return;
      activeMomentaryKeys.delete(signature);
      const sound = signature ? hotkeyMap.get(signature) : null;
      if (sound && sound.momentary) onPlay(sound, 'momentary-stop');
    });
    window.addEventListener('blur', () => {
      if (activeMomentaryKeys.size === 0) return;
      activeMomentaryKeys.clear();
      if (Audio && Audio.stopSound) Audio.stopSound();
      if (playingId != null) {
        playingId = null;
        render();
      }
    });
  }

  function init() {
    initI18n();
    initHeaderMenu();
    applyThemePreference(loadThemePreference());
    favouriteStripRows = loadFavouriteRows();
    recentStripRows = loadRecentRows();
    initToolbar();
    initModal();
    initKeyboard();
    if (portableReportCloseBtn) portableReportCloseBtn.addEventListener('click', closePortableReport);
    if (portableReportCopyBtn) portableReportCopyBtn.addEventListener('click', function () { copyPortableReportToClipboard(); });
    if (portableReportEl) {
      portableReportEl.addEventListener('click', function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('portable-report__backdrop')) {
          closePortableReport();
        }
      });
    }
    loadInitialBoard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
