# Class Soundboard

A shared classroom soundboard on its own Cloudflare Worker. Every computer
sees the same board: add, edit or upload a sound on one computer and the
others pick it up within about 15 seconds (or as soon as you switch back to
the tab).

- **Sign-in:** one team password. Each computer stays signed in for 6 months.
  Changing the password signs every computer out.
- **Storage:** Cloudflare D1 database `classsoundboard`. The board is one JSON
  row; uploaded audio and images are stored once (by content hash) and
  shared by every computer. Browsers only keep a cache.
- **Hotkeys:** work with the 한글 keyboard on, after using the volume slider,
  with quick overlapping taps, and for several Shift+ shortcuts in a row.

## First deploy (one time)

The database is already created and has its tables. You need to set the
password and publish the Worker. Either way works:

### Option A — from the Cloudflare dashboard (no installs)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. Pick `nathanksimpson/classsoundboard`, production branch **`main`**.
   Leave the build command empty; deploy command `npx wrangler deploy`.
3. After it's created: the Worker → **Settings → Variables and Secrets** → add two **Secrets**:
   - `TEAM_PASSWORD` — the password teachers will type.
   - `SESSION_SECRET` — any long random text (40+ characters). Nobody types this.
4. **Deployments → Retry/redeploy** so the secrets take effect.
5. Open the `…workers.dev` address it shows and sign in.

### Option B — from a PC with Node.js 20+

```bash
npm install
npx wrangler login
npx wrangler secret put TEAM_PASSWORD
npx wrangler secret put SESSION_SECRET
npm run deploy
```

## Moving over from ClassManager

- **The board copies itself.** The first time anyone signs in, the Worker reads
  the soundboard from ClassManager's database (`LEGACY_DB` in `wrangler.jsonc`)
  — but only if this site has no board yet, so it never overwrites anything.
  Sounds whose audio was saved in a single browser are restored from the
  built-in default board where possible.
- **After that first sign-in, delete the `LEGACY_DB` block** from
  `wrangler.jsonc` and deploy again, so this Worker no longer has access to
  ClassManager's data.
- **Sounds saved only on one computer:** on that computer, open the *old*
  soundboard (`classmanager.live/soundboard`) → menu → **Export portable ZIP**.
  Then on the new site → **Import** → **Merge into board** → choose the ZIP.
  Those sounds are uploaded once and then play on every computer. Do this
  before the soundboard is removed from ClassManager.

## Day to day

- **Download media** (menu): copies sounds that still stream from Blerp into
  your own storage, so they keep working if Blerp changes.
- **Clear All Data**: clears only *this computer's* cached copy and reloads the
  shared board. To replace the shared board, use Import → Replace entire board.
- **Sign out**: menu → Sign out.

## Develop

```bash
cp .dev.vars.example .dev.vars   # set a local password
npm install
npm run dev                      # http://localhost:8787
npm test                         # node tests (no install needed)
```

Layout: `public/` is the app (served as static assets, behind the password),
`src/index.js` routing + sign-in, `src/soundboard.js` board/media storage,
`src/auth.js` signed session cookies, `migrations/` database schema.

Limits: 15 MB per uploaded file; 10 wrong passwords per IP per 15 minutes
locks sign-in from that IP for 15 minutes.
