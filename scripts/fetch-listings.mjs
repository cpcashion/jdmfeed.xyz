/**
 * scripts/fetch-listings.mjs
 *
 * Finds real, current JDM listings for sale in the US using the Claude API's
 * web search tool, then merges them into app/public/listings.json — the
 * static data file the app fetches at runtime. Runs on a schedule via
 * .github/workflows/refresh-listings.yml; each run commits the updated file,
 * which redeploys the site.
 *
 * Env: ANTHROPIC_API_KEY (GitHub repo secret)
 */

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const OUT = path.resolve("app/public/listings.json");
const MODEL = "claude-opus-4-8";
const MAX_SEARCHES = 10;
const MAX_AGE_DAYS = 21;
const MAX_LISTINGS = 80;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY is not set. Add it under GitHub → Settings → Secrets and variables → Actions.",
  );
  process.exit(1);
}

const existing = (() => {
  try {
    const parsed = JSON.parse(fs.readFileSync(OUT, "utf8"));
    return Array.isArray(parsed) ? parsed : parsed.listings || [];
  } catch {
    return [];
  }
})();

const excludeTitles = existing.map((l) => l.title).slice(0, 40);

const prompt = `You are gathering a feed of Japanese domestic market (JDM) cars currently FOR SALE in the United States. Use web search to find real, currently-active listings.

Search these sources (run several targeted searches):
- bringatrailer.com (search "JDM", "Skyline GT-R", "Supra", "RX-7", "NSX", "Land Cruiser", "Evolution")
- carsandbids.com JDM auctions
- hemmings.com Japanese classifieds
- classic.com Japanese listings
- JDM importer inventory pages (Toprank Importers, Duncan Imports, JDM Sport Classics, Garage Defined, Wolfreign Motors)

Aim for 10-14 listings across a spread of models and prices: Skyline GT-R (R32/R33/R34), Supra, RX-7, NSX, Silvia/180SX, Integra/Civic Type R, Lancer Evolution, Impreza WRX STI, Land Cruiser, Delica, Pajero, kei cars (AZ-1, Beat, Cappuccino).

Skip these already-known listings: ${excludeTitles.join("; ") || "none"}.

STRICT RULES:
- source_url MUST be a direct link to an individual car's listing or auction page (e.g. bringatrailer.com/listing/..., carsandbids.com/auctions/..., hemmings.com/classifieds/...) or an importer's specific vehicle page. Do NOT use news articles, blog posts, magazine coverage, or homepage/category URLs.
- Only include a car if you actually saw its listing page in the search results. It is better to return 6 solid, verifiable listings than 14 shaky ones. Never invent a URL, price, or image.
- image_url: the direct URL to the listing's lead photo (og:image or gallery hero) if you can see one in the results; otherwise "".

After your searches, output your FINAL answer as ONLY a raw JSON array — no prose, no markdown fences, nothing before the "[" or after the "]". Each element exactly:
{"title":"1995 Nissan Skyline GT-R","year":1995,"make":"Nissan","model":"Skyline GT-R","chassis":"BCNR33","trim":"V-Spec","price":74000,"mileage":52000,"transmission":"5-speed manual","engine":"2.6L RB26DETT","drivetrain":"AWD","location":"Austin, TX","source":"Bring a Trailer","source_url":"https://...","image_url":"https://...","description":"one factual sentence","paint":"Midnight Purple"}

Unknown numbers → 0. Unknown strings → "".`;

const client = new Anthropic();

/**
 * Pull the JSON array of listings out of the model's text, tolerating any
 * prose the model wraps around it. Scans every "[" as a candidate start,
 * extracts a bracket-balanced span (ignoring brackets inside strings), and
 * returns the first span that parses to an array of listing-shaped objects.
 */
function extractListings(text) {
  for (let s = text.indexOf("["); s !== -1; s = text.indexOf("[", s + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = s; i < text.length; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "[") depth++;
      else if (c === "]" && --depth === 0) {
        try {
          const arr = JSON.parse(text.slice(s, i + 1));
          if (Array.isArray(arr) && arr.some((it) => it && it.title && it.source_url)) {
            return arr;
          }
        } catch { /* not this span — keep scanning */ }
        break;
      }
    }
  }
  return null;
}

const response = await client.messages.create({
  model: MODEL,
  max_tokens: 8000,
  thinking: { type: "adaptive" },
  messages: [{ role: "user", content: prompt }],
  // Basic web search: predictable, no heavy dynamic-filtering code execution.
  tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }],
});

const text = response.content
  .filter((b) => b.type === "text")
  .map((b) => b.text)
  .join("\n");

const items = extractListings(text);
if (!items) {
  console.error("No parseable listings array in model output. Raw text:\n" + text.slice(0, 2500));
  process.exit(1);
}

const isRealListingUrl = (u) =>
  typeof u === "string" && /^https?:\/\//.test(u) && !/\.(pdf)(\?|$)/i.test(u);

const now = new Date().toISOString();
const fresh = items
  .filter((it) => it && it.title && isRealListingUrl(it.source_url))
  .map((it, i) => ({
    id: `live-${Date.now()}-${i}`,
    title: String(it.title),
    year: Number(it.year) || null,
    make: it.make || "",
    model: it.model || "",
    chassis: it.chassis || "",
    trim: it.trim || "",
    price: Number(it.price) || 0,
    mileage: Number(it.mileage) || 0,
    transmission: it.transmission || "",
    engine: it.engine || "",
    drivetrain: it.drivetrain || "",
    location: it.location || "United States",
    source: it.source || "Web",
    source_url: it.source_url,
    image_url: typeof it.image_url === "string" && it.image_url.startsWith("http") ? it.image_url : "",
    description: it.description || "",
    paintName: it.paint || it.paintName || "",
    live: true,
    scraped_date: now,
  }));

// Merge: new listings first, dedupe on source_url then title+price, drop stale, cap.
const seen = new Set();
const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const merged = [...fresh, ...existing].filter((l) => {
  const key = (l.source_url || l.title + l.price).toLowerCase();
  if (seen.has(key)) return false;
  seen.add(key);
  const scraped = Date.parse(l.scraped_date || 0);
  return !Number.isFinite(scraped) || scraped >= cutoff;
}).slice(0, MAX_LISTINGS);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ updated: now, listings: merged }, null, 2) + "\n");

console.log(`Wrote ${merged.length} listings (${fresh.length} fetched this run) to ${OUT}`);
console.log(`Web searches used: ${response.usage?.server_tool_use?.web_search_requests ?? "n/a"}`);
