# PopJDM (repo: cpcashion/jdmfeed.xyz)

Swipe-feed web app for JDM cars currently for sale in the US. Live at
**https://popjdm.com** (custom domain via CNAME; the repo name jdmfeed.xyz is
historical — the old domain is no longer the canonical origin).

## Key facts

- **Domain**: popjdm.com (changed from jdmfeed.xyz). The Google OAuth client's
  Authorized JavaScript origins were updated by the owner to match — any future
  domain change must also be mirrored there or sign-in breaks with
  `origin_mismatch`.
- **Hosting**: GitHub Pages, branch mode ("Deploy from a branch", main). The
  built app is committed to the repo ROOT (index.html, assets/) by
  deploy.yml because the workflow token cannot switch Pages build_type.
  App source lives in `app/` (vite root, relative base).
- **Google sign-in**: Google Identity Services, client id in `app/src/App.jsx`
  (`GOOGLE_CLIENT_ID`). Per-account garage keyed to the Google `sub`.
- **Profiles / garage sync**: Firebase Auth + Firestore over plain REST (no
  SDK) — the GIS sign-in credential is exchanged via `signInWithIdp` for a
  refresh token stored in localStorage, so sync is silent on every visit
  (no popups; the old Drive appDataFolder approach was removed because its
  hourly token popup gets blocked outside a tap). Garage doc:
  `garages/{uid}`, one JSON `data` field, timestamped last-writer-wins
  merge with tombstones. Gated on `window.FIREBASE = { apiKey, projectId }`
  in `app/index.html` — empty until the owner does the one-time setup:
  1. console.firebase.google.com → Add project (Analytics off is fine).
  2. Build → Authentication → Sign-in method → enable **Google**; under
     "Web SDK configuration" paste the existing `GOOGLE_CLIENT_ID`.
  3. Authentication → Settings → Authorized domains → add `popjdm.com`.
  4. Build → Firestore Database → Create (production mode) → Rules:
     `rules_version = '2'; service cloud.firestore { match /databases/{db}/documents { match /garages/{uid} { allow read, write: if request.auth != null && request.auth.uid == uid; } } }`
  5. Project settings → Your apps → add a Web app → copy `apiKey` and
     `projectId` into `window.FIREBASE` in `app/index.html`.
- **Data pipeline** (all free, runs in GitHub Actions):
  - `.github/workflows/refresh-listings.yml` — cron every 6h + manual.
  - `scripts/fetch-listings.mjs` unions sources, sorts newest-first, writes
    `app/public/listings.json` (+ copies to repo root for branch-mode Pages).
  - `scripts/sources/bringatrailer.mjs` — active BaT auctions from the
    server-rendered auctions blob; per-auction page fetch for photo galleries.
  - `scripts/sources/ebay.mjs` — eBay Browse API, ~40 JDM nameplate sweeps,
    Cars & Trucks (6001), US only. Auth: `EBAY_CERT_ID` repo secret +
    hardcoded client id. Item-detail enrichment (specs, gallery, location,
    itemCreationDate) with a cross-run cache via `enriched` generation
    numbers in listings.json — bump the generation to force a full re-fetch.
  - `scripts/process-cutouts.py` — rembg (isnet-general-use) cut-outs with
    halo/blob cleanup; cache keyed by CUT_VERSION|image_url; bump
    CUT_VERSION to regenerate all.
- **Workflows race**: refresh runs can take ~30 min; deploys push to main
  meanwhile. The publish step rebases + retries its push — keep that.
- **Shipping flow**: work on branch `claude/cutout-tune` (or the designated
  branch), PR → squash-merge to main → deploy.yml publishes automatically.
  The sandbox cannot reach external sites — test data changes via CI logs and
  UI changes via local vite preview + the global Playwright install
  (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).
- **Analytics**: GA4 loader in `app/index.html`, gated on `window.GA_ID` —
  needs the owner's Measurement ID (G-…) pasted there to activate.
