/** probe round 4 — find the PRICE + TITLE markup for the three live dealer adapters.
 *  Round 3 dumped head-comment noise (JBS) and special-order cards (Montu);
 *  every adapter shipped price:0. This round anchors on REAL card links in
 *  the body and prints price-node candidates verbatim. */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const dump = (tag, s) => console.log(`\n----- ${tag} -----\n` + String(s).replace(/\s+/g, " ").slice(0, 2400));

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } });
  console.log(`\n=== [${r.status}] ${url}`);
  return (await r.text()).replace(/\\\//g, "/");
}

// ---- JDMBuySell: real cards live after the <main>/body, not head comments.
{
  const html = await get("https://www.jdmbuysell.com/for-sale/");
  const bodyAt = Math.max(html.indexOf("<body"), 0);
  const body = html.slice(bodyAt);
  const links = [...body.matchAll(/href="(?:https:\/\/www\.jdmbuysell\.com)?\/ad\/([a-z0-9-]+)\//g)];
  console.log("JBS body /ad/ links:", links.length, "unique:", new Set(links.map((m) => m[1])).size);
  for (const m of links.slice(0, 2)) {
    dump(`JBS card window for ${m[1]} (600 before, 1800 after)`, body.slice(Math.max(0, m.index - 600), m.index + 1800));
  }
  // Price-looking strings anywhere in the body — shows the exact format.
  const money = [...body.matchAll(/.{60}[$£€¥][\d,]{3,}.{40}/g)].map((m) => m[0]);
  console.log("JBS money-context samples:", money.length);
  for (const s of money.slice(0, 6)) dump("JBS $", s);
}

// ---- Montu: does ANY feed variant carry real prices?
for (const u of [
  "https://montumotors.com/inventory-feed/?type=Current",
  "https://montumotors.com/inventory-feed/",
  "https://montumotors.com/inventory/",
]) {
  try {
    const html = await get(u);
    const prices = [...html.matchAll(/<div class="price">\s*([^<]{1,60})/g)].map((m) => m[1].trim());
    console.log("Montu price nodes:", prices.length, JSON.stringify([...new Set(prices)].slice(0, 10)));
    const links = [...html.matchAll(/href="(?:https?:\/\/(?:www\.)?montumotors\.com)?(\/inventory\/[^"/]+\/)"/g)].map((m) => m[1]);
    console.log("Montu links:", new Set(links).size);
  } catch (e) { console.log("Montu fetch failed:", e.message); }
}

// ---- JSC: where does the list view put the price?
{
  const html = await get("https://jdmsportclassics.com/inventory/?view_type=list");
  const money = [...html.matchAll(/.{80}\$\s?[\d,]{4,}.{40}/g)].map((m) => m[0]);
  console.log("JSC money-context samples:", money.length);
  for (const s of money.slice(0, 5)) dump("JSC $", s);
  // Full window around the first car slug, wider than round 3.
  const m = html.match(/href="https?:\/\/(?:www\.)?jdmsportclassics\.com\/inventory\/((?:19|20)\d\d-[a-z0-9-]+)\//);
  if (m) dump(`JSC card window for ${m[1]}`, html.slice(Math.max(0, m.index - 2000), m.index + 2400));
}

console.log("\nProbe4 complete.");
