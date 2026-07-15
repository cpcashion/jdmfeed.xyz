/**
 * scripts/fetch-listings.mjs
 *
 * Finds real, current JDM listings for sale in the US using the Claude API's
 * server-side web search tool, then merges them into public/listings.json —
 * the static data file the app fetches at runtime. Runs on a schedule via
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
const MAX_SEARCHES = 8;
const MAX_AGE_DAYS = 14;
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

const prompt = `Search the web for JDM (Japanese domestic market) enthusiast cars currently for sale in the United States right now. Cover a mix of sources: Bring a Trailer, Cars & Bids, Hemmings, classic.com, AutoTrader classics, Duncan Imports, Toprank Importers, JDM Sport Classics, Garage Defined, JDM Buy & Sell. Find 10-12 real, currently-active listings across a spread of models and price points (Skyline GT-R, Supra, RX-7, NSX, Silvia, Type R Hondas, Lancer Evolution, Impreza STI, Land Cruiser, Delica, Pajero Evolution, kei cars like the AZ-1/Beat/Cappuccino).

Skip these already-known listings: ${excludeTitles.join("; ") || "none"}.

Respond with ONLY a raw JSON array — no markdown fences, no prose. Each element:
{"title":"1995 Nissan Skyline GT-R","year":1995,"make":"Nissan","model":"Skyline GT-R","chassis":"BCNR33","trim":"V-Spec","price":74000,"mileage":52000,"transmission":"5-speed manual","engine":"2.6L RB26DETT","drivetrain":"AWD","location":"Austin, TX","source":"Bring a Trailer","source_url":"https://...","image_url":"https://...","description":"one sentence","paint":"Midnight Purple"}

Rules:
- price = number in USD (current bid if auction, 0 if unknown)
- source_url must be a real listing URL taken from your search results — never invent one
- image_url = a direct URL to the single best, highest-resolution photo of the car from that listing (the lead/gallery hero image or og:image). It must end in an image file or be a CDN image URL. If you cannot find a real image URL, use ""
- If you cannot verify a listing is real and current, leave it out.`;

const client = new Anthropic();

const response = await client.messages.create({
  model: MODEL,
  max_tokens: 8000,
  thinking: { type: "adaptive" },
  messages: [{ role: "user", content: prompt }],
  tools: [{ type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES }],
});

const text = response.content
  .filter((b) => b.type === "text")
  .map((b) => b.text)
  .join("\n");

const start = text.indexOf("[");
const end = text.lastIndexOf("]");
if (start === -1 || end <= start) {
  console.error("No JSON array found in model output. Raw text:\n" + text.slice(0, 2000));
  process.exit(1);
}

let items;
try {
  items = JSON.parse(text.slice(start, end + 1));
} catch (err) {
  console.error("Failed to parse listings JSON: " + err.message);
  process.exit(1);
}

const now = new Date().toISOString();
const fresh = (Array.isArray(items) ? items : [])
  .filter((it) => it && it.title && it.source_url)
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
