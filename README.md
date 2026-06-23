# Sound Board App

A client-side soundboard that loads boards from JSON and plays audio with low latency (Web Audio API). No backend required.

## How to run

- **Option A (recommended):** Use a local server so the bundled default board loads correctly.
  - From this folder run: `npx serve` (or `python -m http.server 8080`)
  - Open http://localhost:3000 (or 8080)
- **Option B:** Open `index.html` directly. The default board may not load over `file://` (browser security blocks audio/image fetches). Use **Import Board** to load a JSON or portable ZIP instead.

## Default board

First-time visitors (and **Clear All Data**) load **From Blerp** — 102 sounds with categories, hotkeys, favourites, and tile images bundled under:

- `boards/from-blerp/board.json` — Board definition
- `boards/from-blerp/audio/` — MP3 files
- `boards/from-blerp/images/` — Tile images

To refresh the bundled default from a portable ZIP:

```bash
node tools/import-default-board.js "path/to/your-portable.zip"
```

## Features

- **Grid of sounds** — Click to play. Right-click a tile to edit.
- **Add / Edit / Delete** — Toolbar: Add Sound. Modal: Title, Audio URL, Image URL, Category, Hotkey, Volume, Start/End (trim).
- **Import / Export** — Import Board (JSON or portable ZIP), Export Board (JSON), Export Portable ZIP (board + audio + images).
- **Favourites & recents** — Starred sounds and recent plays are stored on the board as `quickAccess` (`favourites` and `recents` sound IDs). They are included in JSON export, portable ZIP (`board.json`), and browser save. Re-export after changing favourites so shared files stay up to date.
- **Storage** — Changes are saved to the browser’s localStorage / IndexedDB.
- **Hotkeys** — Set a hotkey (e.g. Q) in the editor; press that key to play.

## Blerp export

To copy a board from Blerp.com, use the **Blerp Scraper** app (separate folder in this repo):

1. Open the **Blerp Scraper** folder and read its README, or open `Blerp Scraper/index.html` for instructions and a “Copy script” button.
2. On https://blerp.com/my-stream, log in, open Developer Tools (F12) → Console, paste the script, and press Enter.
3. If sounds are found, a JSON file downloads. Use **Import Board** in this app to load it, or export a portable ZIP and run `tools/import-default-board.js` to replace the bundled default.
4. If nothing downloads, run `BlerpExport.debug()` in the Blerp console and check the output.

## File layout

- `index.html`, `styles.css`, `soundboard.js` — Main app
- `audio-engine.js` — Web Audio: load, cache, play with trim/volume
- `board-manager.js` — Load/validate board JSON, normalize state
- `ui-renderer.js` — Render grid and tiles
- `storage.js` — localStorage save/restore
- `boards/from-blerp/` — Bundled default board (102 sounds)
- `boards/sample-board.json` — Empty fallback if default fetch fails
- `tools/import-default-board.js` — Regenerate bundled default from a portable ZIP
