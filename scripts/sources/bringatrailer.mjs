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

import { UA, decode, isJDM, parseTitle, specsFromText } from "./jdm.mjs";

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
  return out;
}
