#!/usr/bin/env node
/**
 * Extract a portable soundboard ZIP into boards/from-blerp/ for bundled default load.
 *
 * Usage (from Sound Board App folder):
 *   node tools/import-default-board.js "path/to/board-portable.zip"
 *
 * Rewrites zip:audio/... and zip:images/... paths to HTTP-relative paths under boards/from-blerp/.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(APP_ROOT, 'boards', 'from-blerp');
const BOARD_PREFIX = 'boards/from-blerp';

function usage() {
  console.error('Usage: node tools/import-default-board.js <portable.zip>');
  process.exit(1);
}

function extractZip(zipPath, destDir) {
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  const absZip = path.resolve(zipPath);
  if (!fs.existsSync(absZip)) {
    console.error('ZIP not found:', absZip);
    process.exit(1);
  }

  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${absZip.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`,
      { stdio: 'inherit' }
    );
  } else {
    execSync(`unzip -o "${absZip}" -d "${destDir}"`, { stdio: 'inherit' });
  }
}

function rewriteBoardPaths(board) {
  if (!board || !Array.isArray(board.sounds)) return board;
  board.id = board.id || 'default-from-blerp';
  for (const s of board.sounds) {
    if (typeof s.fileUrl === 'string' && s.fileUrl.startsWith('zip:')) {
      const rel = s.fileUrl.slice(4);
      s.fileUrl = `${BOARD_PREFIX}/${rel}`;
    }
    if (typeof s.imageUrl === 'string' && s.imageUrl.startsWith('zip:')) {
      const rel = s.imageUrl.slice(4);
      s.imageUrl = `${BOARD_PREFIX}/${rel}`;
    }
  }
  return board;
}

function main() {
  const zipArg = process.argv[2];
  if (!zipArg) usage();

  const zipPath = path.resolve(process.cwd(), zipArg);
  const staging = path.join(APP_ROOT, 'boards', '.from-blerp-staging');

  console.log('Extracting', zipPath);
  extractZip(zipPath, staging);

  const boardPath = path.join(staging, 'board.json');
  if (!fs.existsSync(boardPath)) {
    console.error('ZIP missing board.json');
    process.exit(1);
  }

  const board = rewriteBoardPaths(JSON.parse(fs.readFileSync(boardPath, 'utf8')));
  fs.writeFileSync(boardPath, JSON.stringify(board, null, 2), 'utf8');

  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
  fs.renameSync(staging, OUT_DIR);

  const audioCount = fs.existsSync(path.join(OUT_DIR, 'audio'))
    ? fs.readdirSync(path.join(OUT_DIR, 'audio')).length
    : 0;
  const imageCount = fs.existsSync(path.join(OUT_DIR, 'images'))
    ? fs.readdirSync(path.join(OUT_DIR, 'images')).length
    : 0;
  const soundCount = Array.isArray(board.sounds) ? board.sounds.length : 0;

  console.log(`Done: ${OUT_DIR}`);
  console.log(`  Board: ${board.name || board.id} (${soundCount} sounds)`);
  console.log(`  Audio files: ${audioCount}, Image files: ${imageCount}`);
}

main();
