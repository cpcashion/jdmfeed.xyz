/**
 * RHD dealer + JDM classifieds adapters.
 *
 * Every source here deals exclusively (or near-exclusively) in RHD JDM
 * imports, so listings are tagged rhd:true by construction. Each adapter
 * is defensive: any failure logs and returns [] so one broken dealer
 * never hurts the rest of the feed.
 *
 *  - jdmbuysell.com — JDM marketplace (~6k listings worldwide, server-
 *    rendered cards, paginated /for-sale/?page=N). We keep US-located ads.
 *  - montumotors.com — /inventory-feed/?type=Current card grid.
 *  - jdmsportclassics.com — WP "Motors" theme /inventory/ list; car slugs
 *    carry year-make-model.
 */

import { UA, decode, isJDM, parseTitle, specsFromText } from "./jdm.mjs";

const now = () => new Date().toISOString();

async function getHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

/* "1996-toyota-celica-gt-four-3" → "1996 Toyota Celica Gt Four" */
const titleFromSlug = (slug) =>
  decode(slug)
    .replace(/-\d+$/, "") // trailing de-dupe counter
    .split("-")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

const firstPrice = (s) => {
  const m = String(s).match(/\$\s?([\d,]{4,})/);
  return m ? Number(m[1].replace(/,/g, "")) : 0;
};

const firstImage = (s, base = "") => {
  const m = String(s).match(/(?:src|data-src)="([^"]+\.(?:jpe?g|png|webp)[^"]*)"/i) ||
    String(s).match(/background-image:\s*url\(([^)]+\.(?:jpe?g|png|webp))\)/i) ||
    String(s).match(/(?:src|data-src)="([^"]*\/cdn-cgi\/imagedelivery\/[^"]+)"/i);
  if (!m) return "";
  let u = m[1].replace(/&amp;/g, "&");
  if (u.startsWith("/")) u = base + u;
  return u;
};

const baseListing = (over) => ({
  chassis: "", trim: "", mileage: 0, transmission: "", engine: "", drivetrain: "",
  color: "", description: "", paint: "", ends_at: "", live: true, rhd: true,
  scraped_date: now(), ...over,
});

/* ---- jdmbuysell.com ---- */

export async function fetchJdmBuySell() {
  const out = [];
  try {
    for (let page = 1; page <= 8; page++) {
      const html = (await getHtml(`https://www.jdmbuysell.com/for-sale/${page > 1 ? `?page=${page}` : ""}`))
        .replace(/\\\//g, "/");
      // Split the page into per-ad segments anchored on the /ad/<slug>/ links.
      const parts = html.split(/href="(?:https:\/\/www\.jdmbuysell\.com)?\/ad\//).slice(1);
      let added = 0;
      for (const part of parts) {
        const slug = part.match(/^([a-z0-9-]+)\//)?.[1];
        if (!slug) continue;
        const seg = part.slice(0, 2600); // the card's own markup
        // Marketplace is worldwide — keep ads that state a US location.
        if (!/United States|,\s*USA\b|\bUSA\b/.test(seg)) continue;
        const title = titleFromSlug(slug.replace(/^[a-z0-9]+?-(?=(?:19|20)\d\d-)/, "")); // drop seller prefix
        if (!isJDM(title)) continue;
        const { year, make, model } = parseTitle(title);
        if (!year || !make) continue;
        const url = `https://www.jdmbuysell.com/ad/${slug}/`;
        if (out.some((l) => l.source_url === url)) continue;
        const specs = specsFromText(seg.replace(/<[^>]+>/g, " "));
        out.push(baseListing({
          title, year, make, model,
          price: firstPrice(seg),
          mileage: specs.mileage || 0,
          transmission: specs.transmission || "",
          location: "United States",
          source: "JDM Buy & Sell",
          source_url: url,
          image_url: firstImage(seg, "https://www.jdmbuysell.com"),
        }));
        added++;
      }
      if (parts.length === 0 || added === 0 && page > 2) break;
    }
  } catch (err) {
    console.error(`  jdmbuysell failed: ${err.message}`);
  }
  console.log(`  jdmbuysell: ${out.length} US listings`);
  return out;
}

/* ---- montumotors.com ---- */

export async function fetchMontu() {
  const out = [];
  try {
    const html = await getHtml("https://montumotors.com/inventory-feed/?type=Current");
    for (const m of html.matchAll(/<div class="[^"]*ft-item[^"]*">([\s\S]*?)(?=<div class="[^"]*ft-item|$)/g)) {
      const seg = m[1];
      const href = seg.match(/href="(\/inventory\/[^"]+\/)"/)?.[1];
      if (!href) continue;
      const price = firstPrice(seg);
      if (!price) continue; // "Special Order this Model" placeholders have no price
      const rawTitle = decode(seg.match(/<a href="\/inventory\/[^"]+\/">([^<]+)<\/a>/)?.[1] || titleFromSlug(href.split("/")[2] || ""));
      if (!isJDM(rawTitle)) continue;
      const { year, make, model } = parseTitle(rawTitle);
      const url = `https://www.montumotors.com${href}`;
      if (out.some((l) => l.source_url === url)) continue;
      out.push(baseListing({
        title: rawTitle, year: year || 0, make, model: model || rawTitle,
        price,
        location: "Tampa, Florida",
        source: "Montu Motors",
        source_url: url,
        image_url: firstImage(seg, "https://www.montumotors.com"),
      }));
    }
  } catch (err) {
    console.error(`  montu failed: ${err.message}`);
  }
  console.log(`  montu: ${out.length} listings`);
  return out;
}

/* ---- jdmsportclassics.com ---- */

export async function fetchJdmSportClassics() {
  const out = [];
  try {
    const html = await getHtml("https://jdmsportclassics.com/inventory/?view_type=list");
    const parts = html.split(/href="https?:\/\/(?:www\.)?jdmsportclassics\.com\/inventory\//).slice(1);
    for (const part of parts) {
      const slug = part.match(/^([a-z0-9-]+)\//)?.[1];
      if (!slug || !/^(?:19|20)\d\d-/.test(slug)) continue; // car slugs start with the year
      const url = `https://jdmsportclassics.com/inventory/${slug}/`;
      if (out.some((l) => l.source_url === url)) continue;
      const title = titleFromSlug(slug);
      if (!isJDM(title)) continue;
      const { year, make, model } = parseTitle(title);
      if (!year || !make) continue;
      const seg = part.slice(0, 3000);
      out.push(baseListing({
        title, year, make, model,
        price: firstPrice(seg),
        location: "Ontario, California",
        source: "JDM Sport Classics",
        source_url: url,
        image_url: firstImage(seg, "https://jdmsportclassics.com"),
      }));
    }
  } catch (err) {
    console.error(`  jdmsportclassics failed: ${err.message}`);
  }
  console.log(`  jdmsportclassics: ${out.length} listings`);
  return out;
}
