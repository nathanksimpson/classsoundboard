# Audio pipeline

## Playback chain

1. Decode audio (`fetch` or `local:` IndexedDB blob) → `AudioBuffer`
2. `BufferSource` → per-sound gain (`volume × normGain`) → master gain → optional compressor → speakers

## Auto level (LUFS)

- **Analyze all** (or automatic on load when enabled) measures **integrated loudness** (ITU-R BS.1770 style) via `loudness.js`.
- **Target:** -14 LUFS (streaming-style; configurable in `audio-engine.js` as `TARGET_LUFS`).
- Results stored on each sound: `extra.normGain`, `extra.normAlgoVersion` (currently `2`), optional `extra.normLufs`.
- **Trim:** Analysis uses the sound’s `startMs` / `endMs` window when set.
- **Re-analyze:** Sounds with `normAlgoVersion` &lt; 2 (or missing gain) are analyzed again on load or via **Analyze all**.

## Peak safety

Separate toolbar checkbox **Peak safety** controls the master `DynamicsCompressorNode` (gentle peak taming). **Auto level** only applies per-sound normalization gain.

## Limits

- Normalization is **playback-only**; exported JSON/ZIP does not rewrite audio files.
- Not a substitute for mastering; very short or silent clips may hit gain clamps (±12 dB).
- True peak limiting uses weighted sample peak (not oversampled true-peak).

## URL schemes

| Scheme | Meaning |
|--------|---------|
| `https://…` | Remote audio |
| `local:…` | Blob id in IndexedDB |
| `zip:…` | Path inside portable ZIP (resolved on import) |

## iOS / iPad

Use **Analyze all** after importing a board. For editing sounds, scroll the form; **Save** stays in the sticky footer. Run from HTTPS or localhost (Web Audio may need a user tap to start on iOS).
