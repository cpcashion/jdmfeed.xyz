/** probe round 9 — why does PopJDM show 1 DC2 when jdmbuysell lists 11?
 *
 *  Three candidate causes, tested separately so we fix the real one:
 *    H1 those 11 are mostly NOT in the US and our US filter is right
 *    H2 our /for-sale/?page=N walk sees only a sliver of a ~6k marketplace
 *    H3 the card regex misses cards (JBS rows fell 56 → 17, so something
 *       regressed independent of coverage)
 *  Also: is there a facet/sitemap route that enumerates everything? */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "text/html,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" };
const get = async (u) => {
  try { const r = await fetch(u, { headers: H, redirect: "follow" }); return { s: r.status, b: (await r.text()).replace(/\\\//g, "/") }; }
  catch (e) { return { s: 0, b: "", e: e.message }; }
};

// The adapter's own card matcher, verbatim, so we test what ships.
const CARD = /<a[^>]+href="(?:https:\/\/www\.jdmbuysell\.com)?\/ad\/([a-z0-9-]+)\/"[^>]*?aria-label="([^"]*)"/g;
const anyAd = /href="(?:https:\/\/www\.jdmbuysell\.com)?\/ad\/([a-z0-9-]+)\//g;

function analyse(tag, html) {
  const body = html.slice(Math.max(html.indexOf("<body"), 0));
  const cards = [...body.matchAll(CARD)];
  const ads = new Set([...body.matchAll(anyAd)].map((m) => m[1]));
  console.log(`  ${tag}: ${html.length}b | aria-label cards: ${cards.length} | ANY /ad/ links: ${ads.size}`);
  // Where are they? The adapter keeps only "XX, USA" or data-listing-origin US.
  const usStates = [...body.matchAll(/>\s*([A-Z]{2}), USA\s*</g)].map((m) => m[1]);
  const origins = [...body.matchAll(/data-listing-origin="([^"]*)"/g)].map((m) => m[1]);
  const countries = [...body.matchAll(/>\s*([A-Za-z .]+?), (Canada|United Kingdom|Australia|Japan|Germany|Netherlands)\s*</g)].map((m) => m[2]);
  const oc = {}; for (const o of origins) oc[o] = (oc[o] || 0) + 1;
  const cc = {}; for (const c of countries) cc[c] = (cc[c] || 0) + 1;
  console.log(`      "XX, USA" matches: ${usStates.length} ${usStates.length ? JSON.stringify([...new Set(usStates)].slice(0, 8)) : ""}`);
  console.log(`      data-listing-origin: ${JSON.stringify(Object.entries(oc).slice(0, 6))}`);
  console.log(`      non-US country tags: ${JSON.stringify(Object.entries(cc).slice(0, 6))}`);
  if (cards.length) console.log(`      sample labels: ${cards.slice(0, 4).map((m) => m[2]).join(" | ")}`);
  else if (ads.size) console.log(`      first /ad/ slugs (no aria-label matched!): ${[...ads].slice(0, 4).join(", ")}`);
  return { cards: cards.length, ads: ads.size };
}

console.log("########## H1/H3: the DC2 facet page the owner linked ##########");
{
  const r = await get("https://www.jdmbuysell.com/for-sale/honda/integra/dc2/");
  console.log(`  [${r.s}]`);
  analyse("dc2 facet", r.b);
  // What does an actual card's markup look like now?
  const i = r.b.indexOf("/ad/");
  if (i > 0) console.log("\n  --- raw card window ---\n" + r.b.slice(Math.max(0, i - 700), i + 900).replace(/\s+/g, " ").slice(0, 1500));
}

console.log("\n########## H2: how deep does /for-sale/ pagination actually go? ##########");
let cume = new Set();
for (const p of [1, 2, 5, 10, 20, 40]) {
  const url = `https://www.jdmbuysell.com/for-sale/${p > 1 ? `?page=${p}` : ""}`;
  const r = await get(url);
  const body = r.b.slice(Math.max(r.b.indexOf("<body"), 0));
  const ads = new Set([...body.matchAll(anyAd)].map((m) => m[1]));
  const before = cume.size; for (const a of ads) cume.add(a);
  console.log(`  page ${String(p).padEnd(2)}: [${r.s}] ${r.b.length}b  ads=${ads.size}  new=${cume.size - before}  cumulative=${cume.size}`);
  if (ads.size === 0) break;
}

console.log("\n########## facet + sitemap routes that might enumerate everything ##########");
for (const u of [
  "https://www.jdmbuysell.com/sitemap.xml",
  "https://www.jdmbuysell.com/robots.txt",
  "https://www.jdmbuysell.com/for-sale/united-states/",
  "https://www.jdmbuysell.com/for-sale/honda/",
  "https://www.jdmbuysell.com/for-sale/honda/civic/",
]) {
  const r = await get(u);
  const locs = (r.b.match(/<loc>/g) || []).length;
  const ads = new Set([...r.b.matchAll(anyAd)].map((m) => m[1])).size;
  const sitemaps = [...r.b.matchAll(/Sitemap:\s*(\S+)/gi)].map((m) => m[1]);
  console.log(`  [${r.s}] ${String(r.b.length).padStart(7)}b  locs=${locs}  ads=${ads}  ${u.replace("https://www.jdmbuysell.com", "")}`);
  for (const s of sitemaps.slice(0, 5)) console.log(`        declares sitemap: ${s}`);
}
console.log("\nProbe9 complete.");
