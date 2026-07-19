/** probe round 5 — dry-run the dealer adapters and print sample rows. */
import { fetchJdmBuySell, fetchMontu, fetchJdmSportClassics } from "./sources/dealers.mjs";

for (const [name, fn] of [
  ["JDM Buy & Sell", fetchJdmBuySell],
  ["Montu Motors", fetchMontu],
  ["JDM Sport Classics", fetchJdmSportClassics],
]) {
  const rows = await fn();
  const priced = rows.filter((l) => l.price > 0).length;
  const dated = rows.filter((l) => l.listed_at).length;
  const imaged = rows.filter((l) => l.image_url).length;
  console.log(`\n=== ${name}: ${rows.length} rows | ${priced} priced | ${dated} dated | ${imaged} with image`);
  for (const l of rows.slice(0, 6)) {
    console.log(`  $${l.price} | ${l.title} | ${l.location} | ${l.mileage}mi | ${l.transmission || "-"} | ${l.listed_at || "no date"} | img:${l.image_url.slice(0, 60)}`);
  }
}
console.log("\nProbe5 complete.");
