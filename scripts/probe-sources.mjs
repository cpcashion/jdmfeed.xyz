/** probe round 2 — Woo Store APIs, C&B params, site discovery. */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const targets = [
  ["JC woo store", "https://www.japaneseclassics.com/wp-json/wc/store/v1/products?per_page=100", "json"],
  ["JC inventory page", "https://www.japaneseclassics.com/inventory/", "html"],
  ["JSC woo store", "https://www.jdmsportclassics.com/wp-json/wc/store/v1/products?per_page=100", "json"],
  ["JSC root", "https://www.jdmsportclassics.com/", "html"],
  ["Montu root", "https://www.montumotors.com/", "html"],
  ["Montu vehicles", "https://www.montumotors.com/vehicles", "html"],
  ["PCJDM products nolimit", "https://pacificcoastjdm.com/products.json", "json"],
  ["PCJDM root", "https://pacificcoastjdm.com/", "html"],
  ["CB auctions noparam", "https://carsandbids.com/v2/autos/auctions", "json"],
  ["CB auctions page", "https://carsandbids.com/v2/autos/auctions?page=1&per_page=25", "json"],
  ["JDMBuySell root", "https://www.jdmbuysell.com/", "html"],
  ["JDMBuySell listings", "https://www.jdmbuysell.com/listings/", "html"],
  ["Duncan sitemap", "https://www.duncanimports.com/sitemap.xml", "html"],
  ["Toprank products.json", "https://importavehicle.com/products.json?limit=250", "json"],
];

async function probe(name, url, kind) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: kind === "json" ? "application/json,*/*" : "text/html,*/*", "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
    });
    const body = await res.text();
    console.log(`\n=== ${name} [${res.status}] ${url}`);
    console.log(`    content-type: ${res.headers.get("content-type")}  bytes: ${body.length}`);
    try {
      const j = JSON.parse(body);
      if (Array.isArray(j)) {
        console.log(`    JSON ARRAY — ${j.length} entries; first keys: ${Object.keys(j[0] || {}).slice(0, 14).join(",")}`);
        if (j[0]?.name) console.log(`    names: ${j.slice(0, 4).map((p) => String(p.name).slice(0, 44)).join(" | ")}`);
        if (j[0]?.prices) console.log(`    price sample: ${JSON.stringify(j[0].prices).slice(0, 120)}`);
        if (j[0]?.images) console.log(`    images[0] count: ${j[0].images.length}`);
      } else {
        const arr = j.products || j.auctions || j.items || j.listings || j.data;
        if (Array.isArray(arr)) {
          console.log(`    JSON OK — ${arr.length}; keys: ${Object.keys(arr[0] || {}).slice(0, 14).join(",")}`);
          if (arr[0]?.title) console.log(`    titles: ${arr.slice(0, 4).map((p) => String(p.title).slice(0, 40)).join(" | ")}`);
        } else {
          console.log(`    JSON keys: ${Object.keys(j).slice(0, 14).join(",")} — body: ${body.slice(0, 220)}`);
        }
      }
    } catch {
      // html analysis
      for (const re of [
        /wc\/store/i, /woocommerce/i, /product(?:_|-)type/i, /"@type"\s*:\s*"(?:Product|Vehicle|Car)"/,
        /inventory|vehicle/i, /\$[0-9]{2},[0-9]{3}/, /algolia|awsWaf|cf-chl|challenge/i,
      ]) {
        const m = body.match(re);
        if (m) console.log(`    hint: ${re} @${m.index} → "${body.slice(m.index, Math.min(m.index + 70, body.length)).replace(/\s+/g, " ")}"`);
      }
      const links = new Set([...body.matchAll(/href="([^"]{5,120})"/gi)].map((m) => m[1]).filter((h) => /vehicle|inventory|listing|for-sale|stock|product/i.test(h)));
      console.log(`    nav links: ${[...links].slice(0, 8).join(" , ")}`);
      console.log("    snippet:", body.slice(0, 220).replace(/\s+/g, " "));
    }
  } catch (err) {
    console.log(`\n=== ${name} ERROR ${url}\n    ${err.message}`);
  }
}

for (const [name, url, kind] of targets) await probe(name, url, kind);
console.log("\nProbe2 complete.");
