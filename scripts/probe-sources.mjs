/**
 * scripts/probe-sources.mjs — throwaway reconnaissance.
 *
 * RHD-dealer sweep: hits candidate inventory endpoints for US importers
 * whose whole stock is RHD JDM, plus JDM classifieds/auction sites, and
 * prints status + shape hints so we know exactly which adapters to build.
 * Shopify storefronts expose /products.json — one request per dealer.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const targets = [
  // --- RHD importer dealers: Shopify JSON candidates ---
  ["JapaneseClassics shopify", "https://www.japaneseclassics.com/products.json?limit=250", "json"],
  ["JapaneseClassics collections", "https://www.japaneseclassics.com/collections/all/products.json?limit=250", "json"],
  ["Montu shopify", "https://www.montumotors.com/products.json?limit=250", "json"],
  ["PacificCoastJDM shopify", "https://pacificcoastjdm.com/products.json?limit=250", "json"],
  ["JDMSportClassics shopify", "https://www.jdmsportclassics.com/products.json?limit=250", "json"],
  ["BoostAutoImports shopify", "https://www.boostautoimports.com/products.json?limit=250", "json"],
  ["JDMCarMotorcycle shopify", "https://jdmcarandmotorcycle.com/products.json?limit=250", "json"],
  // --- RHD importer dealers: HTML inventory pages ---
  ["Duncan inventory html", "https://www.duncanimports.com/newandusedcars?clearall=1", "html"],
  ["Duncan alt html", "https://www.duncanimports.com/cars-for-sale", "html"],
  ["Toprank inventory html", "https://importavehicle.com/vehicles", "html"],
  ["Toprank alt html", "https://importavehicle.com/collections/all", "html"],
  ["JapaneseClassics html", "https://www.japaneseclassics.com/collections/inventory", "html"],
  // --- JDM classifieds / auctions ---
  ["JDMBuySell html", "https://www.jdmbuysell.com/browse-ads/", "html"],
  ["CarsAndBids v2", "https://carsandbids.com/v2/autos/auctions?limit=50", "json"],
  ["ClassicCars search", "https://classiccars.com/listings/find?query=right%20hand%20drive", "html"],
  ["Hemmings RHD search", "https://www.hemmings.com/classifieds/cars-for-sale?q=right%20hand%20drive", "html"],
];

async function probe(name, url, kind) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: kind === "json" ? "application/json,*/*" : "text/html,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    const body = await res.text();
    console.log(`\n=== ${name} [${res.status}] ${url}`);
    console.log(`    content-type: ${res.headers.get("content-type")}  bytes: ${body.length}`);
    if (kind === "json" || (res.headers.get("content-type") || "").includes("json")) {
      try {
        const j = JSON.parse(body);
        const prods = j.products || j.auctions || j.items || j.listings;
        if (Array.isArray(prods)) {
          console.log(`    JSON OK — ${prods.length} entries; first keys: ${Object.keys(prods[0] || {}).slice(0, 12).join(",")}`);
          if (prods[0]?.title) console.log(`    sample titles: ${prods.slice(0, 4).map((p) => String(p.title).slice(0, 46)).join(" | ")}`);
          if (prods[0]?.images) console.log(`    first images count: ${prods[0].images.length}`);
          if (prods[0]?.variants?.[0]?.price) console.log(`    first price: ${prods[0].variants[0].price}`);
        } else {
          console.log(`    JSON parsed but no obvious array — top keys: ${Object.keys(j).slice(0, 12).join(",")}`);
        }
      } catch {
        console.log("    NOT JSON. snippet:", body.slice(0, 250).replace(/\s+/g, " "));
      }
    } else {
      for (const re of [
        /__NEXT_DATA__/, /window\.__[A-Z_]+__\s*=/, /application\/ld\+json/,
        /"price"|"currentBid"/, /inventory-|vehicle-card|listing-card|srp-|hit-content/,
        /right[- ]hand[- ]drive|RHD/i, /algolia|typesense|meilisearch/i, /shopify/i,
        /wp-json|wp-content/,
      ]) {
        const m = body.match(re);
        if (m) console.log(`    hint: ${re} @${m.index} → "${body.slice(m.index, m.index + 60).replace(/\s+/g, " ")}"`);
      }
      const links = new Set([...body.matchAll(/href="([^"]*(?:vehicle|inventory|listing|cars-for-sale|product)[^"]*)"/gi)].map((m) => m[1]));
      console.log(`    vehicle-ish links: ${links.size}; sample: ${[...links].slice(0, 3).join(" , ")}`);
      console.log("    snippet:", body.slice(0, 300).replace(/\s+/g, " "));
    }
  } catch (err) {
    console.log(`\n=== ${name} ERROR ${url}`);
    console.log("    " + err.message);
  }
}

for (const [name, url, kind] of targets) {
  await probe(name, url, kind);
}
console.log("\nProbe complete.");
