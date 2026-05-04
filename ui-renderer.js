/**
 * ui-renderer.js — Render sound grid, tile states (idle/hover/playing/error), bind events.
 * Uses textContent only (no innerHTML) for XSS safety.
 */

function escapeText(str) {
  if (str == null) return '';
  return String(str);
}

function t(key, fallback) {
  const i18n = window.SoundboardI18n;
  if (i18n && typeof i18n.t === 'function') {
    return i18n.t(key);
  }
  return fallback;
}

function renderTile(sound, state, index, reorderMode, renderOptions = {}) {
  const stateClass = state === 'playing' ? 'tile--playing' : state === 'error' ? 'tile--error' : 'tile--idle';
  const reorderClass = reorderMode ? ' tile--reorder' : '';
  const title = escapeText(sound.title);
  const color = sound.color || '#4a9eff';
  const hasImage = sound.imageUrl && sound.imageUrl.trim();
  const bgStyle = hasImage
    ? `background-image:url(${escapeText(sound.imageUrl)}); background-size:cover; background-color:${escapeText(color)};`
    : `background-color:${escapeText(color)};`;

  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'tile ' + stateClass + reorderClass;
  el.dataset.soundId = sound.id;
  el.dataset.index = String(index);
  el.style.cssText = bgStyle;
  const hotkeyText = sound && sound.hotkey ? (' hotkey ' + String(sound.hotkey)) : '';
  const momentaryText = sound && sound.momentary ? ' momentary hold mode' : '';
  el.setAttribute('aria-label', reorderMode
    ? (t('ui.dragToReorderPrefix', 'Drag to reorder') + ': ' + title)
    : (t('ui.playPrefix', 'Play') + ' ' + title + hotkeyText + momentaryText));
  if (reorderMode) el.setAttribute('draggable', 'true');

  if (reorderMode) {
    const grip = document.createElement('span');
    grip.className = 'tile__grip';
    grip.setAttribute('aria-hidden', 'true');
    grip.textContent = '\u22EE';
    el.appendChild(grip);
  }

  const label = document.createElement('span');
  label.className = 'tile__label';
  label.textContent = title;
  el.appendChild(label);

  const normalizedHotkey = String(sound && sound.hotkey ? sound.hotkey : '').trim();
  const hotkeyCounts = renderOptions.hotkeyCounts instanceof Map ? renderOptions.hotkeyCounts : new Map();
  const isHotkeyConflict = normalizedHotkey && (hotkeyCounts.get(normalizedHotkey) || 0) > 1;
  const isFavorite = typeof renderOptions.isFavorite === 'function' ? !!renderOptions.isFavorite(sound) : false;
  const showFavoriteToggle = !reorderMode && typeof renderOptions.onToggleFavorite === 'function';
  if (!reorderMode && (normalizedHotkey || sound.momentary)) {
    const meta = document.createElement('div');
    meta.className = 'tile__meta';
    if (normalizedHotkey) {
      const keyBadge = document.createElement('span');
      keyBadge.className = 'tile__badge';
      keyBadge.textContent = isHotkeyConflict ? ('!' + normalizedHotkey) : normalizedHotkey;
      keyBadge.title = isHotkeyConflict
        ? 'Hotkey conflict: this key is assigned multiple times'
        : ('Hotkey: ' + normalizedHotkey);
      meta.appendChild(keyBadge);
    }
    if (sound.momentary) {
      const momentaryBadge = document.createElement('span');
      momentaryBadge.className = 'tile__badge';
      momentaryBadge.textContent = 'HOLD';
      momentaryBadge.title = 'Momentary mode: play while holding';
      meta.appendChild(momentaryBadge);
    }
    el.appendChild(meta);
  }

  if (!reorderMode) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'tile__edit';
    editBtn.setAttribute('aria-label', 'Edit ' + title);
    editBtn.title = 'Edit';
    editBtn.textContent = '\u270E';
    el.appendChild(editBtn);
  }

  if (showFavoriteToggle) {
    const favBtn = document.createElement('button');
    favBtn.type = 'button';
    favBtn.className = 'tile__favorite';
    favBtn.setAttribute('aria-label', (isFavorite ? 'Remove from favourites: ' : 'Add to favourites: ') + title);
    favBtn.setAttribute('aria-pressed', isFavorite ? 'true' : 'false');
    favBtn.title = isFavorite ? 'Remove from favourites' : 'Add to favourites';
    favBtn.textContent = '\u2605';
    el.appendChild(favBtn);
  }

  if (state === 'playing') {
    const icon = document.createElement('span');
    icon.className = 'tile__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\u25B6';
    el.appendChild(icon);
  }
  if (state === 'error') {
    const err = document.createElement('span');
    err.className = 'tile__error';
    err.textContent = '!';
    el.appendChild(err);
  }

  return el;
}

function renderGrid(container, sounds, playState, errorIds, onPlay, onEdit, reorderMode, onReorder, renderOptions = {}) {
  if (!container) return;
  container.classList.remove('grid-groups');
  container.classList.add('grid');
  container.textContent = '';
  if (!Array.isArray(sounds) || sounds.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = t('ui.noSounds', 'No sounds. Add a sound or import a board.');
    container.appendChild(empty);
    return;
  }

  const reorder = !!reorderMode && typeof onReorder === 'function';
  const onToggleFavorite = typeof renderOptions.onToggleFavorite === 'function' ? renderOptions.onToggleFavorite : null;

  sounds.forEach((s, i) => {
    const state = playState === s.id ? 'playing' : (errorIds && errorIds.has(s.id)) ? 'error' : 'idle';
    const tile = renderTile(s, state, i, reorder, renderOptions);
    const isMomentary = !!(s && s.momentary);

    tile.addEventListener('click', (e) => {
      e.preventDefault();
      if (reorder) return;
      if (isMomentary) return;
      if (onPlay) onPlay(s);
    });

    if (!reorder && isMomentary && onPlay) {
      tile.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('.tile__edit, .tile__favorite')) return;
        e.preventDefault();
        onPlay(s, 'momentary-start');
      });
      const stopMomentary = (e) => {
        if (e && e.target && e.target.closest && e.target.closest('.tile__edit, .tile__favorite')) return;
        onPlay(s, 'momentary-stop');
      };
      tile.addEventListener('pointerup', stopMomentary);
      tile.addEventListener('pointercancel', stopMomentary);
      tile.addEventListener('lostpointercapture', stopMomentary);
      tile.addEventListener('pointerleave', (e) => {
        if (e.buttons === 0) return;
        stopMomentary(e);
      });
    }

    if (onEdit) {
      const editBtn = tile.querySelector('.tile__edit');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onEdit(s);
        });
      }
      tile.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        onEdit(s);
      });
    }
    if (onToggleFavorite) {
      const favBtn = tile.querySelector('.tile__favorite');
      if (favBtn) {
        favBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite(s);
        });
      }
    }
    if (reorder) {
      tile.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', s.id);
        e.dataTransfer.effectAllowed = 'move';
        tile.classList.add('tile--dragging');
      });
      tile.addEventListener('dragend', () => {
        tile.classList.remove('tile--dragging');
        container.querySelectorAll('.tile--drag-over').forEach((t) => t.classList.remove('tile--drag-over'));
      });
      tile.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tile.classList.add('tile--drag-over');
      });
      tile.addEventListener('dragleave', () => {
        tile.classList.remove('tile--drag-over');
      });
      tile.addEventListener('drop', (e) => {
        e.preventDefault();
        tile.classList.remove('tile--drag-over');
        const soundId = e.dataTransfer.getData('text/plain');
        if (!soundId) return;
        const fromIndex = sounds.findIndex((x) => x.id === soundId);
        const toIndex = parseInt(tile.dataset.index, 10);
        if (fromIndex === -1 || toIndex < 0 || fromIndex === toIndex) return;
        onReorder(fromIndex, toIndex);
      });
    }
    container.appendChild(tile);
  });
}

function renderHorizontalStrip(container, sounds, playState, errorIds, onPlay, onEdit, renderOptions = {}) {
  if (!container) return;
  container.classList.add('sound-strip');
  container.textContent = '';
  const list = Array.isArray(sounds) ? sounds : [];
  if (list.length === 0) return;

  const onToggleFavorite = typeof renderOptions.onToggleFavorite === 'function' ? renderOptions.onToggleFavorite : null;
  list.forEach((s, i) => {
    const state = playState === s.id ? 'playing' : (errorIds && errorIds.has(s.id)) ? 'error' : 'idle';
    const tile = renderTile(s, state, i, false, renderOptions);
    const isMomentary = !!(s && s.momentary);

    tile.addEventListener('click', (e) => {
      e.preventDefault();
      if (isMomentary) return;
      if (onPlay) onPlay(s);
    });

    if (isMomentary && onPlay) {
      tile.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('.tile__edit, .tile__favorite')) return;
        e.preventDefault();
        onPlay(s, 'momentary-start');
      });
      const stopMomentary = (e) => {
        if (e && e.target && e.target.closest && e.target.closest('.tile__edit, .tile__favorite')) return;
        onPlay(s, 'momentary-stop');
      };
      tile.addEventListener('pointerup', stopMomentary);
      tile.addEventListener('pointercancel', stopMomentary);
      tile.addEventListener('lostpointercapture', stopMomentary);
      tile.addEventListener('pointerleave', (e) => {
        if (e.buttons === 0) return;
        stopMomentary(e);
      });
    }

    if (onEdit) {
      const editBtn = tile.querySelector('.tile__edit');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onEdit(s);
        });
      }
    }

    if (onToggleFavorite) {
      const favBtn = tile.querySelector('.tile__favorite');
      if (favBtn) {
        favBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleFavorite(s);
        });
      }
    }

    container.appendChild(tile);
  });
}

function updateTileState(container, soundId, state) {
  const tile = container && container.querySelector('[data-sound-id="' + escapeText(soundId) + '"]');
  if (!tile) return;
  tile.classList.remove('tile--idle', 'tile--playing', 'tile--error');
  tile.classList.add(state === 'playing' ? 'tile--playing' : state === 'error' ? 'tile--error' : 'tile--idle');
  const icon = tile.querySelector('.tile__icon');
  const err = tile.querySelector('.tile__error');
  if (state === 'playing' && !icon) {
    const i = document.createElement('span');
    i.className = 'tile__icon';
    i.setAttribute('aria-hidden', 'true');
    i.textContent = '\u25B6';
    tile.appendChild(i);
  }
  if (state !== 'playing' && icon) icon.remove();
  if (state === 'error' && !err) {
    const e = document.createElement('span');
    e.className = 'tile__error';
    e.textContent = '!';
    tile.appendChild(e);
  }
  if (state !== 'error' && err) err.remove();
}

function renderGroupedGrid(container, groups, playState, errorIds, onPlay, onEdit, reorderMode, onReorder, renderOptions = {}, options = {}) {
  if (!container) return;
  container.classList.remove('grid');
  container.classList.add('grid-groups');
  container.textContent = '';

  const list = Array.isArray(groups) ? groups : [];
  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = t('ui.noSearchMatches', 'No sounds match your search.');
    container.appendChild(empty);
    return;
  }

  const isCollapsed = typeof options.isCollapsed === 'function' ? options.isCollapsed : (() => false);
  const onToggleCategory = typeof options.onToggleCategory === 'function' ? options.onToggleCategory : null;
  const onReorderCategory = typeof options.onReorderCategory === 'function' ? options.onReorderCategory : null;
  const onReorderSound = typeof options.onReorderSound === 'function' ? options.onReorderSound : null;
  const useTwoColumns = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && !window.matchMedia('(max-width: 700px)').matches;
  let columnEls = null;

  if (useTwoColumns) {
    const colA = document.createElement('div');
    const colB = document.createElement('div');
    colA.className = 'grid-groups__column';
    colB.className = 'grid-groups__column';
    container.appendChild(colA);
    container.appendChild(colB);
    columnEls = [colA, colB];
  }

  let visibleCategoryIndex = 0;

  list.forEach((g) => {
    const key = escapeText(g && g.key != null ? g.key : '');
    const label = escapeText(g && g.label != null ? g.label : key);
    const sounds = Array.isArray(g && g.sounds) ? g.sounds : [];
    if (sounds.length === 0) return;
    const safeId = 'category-body-' + String(key).toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 64);

    const section = document.createElement('section');
    section.className = 'category';
    section.dataset.category = key;
    const collapsed = !!isCollapsed(key);
    if (collapsed) section.classList.add('category--collapsed');

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'category__header';
    header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    header.setAttribute('aria-controls', safeId);

    const title = document.createElement('span');
    title.className = 'category__title';

    const caret = document.createElement('span');
    caret.className = 'category__caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = collapsed ? '\u25B6' : '\u25BC';
    title.appendChild(caret);

    const name = document.createElement('span');
    name.textContent = label;
    title.appendChild(name);

    const count = document.createElement('span');
    count.className = 'category__count';
    count.textContent = sounds.length + ' sound' + (sounds.length === 1 ? '' : 's');

    header.appendChild(title);
    header.appendChild(count);

    if (onToggleCategory) {
      header.addEventListener('click', (e) => {
        e.preventDefault();
        onToggleCategory(key);
      });
    }

    if (onReorderCategory && !reorderMode) {
      header.setAttribute('draggable', 'true');
      header.classList.add('category__header--draggable');
      header.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', key);
        e.dataTransfer.effectAllowed = 'move';
        section.classList.add('category--dragging');
      });
      header.addEventListener('dragend', () => {
        section.classList.remove('category--dragging');
        container.querySelectorAll('.category--drag-over').forEach((n) => n.classList.remove('category--drag-over'));
      });
      section.addEventListener('dragover', (e) => {
        e.preventDefault();
        section.classList.add('category--drag-over');
      });
      section.addEventListener('dragleave', () => {
        section.classList.remove('category--drag-over');
      });
      section.addEventListener('drop', (e) => {
        e.preventDefault();
        section.classList.remove('category--drag-over');
        const fromKey = e.dataTransfer.getData('text/plain');
        if (!fromKey || fromKey === key) return;
        onReorderCategory(fromKey, key);
      });
    }

    const body = document.createElement('div');
    body.className = 'category__body';
    body.id = safeId;

    const grid = document.createElement('div');
    grid.className = 'grid';
    body.appendChild(grid);

    if (reorderMode && onReorderSound) {
      renderGrid(
        grid,
        sounds,
        playState,
        errorIds,
        onPlay,
        onEdit,
        true,
        (fromIndex, toIndex) => {
          const moving = sounds[fromIndex];
          const target = sounds[toIndex];
          if (!moving || !target) return;
          const place = fromIndex < toIndex ? 'after' : 'before';
          onReorderSound(moving.id, key, target.id, place);
        },
        renderOptions
      );
      body.addEventListener('dragover', (e) => {
        e.preventDefault();
      });
      body.addEventListener('drop', (e) => {
        e.preventDefault();
        const movingId = e.dataTransfer.getData('text/plain');
        if (!movingId) return;
        const last = sounds.length > 0 ? sounds[sounds.length - 1] : null;
        onReorderSound(movingId, key, last ? last.id : null, 'after');
      });
    } else {
      renderGrid(grid, sounds, playState, errorIds, onPlay, onEdit, false, null, renderOptions);
    }

    section.appendChild(header);
    section.appendChild(body);
    if (columnEls) {
      const targetColumn = columnEls[visibleCategoryIndex % columnEls.length];
      targetColumn.appendChild(section);
    } else {
      container.appendChild(section);
    }
    visibleCategoryIndex += 1;
  });
}

window.SoundboardUIRenderer = {
  renderGrid,
  renderGroupedGrid,
  renderHorizontalStrip,
  updateTileState,
  escapeText
};
