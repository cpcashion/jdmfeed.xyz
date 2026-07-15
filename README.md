# TOUGE 峠 — JDM Feed · jdmfeed.xyz

A TikTok/Tinder-style feed of JDM cars for sale across the United States. Swipe left to pass, swipe right to park a car in your Garage. Live at **https://jdmfeed.xyz**.

**Stack:** Vite + React frontend, hosted free on **GitHub Pages**. Live listings are gathered by a scheduled **GitHub Action** that uses the Claude API's web search tool and publishes them as a static `public/listings.json` — no server to run or pay for.

---

## How the pieces fit

| Piece | What it does |
|---|---|
| `.github/workflows/deploy.yml` | Builds the app and deploys to GitHub Pages on every push to `main` |
| `.github/workflows/refresh-listings.yml` | Every 6 hours (or on demand): runs the listing search, commits `public/listings.json`, triggers a redeploy |
| `scripts/fetch-listings.mjs` | Calls the Claude API with web search to find real, current JDM listings (title, price, specs, source URL, best photo) |
| `src/App.jsx` | The app. Fetches `listings.json` on load; falls back to a built-in demo deck if none is published yet |
| `api/sync.js` | Legacy Vercel serverless variant of the sync — not used by the GitHub Pages deployment |

## One-time setup for live listings

1. Get an Anthropic API key at https://console.anthropic.com (make sure **Web Search** is enabled for your org).
2. In this repo: **Settings → Secrets and variables → Actions → New repository secret**, name it `ANTHROPIC_API_KEY`.
3. Run the **Refresh live listings** workflow from the Actions tab (or wait for the next scheduled run).

Cost: each run uses up to 8 web searches (billed per Anthropic's web search pricing) plus a small number of tokens — a few cents per run, 4 runs/day.

## Local development

```bash
npm install
npm run dev
```

To test the listing fetcher locally:

```bash
ANTHROPIC_API_KEY=sk-ant-... node scripts/fetch-listings.mjs
```

## Custom domain

DNS at Namecheap points `jdmfeed.xyz` (A records → GitHub Pages IPs) and `www` (CNAME → `cpcashion.github.io`). The custom domain is set in **Settings → Pages**; keep **Enforce HTTPS** on once the certificate is issued.
