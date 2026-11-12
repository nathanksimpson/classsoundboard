// Browser test (Playwright). Usage: node tests/browser/recently-added.e2e.mjs <port>
import { createRequire } from 'module';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const BASE = 'http://localhost:' + process.argv[2];
const results = []; const check = (n, c, d) => { results.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  → ' + JSON.stringify(d))); };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
async function computer() {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.route(/cdnjs|blerp|jina|example\.invalid/, (r) => r.abort());
  const p = await ctx.newPage(); p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await p.goto(BASE + '/'); await p.fill('#password', 'simson-sounds'); await p.click('button[type=submit]'); await p.waitForURL(BASE + '/');
  await p.waitForFunction(() => window.SoundboardRepository && window.SoundboardRepository.getBoard());
  return p;
}
const A = await computer();
// Board like production: older sounds with no added date
await A.evaluate(async () => {
  const R = window.SoundboardRepository; const b = R.getBoard();
  b.sounds = ['Old one', 'Old two', 'Old three'].map((t, i) => ({ id: 'old' + i, title: t, audioRef: 'remote:https://example.invalid/' + i + '.mp3', category: 'Old' }));
  b.layout.quickAccess.favourites = ['old1'];
  R.setBoard(b); await R.saveNow();
});
await A.reload(); await A.waitForSelector('#added-strip');
const titles = (p, sel) => p.$$eval(sel + ' .tile', (ts) => ts.map((t) => (t.querySelector('.tile__title') || t).textContent.replace(/[✎★☆]/g, '').trim()));
check('1. Older sounds (no added date) are not listed; helpful empty message', (await A.$$('#added-strip .tile')).length === 0 && /add or import/.test(await A.textContent('#added-strip')), await A.textContent('#added-strip'));
check('2. Section sits under Favourites with its own header', await A.evaluate(() => { const s = [...document.querySelectorAll('#quick-access > .quick-access__section')].map((e) => e.id); return s.join(',') === 'recents-section,favourites-section,added-section'; }));

// Add via the + Add button, give it a title, save
await A.click('#header-toggle'); await A.waitForTimeout(200); await A.click('[data-action="add"]');
await A.fill('#modal-form [name="title"]', 'Brand new');
await A.click('#modal-form button[type="submit"]');
await A.waitForTimeout(400);
let t = await titles(A, '#added-strip');
check('3. A sound added with + Add appears in Recently added', t[0] === 'Brand new', t);

// Import (merge) two sounds a moment later → newest first
await A.waitForTimeout(30);
await A.evaluate(async () => {
  const M = window.SoundboardMergeEngine; const R = window.SoundboardRepository;
  const inc = { schemaVersion: 2, sounds: [{ id: 'imp1', title: 'Imported A', audioRef: 'remote:https://example.invalid/a.mp3' }, { id: 'imp2', title: 'Imported B', audioRef: 'remote:https://example.invalid/b.mp3' }] };
  const { board } = M.mergeBoards(R.getBoard(), inc);
  R.setBoard(board); await R.saveNow();
});
await A.evaluate(() => window.dispatchEvent(new Event('focus')));
await A.waitForTimeout(300);
await A.evaluate(() => { const R = window.SoundboardRepository; R.setBoard(R.getBoard(), { save: false }); });
await A.reload(); await A.waitForSelector('#added-strip .tile');
t = await titles(A, '#added-strip');
check('4. Imported sounds listed newest first, old sounds still left out', t.length === 3 && t[2] === 'Brand new' && t.includes('Imported A') && !t.some((x) => x.startsWith('Old')), t);
check('5. Count shows in the header', /3 sounds/.test(await A.textContent('#added-count')), await A.textContent('#added-count'));

// Shared: second computer sees the same list
const B = await computer(); await B.waitForSelector('#added-strip .tile');
check('6. Another computer sees the same Recently added list', JSON.stringify(await titles(B, '#added-strip')) === JSON.stringify(t), await titles(B, '#added-strip'));

// Rows + collapse remembered, others unaffected
await A.selectOption('#added-rows-select', '2');
await A.click('#added-collapse-toggle');
await A.reload(); await A.waitForSelector('#added-section');
const st = await A.evaluate(() => ({ rows: document.querySelector('#added-rows-select').value, collapsed: document.querySelector('#added-section').classList.contains('quick-access__section--collapsed'), favCollapsed: document.querySelector('#favourites-section').classList.contains('quick-access__section--collapsed') }));
check('7. Rows and collapse are remembered; Favourites not affected', st.rows === '2' && st.collapsed && !st.favCollapsed, st);
await A.click('#added-collapse-toggle');

// Playing from the strip works and lands in Recents; favourites intact
await A.click('#added-strip .tile[data-sound-id="imp2"]');
await A.waitForTimeout(500);
const recentFirst = await A.evaluate(() => JSON.parse(localStorage.getItem('soundboard-recents-local') || '[]')[0]);
check('8. Tapping a tile in Recently added plays it (it shows in Recents)', recentFirst === 'imp2', recentFirst);
check('9. Favourites still shows its sound', (await titles(A, '#favourites-strip'))[0] === 'Old two', await titles(A, '#favourites-strip'));

// Server keeps the dates
const srv = await A.evaluate(async () => (await (await fetch('/api/soundboard')).json()).board.sounds.filter((s) => s.addedAt).map((s) => s.id));
check('10. Added dates are saved on the shared board', srv.length === 3 && srv.includes('imp1'), srv);

// Re-importing the same sounds doesn't bump them
const before = await A.evaluate(() => window.SoundboardRepository.getBoard().sounds.find((s) => s.id === 'imp1').addedAt);
await A.evaluate(() => { const M = window.SoundboardMergeEngine; const R = window.SoundboardRepository; const { board } = M.mergeBoards(R.getBoard(), { schemaVersion: 2, sounds: [{ id: 'imp1', title: 'Imported A', audioRef: 'remote:https://example.invalid/a.mp3' }] }); R.setBoard(board); });
const after = await A.evaluate(() => window.SoundboardRepository.getBoard().sounds.find((s) => s.id === 'imp1').addedAt);
check('11. Re-importing a sound already on the board keeps its original date', before === after, { before, after });

await A.selectOption('#added-rows-select', '1');
await A.setViewportSize({ width: 1024, height: 768 });
await A.evaluate(() => window.scrollTo(0, 0));
await A.screenshot({ path: '/tmp/claude-0/sbtest/recently-added.png' });
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
