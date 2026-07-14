# TOUGE 峠 — JDM Feed · jdmfeed.xyz

A TikTok/Tinder-style feed of JDM cars for sale across the United States. Swipe left to pass, swipe right to park a car in your Garage. The **Sync** button pulls real, current listings from the web (Bring a Trailer, Cars & Bids, Hemmings, importer sites) through a serverless endpoint powered by Claude's web search — with a link back to every original listing.

**Stack:** Vite + React (frontend) · Vercel serverless function (`/api/sync`) · localStorage persistence · PWA-installable.

---

## Launch runbook — from this folder to live at jdmfeed.xyz

### 0. Prerequisites (10 minutes, all free tiers)

- **Node 18+** installed (`node -v`)
- A **GitHub** account (you: `cpcashion`)
- A **Vercel** account — sign up at vercel.com with your GitHub login
- An **Anthropic API key** from https://console.anthropic.com
  - In the Console, make sure **Web Search** is enabled for your organization (org settings → tools/privacy)
  - Web search is usage-billed per search (see Anthropic's pricing page); each Sync tap is capped at 5 searches in `api/sync.js`

### 1. Create the GitHub repo

From inside this folder:

```bash
git init
git add -A
git commit -m "TOUGE — JDM swipe feed v1"

# With GitHub CLI (easiest):
gh repo create cpcashion/jdm-feed --public --source=. --push

# Or manually: create an empty repo named jdm-feed at github.com/cpcashion, then:
# git remote add origin https://github.com/cpcashion/jdm-feed.git
# git branch -M main && git push -u origin main
```

### 2. Deploy on Vercel

1. Go to **vercel.com → Add New → Project → Import** `cpcashion/jdm-feed`
2. Framework preset: **Vite** (auto-detected). Leave build settings as-is.
3. Before deploying, open **Environment Variables** and add:
   - `ANTHROPIC_API_KEY` = your key (all environments)
4. Click **Deploy**. You'll get a working URL like `jdm-feed.vercel.app` in ~1 minute.
5. Test it: open the site, tap the **↻ Sync** button — live listings should appear with green **● LIVE** badges.

### 3. Point jdmfeed.xyz at the app (Namecheap)

In Vercel: **Project → Settings → Domains → Add** → enter `jdmfeed.xyz`, and add `www.jdmfeed.xyz` too (set the apex as primary; www will redirect).

Then in **Namecheap → Domain List → jdmfeed.xyz → Advanced DNS** (keep "Namecheap BasicDNS" selected, exactly like your screenshot):

1. **Delete** the two parking records that are there now:
   - the `CNAME` record: `www → parkingpage.namecheap.com`
   - the `URL Redirect` record: `@ → http://www.jdmfeed.xyz/`
2. **Add** these two records:

   | Type  | Host | Value                  | TTL       |
   |-------|------|------------------------|-----------|
   | A     | @    | `76.76.21.21`          | Automatic |
   | CNAME | www  | `cname.vercel-dns.com` | Automatic |

   (If Vercel's Domains screen shows you different values, use whatever Vercel displays — it's the source of truth.)

3. Wait for DNS to propagate (usually minutes, up to an hour). Vercel will show a green checkmark next to the domain and issue HTTPS automatically.

**Done — https://jdmfeed.xyz is live.**

### 4. Local development

```bash
npm install
npx vercel dev     # runs the frontend AND /api/sync locally
# put ANTHROPIC_API_KEY in a local .env file first (see .env.example)
```

`npm run dev` also works for UI-only work, but the Sync button needs `vercel dev` (or the deployed site) since it calls the serverless function.

---

## How the data layer works (and how it grows into the full scraper)

`/api/sync` is intentionally a single seam. Today it asks Claude + web search to find and verify current US listings across BaT, Cars & Bids, Hemmings, and importer sites, returning them in the normalized listing schema (`title, year, make, model, chassis, price, mileage, transmission, engine, drivetrain, location, source, source_url, description`). Every card links back to the original listing — this app surfaces sellers' listings, it doesn't replace them.

When you're ready for the full aggregation backend from the original spec (scheduled scraper adapters → Postgres → dedupe → `/feed`), you swap the body of `api/sync.js` for a database read and **nothing in the client changes**. Practical notes for that phase:

- Prefer official APIs/feeds where they exist; respect each source's robots.txt and ToS (Facebook Marketplace in particular blocks scraping)
- One adapter per source, run on a schedule (Vercel Cron or a small worker), dedupe on VIN or fuzzy title+price+location
- Keep rate limits polite and add a health check per adapter so a site redesign doesn't silently empty the feed

## iOS app later

The app is already installable today — on iPhone, open jdmfeed.xyz in Safari → Share → **Add to Home Screen** (standalone, full-screen, its own icon). For a real App Store build, wrap this exact codebase with **Capacitor** (fastest) or port the components to **React Native** — all gestures are Pointer Events and the layout already respects iOS safe areas, so both paths are clean.

## Costs at a glance

- Vercel Hobby: free for this traffic level
- Domain: already yours
- Anthropic API: pay-per-use — each Sync tap ≈ up to 5 web searches + one small model call. If the site gets popular, add caching (e.g., store each sync result in Vercel KV for 30–60 min) so visitors share results instead of each triggering searches.
