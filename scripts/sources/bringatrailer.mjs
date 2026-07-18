/**
 * BaT source — Bring a Trailer live auctions.
 *
 * BaT server-renders its /auctions/ page with an embedded
 * `var auctionsCurrentInitialData = {"items":[...]}` blob containing ONLY
 * currently-active auctions (each item has active:true, a current_bid, a
 * thumbnail photo, and a timestamp_end). We parse that, keep the Japanese /
 * JDM cars located in the US, and map them to the app's listing shape.
 *
 * Because we only ever read the *current* auctions blob, sold/ended cars can
 * never appear — which is exactly the "for sale, not sold" requirement.
 */

import fs from "node:fs";
import { UA, decode, isJDM, parseTitle, specsFromText } from "./jdm.mjs";

/* ---- per-auction photo galleries ----

   The auctions blob only carries one thumbnail, but each listing page
   embeds its full gallery as bringatrailer.com/wp-content/uploads URLs
   (each photo in several -WxH size variants). Pull the page, dedupe
   variants down to one URL per photo (preferring ~1200px wide), and cap
   at 14 for the detail sheet's slider. Galleries from the previous run
   are reused, so steady-state refreshes only fetch pages for NEW cars. */

const VARIANT = /-(\d+)x(\d+)(?=\.\w+$)/;

async function fetchGallery(pageUrl) {
  const res = await fetch(pageUrl, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } });
  if (!res.ok) throw new Error(`gallery HTTP ${res.status}`);
  // Embedded JSON escapes slashes — normalize before matching.
  const html = (await res.text()).replace(/\\\//g, "/");
  const byBase = new Map(); // photo base -> { url, w }
  const re = /https:\/\/bringatrailer\.com\/wp-content\/uploads\/\d{4}\/\d{2}\/[^\s"'<>\\]+?\.(?:jpe?g|png|webp)/gi;
  for (const m of html.matchAll(re)) {
    const url = m[0];
    const base = url.replace(VARIANT, "").replace(/-scaled(?=\.\w+$)/, "");
    const w = Number(url.match(VARIANT)?.[1]) || 9999; // un-suffixed = original (huge)
    const cur = byBase.get(base);
    // Prefer the variant closest to ~1200px wide — sharp but not 8MB.
    if (!cur || Math.abs(w - 1200) < Math.abs(cur.w - 1200)) byBase.set(base, { url, w });
  }
  return [...byBase.values()].map((v) => v.url).slice(0, 14);
}

async function addGalleries(listings) {
  const prev = new Map();
  try {
    const old = JSON.parse(fs.readFileSync("app/public/listings.json", "utf8"));
    for (const l of old.listings || []) {
      if (l.source === "Bring a Trailer" && Array.isArray(l.images) && l.images.length > 1) prev.set(l.source_url, l.images);
    }
  } catch { /* first run */ }

  let fetched = 0, cached = 0, failed = 0;
  const todo = [];
  for (const l of listings) {
    const c = prev.get(l.source_url);
    if (c) { l.images = c; cached++; } else todo.push(l);
  }
  // Small pool: ~50 pages on a fresh cache, a handful on normal runs.
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (todo.length) {
      const l = todo.shift();
      try {
        const imgs = await fetchGallery(l.source_url);
        l.images = imgs.length > 1 ? imgs : [l.image_url].filter(Boolean);
        fetched++;
      } catch {
        l.images = [l.image_url].filter(Boolean);
        failed++;
      }
    }
  }));
  console.log(`  BaT galleries: ${fetched} fetched, ${cached} cached, ${failed} failed`);
}

/** Pull the balanced {...} that follows `auctionsCurrentInitialData =`. */
function extractInitialData(html) {
  const marker = "auctionsCurrentInitialData";
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const braceStart = html.indexOf("{", at);
  if (braceStart === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = braceStart; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(braceStart, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export async function fetchBringATrailer() {
  const res = await fetch("https://bringatrailer.com/auctions/", {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`BaT auctions HTTP ${res.status}`);
  const html = await res.text();
  const data = extractInitialData(html);
  const items = data?.items;
  if (!Array.isArray(items)) throw new Error("BaT: could not parse auctionsCurrentInitialData.items");

  const now = new Date().toISOString();
  const out = [];
  for (const it of items) {
    if (!it || it.active !== true || !it.title || !it.url) continue;
    if ((it.country_code || "US") !== "US") continue; // for sale in the US
    if (!isJDM(it.title)) continue;
    const { year, make, model } = parseTitle(it.title);
    // Mileage/gearbox/engine/color live in BaT's prose — mine them out.
    const specs = specsFromText(`${decode(it.title)}. ${decode(it.excerpt)}`);
    out.push({
      title: decode(it.title),
      year,
      make,
      model,
      chassis: "",
      trim: "",
      price: Number(it.current_bid) || 0,
      mileage: specs.mileage || 0,
      transmission: specs.transmission || "",
      engine: specs.engine || "",
      drivetrain: specs.drivetrain || "",
      color: specs.color || "",
      location: it.country || "United States",
      source: "Bring a Trailer",
      source_url: it.url,
      image_url: typeof it.thumbnail_url === "string" ? it.thumbnail_url : "",
      description: decode(it.excerpt),
      paint: "",
      ends_at: it.timestamp_end ? new Date(it.timestamp_end * 1000).toISOString() : "",
      live: true,
      scraped_date: now,
    });
  }
  await addGalleries(out);
  return out;
}
