/**
 * scripts/probe-sources.mjs — throwaway reconnaissance.
 *
 * Hits candidate endpoints on each listing source from the GitHub runner and
 * prints status + a response snippet, so we can see real JSON shapes and
 * whether datacenter IPs get blocked (Cloudflare 403 etc.). Not part of the
 * app; removed once the real fetchers are built.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const targets = [
  // Cars & Bids — internal API candidates + HTML
  ["C&B live JSON", "https://carsandbids.com/v2/search/listings?sort=ending_soon", "json"],
  ["C&B listings", "https://carsandbids.com/v2/listings", "json"],
  ["C&B auctions html", "https://carsandbids.com/auctions", "html"],
  // Bring a Trailer — WP REST + auctions html
  ["BaT wp auctions", "https://bringatrailer.com/wp-json/bringatrailer/1.0/data/keyword-data", "json"],
  ["BaT auctions html", "https://bringatrailer.com/auctions/", "html"],
  ["BaT models JDM", "https://bringatrailer.com/nissan/skyline/", "html"],
  // Hemmings
  ["Hemmings JDM html", "https://www.hemmings.com/classifieds/cars-for-sale/nissan/skyline", "html"],
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
    if (kind === "html") {
      // Surface embedded JSON hints (Next data, window vars, og:image, price)
      for (const re of [
        /__NEXT_DATA__/,
        /window\.__[A-Z_]+__\s*=/,
        /application\/(ld\+json|json)/,
        /"currentBid"|"current_bid"|"price"|"sold_price"|"soldPrice"/,
        /og:image/,
        /data-listing|auction-item|listing-card/,
      ]) {
        const m = body.match(re);
        if (m) console.log(`    hint: ${re} @${m.index}`);
      }
    }
    console.log("    snippet:", body.slice(0, 700).replace(/\s+/g, " "));
  } catch (err) {
    console.log(`\n=== ${name} ERROR ${url}`);
    console.log("    " + err.message);
  }
}

for (const [name, url, kind] of targets) {
  await probe(name, url, kind);
}
console.log("\nProbe complete.");
