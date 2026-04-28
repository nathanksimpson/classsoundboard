/**
 * storage.js — Save/restore board to localStorage.
 * Key: soundboard-board
 */

const STORAGE_KEY = 'soundboard-board';

function saveBoard(board) {
  if (!board || typeof board !== 'object') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  } catch (e) {
    console.warn('storage: save failed', e);
  }
}

function loadBoard() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('storage: load failed', e);
    return null;
  }
}

function clearBoard() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('storage: clear failed', e);
  }
}

window.SoundboardStorage = { saveBoard, loadBoard, clearBoard };
