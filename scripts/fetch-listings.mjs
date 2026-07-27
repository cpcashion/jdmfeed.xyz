/**
 * scripts/fetch-listings.mjs
 *
 * Builds app/public/listings.json from real per-source fetchers. Each source
 * returns only its *currently-active* listings, so sold/ended cars never
 * appear. Runs every 6h via .github/workflows/refresh-listings.yml.
 *
 * Adding a source = write scripts/sources/<name>.mjs exporting an async
 * function that returns listing objects, then add it to SOURCES below.
 */

import fs from "node:fs";
import path from "node:path";
import { fetchBringATrailer } from "./sources/bringatrailer.mjs";
import { fetchEbayMotors } from "./sources/ebay.mjs";
import { fetchJdmBuySell, fetchMontu, fetchJdmSportClassics } from "./sources/dealers.mjs";

const OUT = path.resolve("app/public/listings.json");
const HIST = path.resolve("app/public/history.json");
const MAX_LISTINGS = 1000;
const MAX_HISTORY = 3000; // departed listings retained — bounds repo growth
const MAX_POINTS = 24; // price points kept per listing

const SOURCES = [
  ["Bring a Trailer", fetchBringATrailer],
  ["eBay Motors", fetchEbayMotors],
  ["JDM Buy & Sell", fetchJdmBuySell],
  ["Montu Motors", fetchMontu],
  ["JDM Sport Classics", fetchJdmSportClassics],
];

const all = [];
for (const [name, fn] of SOURCES) {
  try {
    const items = await fn();
    console.log(`${name}: ${items.length} active listings`);
    all.push(...items);
  } catch (err) {
    console.error(`${name} failed: ${err.message}`);
  }
}

// Dedupe by listing URL, keep only well-formed rows.
const seen = new Set();
const deduped = all.filter((l) => {
  if (!l.source_url || !l.title) return false;
  const k = l.source_url.toLowerCase();
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

/* ---- longitudinal state ----

   Each run previously kept only first_seen and overwrote everything else,
   so a car that dropped $14k over three months left no trace. Now every
   listing carries its own price history and a last_seen stamp, and cars
   that leave the feed are archived instead of vanishing.

   None of this can be backfilled — a price change we don't record when it
   happens is gone — so it accrues from the first run this ships in. */
const prev = new Map(); // source_url → previous record
try {
  const old = JSON.parse(fs.readFileSync(OUT, "utf8"));
  for (const l of old.listings || []) {
    if (l.source_url) prev.set(l.source_url.toLowerCase(), l);
  }
} catch { /* first run */ }

const nowIso = new Date().toISOString();
for (const l of deduped) {
  const p = prev.get(l.source_url.toLowerCase());
  l.first_seen = p?.first_seen || l.listed_at || nowIso;
  l.last_seen = nowIso;
  // Append a point only when the price actually moves, so the series stays
  // small across four runs a day and every entry is a real event.
  const hist = Array.isArray(p?.price_history) ? [...p.price_history] : [];
  const last = hist.length ? hist[hist.length - 1].p : undefined;
  if (l.price > 0 && l.price !== last) hist.push({ t: nowIso, p: l.price });
  if (hist.length > MAX_POINTS) hist.splice(0, hist.length - MAX_POINTS);
  l.price_history = hist;
}

// Cars that were in the last run but aren't listed now: keep a trimmed
// record so a future relist can be recognised as the same car returning.
const liveUrls = new Set(deduped.map((l) => l.source_url.toLowerCase()));
const departed = [];
for (const [key, l] of prev) {
  if (liveUrls.has(key)) continue;
  const { images, description, paint, image_url, ...keep } = l;
  departed.push({ ...keep, departed_at: nowIso });
}
let archive = [];
try { archive = JSON.parse(fs.readFileSync(HIST, "utf8")).listings || []; } catch { /* first run */ }
const archived = [...departed, ...archive].slice(0, MAX_HISTORY);
fs.mkdirSync(path.dirname(HIST), { recursive: true });
fs.writeFileSync(HIST, JSON.stringify({ updated: nowIso, listings: archived }, null, 2) + "\n");
const moved = deduped.filter((l) => (l.price_history || []).length > 1).length;
console.log(`History: ${moved} listings with a price change, ${departed.length} newly departed, ${archived.length} archived`);
const recency = (l) => Date.parse(l.listed_at || l.first_seen) || 0;
const listings = deduped.sort((a, b) => recency(b) - recency(a)).slice(0, MAX_LISTINGS);

// Never overwrite a good file with nothing — if every source failed, keep the
// last-known-good listings.json and fail the run so it's visible.
if (listings.length === 0) {
  console.error("No listings from any source; leaving existing file untouched.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify({ updated: new Date().toISOString(), listings }, null, 2) + "\n",
);
console.log(`Wrote ${listings.length} listings to ${OUT}`);
