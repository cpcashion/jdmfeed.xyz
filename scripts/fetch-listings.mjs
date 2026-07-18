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
const MAX_LISTINGS = 1000;

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

// Newest classifieds first. Recency = the source's own listing-creation
// date when it has one (eBay), else the first time OUR pipeline saw the
// listing (persisted across runs) — which also mixes sources naturally.
const prevSeen = new Map();
try {
  const old = JSON.parse(fs.readFileSync(OUT, "utf8"));
  for (const l of old.listings || []) {
    if (l.source_url && l.first_seen) prevSeen.set(l.source_url.toLowerCase(), l.first_seen);
  }
} catch { /* first run */ }

const nowIso = new Date().toISOString();
for (const l of deduped) {
  l.first_seen = prevSeen.get(l.source_url.toLowerCase()) || l.listed_at || nowIso;
}
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
