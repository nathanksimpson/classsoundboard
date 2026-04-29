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
  const globalVolumeEl = document.getElementById('global-volume');
  const globalVolumeLabel = document.getElementById('global-volume-label');
  const durationHint = document.getElementById('duration-hint');
  const searchInputEl = document.getElementById('search-input');
  const searchClearEl = document.getElementById('search-clear');
  const searchCountEl = document.getElementById('search-count');
  const autoLevelToggleEl = document.getElementById('auto-level-toggle');
  const quickBarEl = document.getElementById('quick-bar');
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

  function getBoardJsonPath() {
    const base = window.location.pathname.replace(/\/[^/]*$/, '') || '/';
    return base + (base.endsWith('/') ? '' : '/') + 'boards/sample-board.json';
  }

  const CATEGORY_UI_KEY_PREFIX = 'soundboard-category-state:';
  const CATEGORY_ORDER_KEY_PREFIX = 'soundboard-category-order:';
  const AUTO_LEVEL_KEY = 'soundboard-auto-level';
  const LANGUAGE_KEY = 'soundboard-language';
  const SETTINGS_BATCH_SIZE = 80;
  const I18N = {
    en: {
      'header.hint': 'Tip: click the board name to rename it.',
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
      'toolbar.import': 'Import Board',
      'toolbar.export': 'Export Board',
      'toolbar.importDropzone': 'Drop .json board file here (or click)',
      'toolbar.importDropzoneTitle': 'Drop a .json board file here, or click to choose one',
      'toolbar.group.audio': 'Audio Tools',
      'toolbar.downloadAll': 'Download all sounds',
      'toolbar.downloadAllTitle': 'Download each sound, save to a folder (or into the app), then update the board to use local copies',
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
      'status.invalidImportFile': 'Please drop a valid .json board file.',
      'board.defaultName': 'Soundboard',
      'board.renameTitle': 'Click to change board name',
      'ui.dragToReorderPrefix': 'Drag to reorder',
      'ui.playPrefix': 'Play',
      'ui.noSounds': 'No sounds. Add a sound or import a board.',
      'ui.noSearchMatches': 'No sounds match your search.'
    },
    ko: {
      'header.hint': '팁: 보드 이름을 클릭하면 이름을 변경할 수 있습니다.',
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
      'toolbar.import': '보드 가져오기',
      'toolbar.export': '보드 내보내기',
      'toolbar.importDropzone': '.json 보드 파일을 여기에 드롭하세요 (또는 클릭)',
      'toolbar.importDropzoneTitle': '.json 보드 파일을 여기에 드롭하거나 클릭해 선택하세요',
      'toolbar.group.audio': '오디오 도구',
      'toolbar.downloadAll': '모든 사운드 다운로드',
      'toolbar.downloadAllTitle': '각 사운드를 다운로드하여 폴더(또는 앱)로 저장 후 로컬 파일로 업데이트',
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
      'status.invalidImportFile': '올바른 .json 보드 파일을 드롭해 주세요.',
      'board.defaultName': '사운드보드',
      'board.renameTitle': '클릭하여 보드 이름 변경',
      'ui.dragToReorderPrefix': '드래그하여 순서 변경',
      'ui.playPrefix': '재생',
      'ui.noSounds': '사운드가 없습니다. 사운드를 추가하거나 보드를 가져오세요.',
      'ui.noSearchMatches': '검색 결과가 없습니다.'
    }
  };
  let currentLanguage = 'en';
  let searchQuery = '';
  let showHotkeyOnly = false;
  let categoryUiState = {};
  let categoryOrder = [];
  let settingsDirty = false;
  let settingsRenderIndex = 0;
  let settingsPreviouslyFocused = null;
  let analyzeInProgress = false;

  function t(key, vars = {}) {
    const dict = I18N[currentLanguage] || I18N.en;
    const template = dict[key] || I18N.en[key] || key;
    return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : '';
    });
  }

  function applyTranslations() {
    const textEls = Array.from(document.querySelectorAll('[data-i18n]'));
    textEls.forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      el.textContent = t(key);
    });
    const titleEls = Array.from(document.querySelectorAll('[data-i18n-title]'));
    titleEls.forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (!key) return;
      el.title = t(key);
    });
    const placeholderEls = Array.from(document.querySelectorAll('[data-i18n-placeholder]'));
    placeholderEls.forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (!key) return;
      el.setAttribute('placeholder', t(key));
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
      const canonicalNames = new Set([
        'ENTER', 'TAB', 'ESCAPE', 'BACKSPACE', 'DELETE', 'INSERT', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN',
        'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT'
      ]);
      if (canonicalNames.has(upper)) {
        const lower = upper.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }
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

    let key = e.key || '';
    if (!key) return '';
    if (keyAlias[key]) key = keyAlias[key];
    if (key.length === 1) {
      if (e.shiftKey && shiftedCharToBase[key]) key = shiftedCharToBase[key];
      if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
    }

    const signature = normalizeHotkeyInput(
      (e.ctrlKey ? 'Ctrl+' : '')
      + (e.altKey ? 'Alt+' : '')
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
    row.innerHTML = ''
      + '<div class="settings-row__top">'
      + '  <div class="settings-row__name">' + escapeAttr((idx + 1) + '. ' + (sound.title || 'Untitled')) + '</div>'
      + '  <label class="settings-row__delete"><input type="checkbox" data-field="delete"> Delete</label>'
      + '</div>'
      + '<div class="settings-row__grid">'
      + '  <label><span class="field__label">Title</span><input class="field__input" data-field="title" type="text" value="' + escapeAttr(sound.title || '') + '"></label>'
      + '  <label><span class="field__label">Audio URL</span><input class="field__input" data-field="fileUrl" type="text" value="' + escapeAttr(sound.fileUrl || '') + '"></label>'
      + '  <label><span class="field__label">Image URL</span><input class="field__input" data-field="imageUrl" type="text" value="' + escapeAttr(sound.imageUrl || '') + '"></label>'
      + '  <label><span class="field__label">Category</span><input class="field__input" data-field="category" type="text" list="category-options" value="' + escapeAttr(sound.category || '') + '"></label>'
      + '  <label><span class="field__label">Hotkey (press combo, e.g. Q, Shift+., Ctrl+Alt+P)</span><input class="field__input" data-field="hotkey" type="text" value="' + escapeAttr(normalizeHotkeyInput(sound.hotkey || '')) + '"></label>'
      + '  <label><span class="field__label">Volume %</span><input class="field__input" data-field="volume" type="number" min="0" max="100" step="1" value="' + escapeAttr(Math.round((sound.volume != null ? sound.volume : 1) * 100)) + '"></label>'
      + '  <label><span class="field__label">Speed</span><input class="field__input" data-field="playbackRate" type="number" min="0.5" max="2" step="0.1" value="' + escapeAttr(sound.playbackRate != null ? sound.playbackRate : 1) + '"></label>'
      + '  <label><span class="field__label">Start sec</span><input class="field__input" data-field="startSec" type="number" min="0" step="0.01" value="' + escapeAttr(sound.startMs != null ? (sound.startMs / 1000) : '') + '"></label>'
      + '  <label><span class="field__label">End sec</span><input class="field__input" data-field="endSec" type="number" min="0" step="0.01" value="' + escapeAttr(sound.endMs != null ? (sound.endMs / 1000) : '') + '"></label>'
      + '  <label class="field--checkbox"><input data-field="loop" type="checkbox"' + (sound.loop ? ' checked' : '') + '><span class="field__label">Loop</span></label>'
      + '  <label class="field--checkbox"><input data-field="momentary" type="checkbox"' + (sound.momentary ? ' checked' : '') + '><span class="field__label">Momentary</span></label>'
      + '</div>'
      + '<p class="settings-row__error" aria-live="polite"></p>';
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
      boardNameEl.textContent = board.name || t('board.defaultName');
      boardNameEl.title = t('board.renameTitle');
    }
    categoryUiState = loadCategoryUiState();
    categoryOrder = loadCategoryOrder();
    buildHotkeyMap();
    refreshCategorySuggestions();
    render();
    initBoardTitle();
    if (Audio && board.sounds && board.sounds.length) {
      Audio.preloadSounds(board.sounds);
    }
    runAutoAnalyzeOnLoad();
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
    updateSearchCount(filtered.length, Array.isArray(allSounds) ? allSounds.length : 0);

    if (!Array.isArray(allSounds) || allSounds.length === 0) {
      UI.renderGrid(gridEl, [], playingId, errorIds, onPlay, onEditSound, reorderMode, reorderSounds, { hotkeyCounts });
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
        { hotkeyCounts },
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
      UI.renderGrid(gridEl, filtered, playingId, errorIds, onPlay, onEditSound, reorderMode, reorderSounds, { hotkeyCounts });
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
    if (squelch) {
      if (Audio.stopSound) Audio.stopSound();
      playingId = null;
      render();
    }
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

  function saveToStorage() {
    if (currentBoard && Storage) {
      currentBoard.updatedAt = new Date().toISOString();
      Storage.saveBoard(currentBoard);
    }
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
    saveToStorage();
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
    if (uploadedHint) uploadedHint.textContent = '';
    if (modalForm) {
      const isLocal = sound && sound.fileUrl && String(sound.fileUrl).startsWith('local:');
      modalForm.querySelector('[name="title"]').value = sound ? sound.title : '';
      modalForm.querySelector('[name="fileUrl"]').value = isLocal ? '' : (sound ? sound.fileUrl : '');
      if (isLocal && uploadedHint) uploadedHint.textContent = 'Audio: your uploaded file (saved)';
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
      for (const target of fetchTargets) {
        try {
          const res = await fetch(target);
          if (!res.ok) continue;
          const text = await res.text();
          const titleMatch = text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
          if (titleMatch && titleMatch[1]) title = titleMatch[1];
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
          category: 'Blerp',
          extra: { source: 'blerp', blerpUrl: normalized, blerpId: soundId }
        });
        alert('Could not auto-extract audio from Blerp. I opened the sound editor with details pre-filled so you can paste the final audio URL and save.');
        return;
      }
      createDraftWebSound({
        title,
        fileUrl,
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
    if (sound) {
      sound.title = title;
      sound.fileUrl = fileUrl;
      sound.imageUrl = (modalForm.querySelector('[name="imageUrl"]').value || '').trim();
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
        imageUrl: (modalForm.querySelector('[name="imageUrl"]').value || '').trim(),
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
    saveToStorage();
    buildHotkeyMap();
    refreshCategorySuggestions();
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
    const addBtn = toolbarEl.querySelector('[data-action="add"]');
    const importBtn = toolbarEl.querySelector('[data-action="import"]');
    const exportBtn = toolbarEl.querySelector('[data-action="export"]');
    const downloadBtn = toolbarEl.querySelector('[data-action="download-sounds"]');
    const webAddBtn = toolbarEl.querySelector('[data-action="web-add"]');
    const settingsBtn = toolbarEl.querySelector('[data-action="settings-open"]');
    const reorderBtn = toolbarEl.querySelector('[data-action="reorder-toggle"]');
    const hotkeyOnlyBtn = toolbarEl.querySelector('[data-action="hotkey-only-toggle"]');
    const analyzeAllBtn = toolbarEl.querySelector('[data-action="analyze-all"]');
    const helpBtn = toolbarEl.querySelector('[data-action="help-open"]');
    if (addBtn) addBtn.addEventListener('click', addSound);
    if (importBtn && importInput) importBtn.addEventListener('click', () => importInput.click());
    if (importInput) importInput.addEventListener('change', (e) => { if (e.target.files[0]) importBoard(e.target.files[0]); e.target.value = ''; });
    if (importDropzoneEl && importInput) {
      importDropzoneEl.addEventListener('click', function () {
        importInput.click();
      });
      importDropzoneEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          importInput.click();
        }
      });
      ['dragenter', 'dragover'].forEach((evtName) => {
        importDropzoneEl.addEventListener(evtName, function (e) {
          e.preventDefault();
          e.stopPropagation();
          importDropzoneEl.classList.add('import-dropzone--active');
        });
      });
      ['dragleave', 'dragend', 'drop'].forEach((evtName) => {
        importDropzoneEl.addEventListener(evtName, function (e) {
          e.preventDefault();
          e.stopPropagation();
          importDropzoneEl.classList.remove('import-dropzone--active');
        });
      });
      importDropzoneEl.addEventListener('drop', function (e) {
        const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
        const file = files.find((f) => /\.json$/i.test(f.name || '')) || files[0];
        if (!file || !/\.json$/i.test(file.name || '')) {
          if (downloadStatus) {
            downloadStatus.textContent = t('status.invalidImportFile');
            setTimeout(function () {
              if (downloadStatus) downloadStatus.textContent = '';
            }, 2200);
          }
          return;
        }
        importBoard(file);
      });
    }
    if (exportBtn) exportBtn.addEventListener('click', exportBoard);
    if (downloadBtn) downloadBtn.addEventListener('click', downloadAllSounds);
    if (webAddBtn) webAddBtn.addEventListener('click', addFromWebUrl);
    if (settingsBtn) settingsBtn.addEventListener('click', openSettingsScreen);
    if (reorderBtn) reorderBtn.addEventListener('click', () => setReorderMode(!reorderMode));
    if (hotkeyOnlyBtn) bindTapAndClick(hotkeyOnlyBtn, toggleHotkeyOnlyFilter);
    if (analyzeAllBtn) analyzeAllBtn.addEventListener('click', analyzeAllSounds);
    if (helpBtn) helpBtn.addEventListener('click', openHelpScreen);
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
      const isTypingTarget = !!(e.target && (e.target.closest('input') || e.target.closest('textarea')));
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
