/**
 * scripts/probe-sources.mjs — verify the BaT source parser against live data.
 * Throwaway; removed once the fetcher is wired into the refresh job.
 */
import { fetchBringATrailer } from "./sources/bringatrailer.mjs";

const listings = await fetchBringATrailer();
console.log(`BaT JDM active listings: ${listings.length}`);
const withImg = listings.filter((l) => l.image_url).length;
const withPrice = listings.filter((l) => l.price > 0).length;
console.log(`  with photo: ${withImg}/${listings.length}   with price: ${withPrice}/${listings.length}`);
console.log("\nSample (first 8):");
for (const l of listings.slice(0, 8)) {
  console.log(`- ${l.year || "----"} ${l.make} ${l.model} — $${l.price || "no bid yet"}`);
  console.log(`    ${l.title}`);
  console.log(`    img: ${l.image_url ? l.image_url.slice(0, 80) : "(none)"}`);
  console.log(`    url: ${l.source_url}`);
  console.log(`    ends: ${l.ends_at}`);
}
console.log("\nProbe complete.");
