/**
 * scripts/probe-sources.mjs — BaT structure deep-dive (throwaway recon).
 * Fetches Bring a Trailer's auctions page, locates the embedded auction JSON,
 * and prints the discovered field names + one sample item so we can build a
 * precise parser. Removed once the fetcher is built.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const res = await fetch("https://bringatrailer.com/auctions/", {
  headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
});
const html = await res.text();
console.log("status", res.status, "bytes", html.length);

// BaT embeds auction view-models in a <script> as a JS assignment. Find the
// keys that look like the auctions array and dump a sample.
for (const key of ["auctionsCurrent", "auctionsCompleted", "items", "listings", "BAT_VMS", "activeAuctions"]) {
  const idx = html.indexOf(key);
  console.log(`key "${key}": ${idx === -1 ? "not found" : "@" + idx}`);
}

// Grab the <script> chunk that contains "current_bid" and try to isolate a
// JSON object/array around it.
const anchor = html.indexOf('"current_bid"');
console.log("\n'current_bid' @", anchor);
if (anchor !== -1) {
  const ctx = html.slice(anchor - 600, anchor + 400);
  console.log("context around current_bid:\n", ctx.replace(/\s+/g, " "));
}

// Look for the var assignment that holds the data
const varMatch = html.match(/var\s+([A-Za-z_$][\w$]*)\s*=\s*\{"[^]{0,80}/);
if (varMatch) console.log("\nfirst var assignment:", varMatch[0].slice(0, 200));

// Dump all distinct "key": occurrences within 3KB of current_bid to learn the item schema
if (anchor !== -1) {
  const region = html.slice(anchor - 1500, anchor + 1500);
  const keys = [...new Set([...region.matchAll(/"([a-z_]{3,30})":/gi)].map((m) => m[1]))];
  console.log("\nfield names near an auction item:\n", keys.join(", "));
}
console.log("\nProbe complete.");
