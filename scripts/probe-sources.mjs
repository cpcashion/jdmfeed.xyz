/** probe round 10 — verify the deep-pagination JBS crawl end to end. */
import { fetchJdmBuySell } from "./sources/dealers.mjs";
import { resolveChassis } from "./sources/jdm.mjs";

const rows = await fetchJdmBuySell();
const by = {};
for (const l of rows) { const c = l.chassis || "(none)"; by[c] = (by[c] || 0) + 1; }
console.log(`\nTOTAL US listings: ${rows.length}`);
console.log(`  priced: ${rows.filter((l) => l.price > 0).length} | with image: ${rows.filter((l) => l.image_url).length} | dated: ${rows.filter((l) => l.listed_at).length}`);
console.log("  top chassis: " + Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k, v]) => `${k}:${v}`).join(" "));
const dc2 = rows.filter((l) => l.chassis === "DC2");
console.log(`\n  DC2 Integra Type Rs found: ${dc2.length}  (site's facet page lists 9 US of 11 total)`);
for (const l of dc2) console.log(`    ${l.year} ${l.title.slice(0, 40).padEnd(40)} $${String(l.price).padStart(7)} ${l.location}`);
const civics = rows.filter((l) => /civic/i.test(l.model + l.title));
console.log(`\n  Civics: ${civics.length}`);
for (const l of civics.slice(0, 8)) console.log(`    ${l.year} ${l.title.slice(0, 40).padEnd(40)} $${String(l.price).padStart(7)} ${l.chassis || "-"}`);
console.log("\nProbe10 complete.");
