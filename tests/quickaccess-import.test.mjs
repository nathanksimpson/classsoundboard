/**
 * Node smoke tests for quickAccess import normalization.
 * Run: node tests/quickaccess-import.test.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const boardManagerPath = join(__dirname, '..', 'board-manager.js');
const code = readFileSync(boardManagerPath, 'utf8');

const sandbox = { window: {}, console, Math, JSON, Array, String, Number, isFinite, Date };
vm.createContext(sandbox);
vm.runInContext(code + '\nthis.Board = window.SoundboardBoardManager;', sandbox);

const Board = sandbox.Board;
let passed = 0;
let failed = 0;

function assert(name, cond) {
  if (cond) {
    passed++;
    console.log('  ok', name);
  } else {
    failed++;
    console.error(' FAIL', name);
  }
}

const sampleSounds = [
  { id: 's1', title: 'A', fileUrl: 'http://x/a.mp3' },
  { id: 's2', title: 'B', fileUrl: 'http://x/b.mp3' },
  { id: 's3', title: 'C', fileUrl: 'http://x/c.mp3' }
];

const boardIn = {
  schemaVersion: 1,
  id: 'test-board',
  name: 'Test',
  sounds: sampleSounds,
  quickAccess: {
    favourites: ['s2', 's1'],
    recents: ['s3', 's1', 'missing-id']
  }
};

const normalized = Board.normalizeBoard(boardIn);
assert('quickAccess preserved', normalized.quickAccess != null);
assert('favourites order', JSON.stringify(normalized.quickAccess.favourites) === '["s2","s1"]');
assert('recents trimmed strings', normalized.quickAccess.recents.includes('s3'));
assert('unknown recent id kept until prune', normalized.quickAccess.recents.includes('missing-id'));

const noQa = Board.normalizeBoard({
  schemaVersion: 1,
  id: 'b0',
  name: 'No QA',
  sounds: sampleSounds
});
assert('missing quickAccess defaults empty arrays', noQa.quickAccess != null
  && noQa.quickAccess.favourites.length === 0
  && noQa.quickAccess.recents.length === 0);

const partial = Board.normalizeBoard({
  schemaVersion: 1,
  id: 'b2',
  name: 'Partial',
  sounds: sampleSounds,
  quickAccess: { favourites: ['s1'] }
});
assert('missing recents defaults to empty array', Array.isArray(partial.quickAccess.recents) && partial.quickAccess.recents.length === 0);

// Simulate loadQuickAccessForBoard preference over localStorage
function simulateLoadFromBoard(board, localStorageFavs, localStorageRecents) {
  const qa = board.quickAccess;
  if (qa && typeof qa === 'object') {
    const favs = Array.isArray(qa.favourites) ? qa.favourites.map(String) : [];
    const recs = Array.isArray(qa.recents) ? qa.recents.map(String) : [];
    return { favouriteIds: new Set(favs), recentIds: recs, source: 'board' };
  }
  return { favouriteIds: new Set(localStorageFavs), recentIds: localStorageRecents, source: 'localStorage' };
}

const sim = simulateLoadFromBoard(normalized, ['s3'], ['s2']);
assert('board wins over localStorage', sim.source === 'board');
assert('favourites from board', sim.favouriteIds.has('s2') && sim.favouriteIds.has('s1') && !sim.favouriteIds.has('s3'));

// getQuickAccessSounds no longer filters by search
function getQuickAccessSounds(favouriteIds, recentIds, sounds) {
  const byId = new Map(sounds.map((s) => [String(s.id), s]));
  const favourites = Array.from(favouriteIds).map((id) => byId.get(id)).filter(Boolean);
  const recents = recentIds.map((id) => byId.get(id)).filter(Boolean);
  return { favourites, recents };
}

const strips = getQuickAccessSounds(new Set(['s2']), ['s3'], sampleSounds);
assert('favourites not hidden by search filter', strips.favourites.length === 1 && strips.favourites[0].id === 's2');
assert('recents resolve', strips.recents.length === 1);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
