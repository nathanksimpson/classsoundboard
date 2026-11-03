// Browser test (Playwright): run against a local server signed in with password 'simson-sounds'.
// Usage: node tests/browser/audio-recovery.e2e.mjs <port>
// Recreates the "sound dies after the app loses focus" failures in real Chromium.
import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const BASE = 'http://localhost:' + process.argv[2];
const results = [];
const check = (n, c, d) => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  → ' + JSON.stringify(d))); };

function wav(seconds = 1.5) {
  const rate = 8000, n = Math.floor(rate * seconds), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 3) * 6000), 44 + i * 2);
  return b;
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.route(/cdnjs|blerp|jina|example\.invalid/, (r) => r.abort());
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(BASE + '/');
await page.fill('#password', 'simson-sounds'); await page.click('button[type=submit]'); await page.waitForURL(BASE + '/');
await page.waitForFunction(() => window.SoundboardRepository && window.SoundboardRepository.getBoard());

// One playable shared sound, nothing else.
await page.evaluate(async (bytes) => {
  const R = window.SoundboardRepository;
  const ref = await R.uploadMedia(new Uint8Array(bytes).buffer, 'audio/wav', 'audio');
  const b = R.getBoard();
  b.sounds = [{ id: 'beep', title: 'Beep', audioRef: ref, imageRef: '', category: 'Test', hotkey: 'Q' }];
  R.setBoard(b); await R.saveNow();
}, Array.from(wav()));
await page.reload(); await page.waitForSelector('.tile[data-sound-id="beep"]');

const info = () => page.evaluate(() => window.SoundboardAudio.getDebugInfo());
const tile = '.tile[data-sound-id="beep"]';
async function playAndCheck() {
  await page.evaluate(() => window.SoundboardAudio.stopSound());
  await page.click(tile);                    // a real click = user gesture
  await page.waitForTimeout(900);
  const i = await info();
  const t1 = i.currentTime; await page.waitForTimeout(150); const t2 = (await info()).currentTime;
  return { ...i, clockMoving: t2 > t1, playing: i.active > 0 };
}

let r = await playAndCheck();
check('0. Plays normally', r.playing && r.state === 'running', r);

// 1. Browser paused audio while away and resume() never answers (the main bug)
await page.evaluate(async () => {
  const c = window.SoundboardAudio.getContext();
  window.SoundboardAudio.stopSound();
  await c.suspend();
  c.resume = () => new Promise(() => {});    // hangs forever
  window.dispatchEvent(new Event('blur'));
});
let gen0 = (await info()).generation;
r = await playAndCheck();
check('1. Paused audio that never restarts → replaced, sound plays', r.playing && r.state === 'running' && r.generation > gen0, r);
await page.waitForTimeout(1600);
r = await playAndCheck();
check('1b. …and keeps playing afterwards (no reload)', r.playing, r);

// 2. Audio connection closed by the browser
gen0 = (await info()).generation;
await page.evaluate(async () => { window.SoundboardAudio.stopSound(); await window.SoundboardAudio.getContext().close(); });
r = await playAndCheck();
check('2. Closed audio connection → new one, sound plays', r.playing && r.state === 'running' && r.generation > gen0, r);

// 3. Says "running" but the clock is frozen (seen after sleep / device loss)
gen0 = (await info()).generation;
await page.evaluate(() => {
  window.SoundboardAudio.stopSound();
  const c = window.SoundboardAudio.getContext();
  const frozen = c.currentTime;
  Object.defineProperty(c, 'currentTime', { get: () => frozen, configurable: true });
});
await page.click(tile);
await page.waitForTimeout(1200);
r = await info();
const ta = r.currentTime; await page.waitForTimeout(150); const tb = (await info()).currentTime;
check('3. Frozen audio clock while playing → detected, sound replayed on a fresh connection', r.generation > gen0 && r.active > 0 && tb > ta, { ...r, ta, tb });

// 3b. Frozen clock noticed when coming back to the window (nothing playing)
await page.evaluate(() => window.SoundboardAudio.stopSound());
await page.waitForTimeout(1800);
gen0 = (await info()).generation;
await page.evaluate(() => {
  const c = window.SoundboardAudio.getContext();
  const frozen = c.currentTime;
  Object.defineProperty(c, 'currentTime', { get: () => frozen, configurable: true });
  window.dispatchEvent(new Event('focus'));
});
await page.waitForTimeout(700);
r = await info();
check('3b. Frozen clock found on returning to the page → replaced before the next play', r.generation > gen0 && r.state === 'running', r);

// 4. Sound output changed (projector / headphones) while idle
gen0 = (await info()).generation;
await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')));
await page.waitForTimeout(500);
r = await info();
check('4. Sound output changed → audio reconnected', r.generation > gen0, r);
r = await playAndCheck();
check('4b. Plays on the new output', r.playing, r);

// 5. Hotkey after recovery, and decoded sound reused (no re-download)
await page.evaluate(() => window.SoundboardAudio.stopSound());
const before = (await info()).cached;
await page.evaluate(async () => { window.SoundboardAudio.stopSound(); await window.SoundboardAudio.getContext().close(); });
await page.mouse.click(5, 300);
await page.keyboard.press('q');
await page.waitForTimeout(900);
r = await info();
check('5. Hotkey works after the audio was lost, reusing the decoded sound', r.active > 0 && r.cached === before, { ...r, before });

// 6. Reinitialize button now opens a fresh connection
gen0 = (await info()).generation;
await page.evaluate(() => document.querySelector('[data-action="reinitialize"]').click());
await page.waitForTimeout(600);
r = await info();
check('6. Reinitialize sounds really restarts audio', r.generation > gen0 && r.state === 'running', r);

// 7. No churn: normal focus changes don't restart a healthy connection
gen0 = (await info()).generation;
for (let i = 0; i < 5; i++) await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
await page.waitForTimeout(800);
r = await info();
check('7. Healthy audio is left alone when switching windows', r.generation === gen0, r);

const status = await page.textContent('#status-line');
console.log('status line:', status);
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
