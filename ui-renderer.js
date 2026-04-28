/**
 * ui-renderer.js — Render sound grid, tile states (idle/hover/playing/error), bind events.
 * Uses textContent only (no innerHTML) for XSS safety.
 */

function escapeText(str) {
  if (str == null) return '';
  return String(str);
}

function renderTile(sound, state, index, reorderMode) {
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
  el.setAttribute('aria-label', reorderMode ? 'Drag to reorder: ' + title : 'Play ' + title);
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

  if (!reorderMode) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'tile__edit';
    editBtn.setAttribute('aria-label', 'Edit ' + title);
    editBtn.title = 'Edit';
    editBtn.textContent = '\u270E';
    el.appendChild(editBtn);
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

function renderGrid(container, sounds, playState, errorIds, onPlay, onEdit, reorderMode, onReorder) {
  if (!container) return;
  container.classList.remove('grid-groups');
  container.classList.add('grid');
  container.textContent = '';
  if (!Array.isArray(sounds) || sounds.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = 'No sounds. Add a sound or import a board.';
    container.appendChild(empty);
    return;
  }

  const reorder = !!reorderMode && typeof onReorder === 'function';

  sounds.forEach((s, i) => {
    const state = playState === s.id ? 'playing' : (errorIds && errorIds.has(s.id)) ? 'error' : 'idle';
    const tile = renderTile(s, state, i, reorder);
    tile.addEventListener('click', (e) => {
      e.preventDefault();
      if (reorder) return;
      if (onPlay) onPlay(s);
    });
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

function renderGroupedGrid(container, groups, playState, errorIds, onPlay, onEdit, reorderMode, onReorder, options = {}) {
  if (!container) return;
  container.classList.remove('grid');
  container.classList.add('grid-groups');
  container.textContent = '';

  // In reorder mode we fall back to the flat grid renderer (drag/drop stays simple)
  if (reorderMode) {
    const sounds = Array.isArray(options.allSounds) ? options.allSounds : [];
    renderGrid(container, sounds, playState, errorIds, onPlay, onEdit, reorderMode, onReorder);
    return;
  }

  const list = Array.isArray(groups) ? groups : [];
  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-message';
    empty.textContent = 'No sounds match your search.';
    container.appendChild(empty);
    return;
  }

  const isCollapsed = typeof options.isCollapsed === 'function' ? options.isCollapsed : (() => false);
  const onToggleCategory = typeof options.onToggleCategory === 'function' ? options.onToggleCategory : null;

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

    const body = document.createElement('div');
    body.className = 'category__body';
    body.id = safeId;

    const grid = document.createElement('div');
    grid.className = 'grid';
    body.appendChild(grid);

    renderGrid(grid, sounds, playState, errorIds, onPlay, onEdit, false, null);

    section.appendChild(header);
    section.appendChild(body);
    container.appendChild(section);
  });
}

window.SoundboardUIRenderer = {
  renderGrid,
  renderGroupedGrid,
  updateTileState,
  escapeText
};
