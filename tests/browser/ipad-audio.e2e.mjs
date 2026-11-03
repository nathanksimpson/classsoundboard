// Browser test (Playwright): emulates iPadOS audio rules. Usage: node tests/browser/ipad-audio.e2e.mjs <port>
// Emulates iPadOS Safari audio rules in Chromium:
//  - audio can only be created/resumed during a tap (otherwise it stays muted)
//  - switching apps "interrupts" audio; resume() may never answer
//  - or audio claims to be running but is silent
import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const BASE = 'http://localhost:' + process.argv[2];
const LABEL = process.argv[3] || '';
const out = [];

function wav(seconds = 1.5) {
  const rate = 8000, n = Math.floor(rate * seconds), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 3) * 6000), 44 + i * 2);
  return b;
}

const IOS = () => {
  const Native = window.AudioContext;
  let inGesture = false;
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchend', 'keydown', 'keyup'].forEach((t) =>
    window.addEventListener(t, () => { inGesture = true; setTimeout(() => { inGesture = false; }, 0); }, true));
  let vis = 'visible';
  Object.defineProperty(document, 'visibilityState', { get: () => vis, configurable: true });
  Object.defineProperty(document, 'hidden', { get: () => vis === 'hidden', configurable: true });
  window.__ios = {
    list: [],
    setVisible(v) { vis = v; document.dispatchEvent(new Event('visibilitychange')); },
    current() { return this.list[this.list.length - 1]; }
  };
  class IOSAudioContext extends Native {
    constructor(...a) {
      super(...a);
      this.__silent = false;
      window.__ios.list.push(this);
      if (!inGesture) super.suspend();            // created outside a tap → muted
    }
    resume() {
      if (this.__hang || !inGesture) return new Promise(() => {});   // never answers
      return super.resume();
    }
  }
  window.AudioContext = IOSAudioContext;
  window.webkitAudioContext = IOSAudioContext;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1024, height: 768 }, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
});
await ctx.addInitScript(IOS);
await ctx.route(/cdnjs|blerp|jina|example\.invalid/, (r) => r.abort());
const page = await ctx.newPage();
await page.goto(BASE + '/');
await page.fill('#password', 'simson-sounds'); await page.click('button[type=submit]'); await page.waitForURL(BASE + '/');
await page.waitForFunction(() => window.SoundboardRepository && window.SoundboardRepository.getBoard());
await page.evaluate(async (bytes) => {
  const R = window.SoundboardRepository;
  const ref = await R.uploadMedia(new Uint8Array(bytes).buffer, 'audio/wav', 'audio');
  const b = R.getBoard();
  b.sounds = [{ id: 'beep', title: 'Beep', audioRef: ref, imageRef: '', category: 'Test', hotkey: 'Q' }];
  R.setBoard(b); await R.saveNow();
}, Array.from(wav()));
await page.reload(); await page.waitForSelector('.tile[data-sound-id="beep"]');

// Is sound really coming out? (a running, non-silent connection whose clock moves, with a sound on it)
async function audible() {
  return page.evaluate(() => new Promise((res) => {
    const c = window.__ios.current();
    const A = window.SoundboardAudio;
    const active = A.getDebugInfo ? A.getDebugInfo().active : 1;
    if (!c || c.state !== 'running' || c.__silent || !active) return res(false);
    const t = c.currentTime; setTimeout(() => res(c.currentTime > t), 150);
  }));
}
async function tapsUntilSound(how = 'tap', max = 4) {
  for (let i = 1; i <= max; i++) {
    await page.evaluate(() => window.SoundboardAudio.stopSound());
    if (how === 'key') await page.keyboard.press('q'); else await page.tap('.tile[data-sound-id="beep"]');
    await page.waitForTimeout(1000);
    if (await audible()) return i;
  }
  return 'never';
}
async function switchApps(effect) {
  await page.evaluate(() => window.SoundboardAudio.stopSound());
  await page.evaluate(async (effect) => {
    const c = window.__ios.current();
    window.__ios.setVisible('hidden');
    if (effect === 'interrupted') {
      await c.suspend();
      Object.defineProperty(c, 'state', { get: () => 'interrupted', configurable: true });
      c.__hang = true;
      if (c.onstatechange) c.onstatechange();
    } else if (effect === 'silent') {
      c.__silent = true;                     // still says "running", but no sound comes out
    }
    await new Promise((r) => setTimeout(r, 1500));
    window.__ios.setVisible('visible');
  }, effect);
}

const row = (name, taps) => { out.push([name, taps]); console.log(LABEL.padEnd(8), name.padEnd(58), 'taps needed:', taps); };
row('First tap after opening the page', await tapsUntilSound());
await switchApps('interrupted'); row('Back from another app (audio interrupted, restart hangs)', await tapsUntilSound());
await switchApps('silent'); row('Back from another app (says running but silent)', await tapsUntilSound());
await switchApps('interrupted'); row('Same, using a keyboard hotkey (Q)', await tapsUntilSound('key'));
await switchApps('silent'); row('Again after a second app switch', await tapsUntilSound());
await browser.close();
console.log(JSON.stringify(out));
