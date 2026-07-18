/** probe round 3 — dump exact card/JSON-LD structure for the 4 open dealers. */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const dump = (tag, s) => console.log(`\n----- ${tag} -----\n` + s.replace(/\s+/g, " ").slice(0, 1600));

async function get(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } });
  console.log(`\n=== [${r.status}] ${url}`);
  return r.text();
}

// Japanese Classics — WooCommerce loop
{
  const html = await get("https://www.japaneseclassics.com/inventory/");
  const i = html.search(/class="[^"]*product[^"]*type-product/);
  dump("JC first product block", i >= 0 ? html.slice(i, i + 2600) : "NOT FOUND; li.product idx=" + html.indexOf("li class=\"product"));
  const links = [...html.matchAll(/href="(https:\/\/www\.japaneseclassics\.com\/inventory\/[^"\/]+\/)"/g)].map(m => m[1]);
  console.log("JC car links:", new Set(links).size);
}

// JDM Sport Classics — inventory list
{
  const html = await get("https://jdmsportclassics.com/inventory/?view_type=list");
  const i = html.indexOf("/inventory/1");
  dump("JSC around first car link", i >= 0 ? html.slice(Math.max(0, i - 1200), i + 1400) : "no /inventory/1 link");
  const links = [...html.matchAll(/href="(https?:\/\/(?:www\.)?jdmsportclassics\.com\/inventory\/[^"\/]+\/)"/g)].map(m => m[1]);
  console.log("JSC car links:", new Set(links).size);
}

// Montu — inventory feed
{
  const html = await get("https://montumotors.com/inventory-feed/?type=Current");
  console.log("bytes:", html.length);
  const i = html.indexOf("/inventory/");
  dump("Montu around first card", i >= 0 ? html.slice(Math.max(0, i - 1200), i + 1600) : "no card");
  const links = [...html.matchAll(/href="(?:https?:\/\/(?:www\.)?montumotors\.com)?(\/inventory\/[^"\/]+\/)"/g)].map(m => m[1]);
  console.log("Montu car links:", new Set(links).size);
}

// JDMBuySell — JSON-LD + card structure
{
  const html = await get("https://www.jdmbuysell.com/for-sale/");
  const lds = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]);
  console.log("ld+json blocks:", lds.length);
  for (const ld of lds.slice(0, 2)) dump("JBS ld+json", ld);
  const i = html.indexOf("/ad/");
  dump("JBS around first /ad/ card", i >= 0 ? html.slice(Math.max(0, i - 400), i + 2000) : "no ad link");
  const usHits = (html.match(/United States|, USA|\bUSA\b/g) || []).length;
  console.log("US mentions:", usHits);
}

console.log("\nProbe3 complete.");
