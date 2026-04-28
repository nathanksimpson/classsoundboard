# Sound Board App

A client-side soundboard that loads boards from JSON and plays audio with low latency (Web Audio API). No backend required.

## How to run

- **Option A (recommended):** Use a local server so `boards/sample-board.json` loads correctly.
  - From this folder run: `npx serve` (or `python -m http.server 8080`)
  - Open http://localhost:3000 (or 8080)
- **Option B:** Open `index.html` directly. If the sample board fails to load (e.g. on `file://`), use **Import Board** to load a JSON file.

## Features

- **Grid of sounds** — Click to play. Right-click a tile to edit.
- **Add / Edit / Delete** — Toolbar: Add Sound. Modal: Title, Audio URL, Image URL, Category, Hotkey, Volume, Start/End (trim).
- **Import / Export** — Import Board (JSON file), Export Board (downloads JSON).
- **Storage** — Changes are saved to the browser’s localStorage.
- **Hotkeys** — Set a hotkey (e.g. Q) in the editor; press that key to play.

## Blerp export

To copy a board from Blerp.com, use the **Blerp Scraper** app (separate folder in this repo):

1. Open the **Blerp Scraper** folder and read its README, or open `Blerp Scraper/index.html` for instructions and a “Copy script” button.
2. On https://blerp.com/my-stream, log in, open Developer Tools (F12) → Console, paste the script, and press Enter.
3. If sounds are found, a JSON file downloads. Use **Import Board** in this app to load it.
4. If nothing downloads, run `BlerpExport.debug()` in the Blerp console and check the output.

## File layout

- `index.html`, `styles.css`, `soundboard.js` — Main app
- `audio-engine.js` — Web Audio: load, cache, play with trim/volume
- `board-manager.js` — Load/validate board JSON, normalize state
- `ui-renderer.js` — Render grid and tiles
- `storage.js` — localStorage save/restore
- `boards/sample-board.json` — Sample board
