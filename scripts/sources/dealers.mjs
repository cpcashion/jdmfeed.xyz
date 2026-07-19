/**
 * RHD dealer + JDM classifieds adapters.
 *
 * Every source here deals exclusively (or near-exclusively) in RHD JDM
 * imports, so listings are tagged rhd:true by construction. Each adapter
 * is defensive: any failure logs and returns [] so one broken dealer
 * never hurts the rest of the feed.
 *
 *  - jdmbuysell.com — JDM marketplace (~6k listings worldwide, Astro
 *    server-rendered cards, paginated /for-sale/?page=N). Each card <a>
 *    carries aria-label (clean title), a "FL, USA" location fact, a
 *    <time datetime> listing date, and the price further down the card.
 *    We keep US-located ads only.
 *  - montumotors.com — /inventory-feed/?type=Current card grid. The site
 *    sits behind a WAF that intermittently answers 202 challenges, so
 *    fetches retry before giving up.
 *  - jdmsportclassics.com — WP "Motors" theme /inventory/ list; each row
 *    div carries data-price / data-mileage / data-date attributes and a
 *    clean img alt title.
 */

import { UA, decode, isJDM, parseTitle, specsFromText } from "./jdm.mjs";

const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getHtml(url, { retries = 0 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } });
    // 202 = WAF challenge page, not content — retry after a pause.
    if ((res.status === 202 || res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(4000 * (attempt + 1));
      continue;
    }
    if (!res.ok || res.status === 202) throw new Error(`HTTP ${res.status} ${url}`);
    return res.text();
  }
}

/* "1996-toyota-celica-gt-four-3" → "1996 Toyota Celica Gt Four" */
const titleFromSlug = (slug) =>
  decode(slug)
    .replace(/-\d+$/, "") // trailing de-dupe counter / stock number
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
    for (let page = 1; page <= 12; page++) {
      const html = (await getHtml(`https://www.jdmbuysell.com/for-sale/${page > 1 ? `?page=${page}` : ""}`))
        .replace(/\\\//g, "/");
      // The <head> mentions /ad/ in comments — only body card anchors count.
      const body = html.slice(Math.max(html.indexOf("<body"), 0));
      const cards = [...body.matchAll(
        /<a[^>]+href="(?:https:\/\/www\.jdmbuysell\.com)?\/ad\/([a-z0-9-]+)\/"[^>]*?aria-label="([^"]*)"/g,
      )];
      let added = 0;
      for (let i = 0; i < cards.length; i++) {
        const m = cards[i];
        const slug = m[1];
        // A card runs until the next card's anchor — the inline blur
        // placeholder and flag SVG make each one several KB, so a small
        // fixed window never reaches the price markup.
        const seg = body.slice(m.index, cards[i + 1] ? cards[i + 1].index : m.index + 20000);
        // Marketplace is worldwide — keep ads with a US location fact.
        const usState = seg.match(/>\s*([A-Z]{2}), USA\s*</)?.[1];
        if (!usState && !/data-listing-origin="United States"/.test(seg)) continue;
        const title = decode(m[2]) || titleFromSlug(slug);
        if (!isJDM(title)) continue;
        const { year, make, model } = parseTitle(title);
        if (!year || !make) continue;
        const url = `https://www.jdmbuysell.com/ad/${slug}/`;
        if (out.some((l) => l.source_url === url)) continue;
        const specs = specsFromText(seg.replace(/<[^>]+>/g, " "));
        const listedAt = seg.match(/<time[^>]*\bdatetime="([^"]+)"/)?.[1] || "";
        out.push(baseListing({
          title, year, make, model,
          price: firstPrice(seg),
          mileage: specs.mileage || 0,
          transmission: specs.transmission || "",
          location: usState || "United States",
          source: "JDM Buy & Sell",
          source_url: url,
          image_url: seg.match(/\bdata-fallback-src="(https?:[^"]+)"/)?.[1] || firstImage(seg, "https://www.jdmbuysell.com"),
          ...(Date.parse(listedAt) ? { listed_at: new Date(listedAt).toISOString() } : {}),
        }));
        added++;
      }
      if (cards.length === 0 || (added === 0 && page > 2)) break;
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
    const html = await getHtml("https://montumotors.com/inventory-feed/?type=Current", { retries: 3 });
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
        location: "Tampa, FL",
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
    // Each row: <div class="listing-list-loop … listing_is_active"
    // data-price="25995" data-date="202607170835" data-mileage="109310">
    // … <a href="…/inventory/<slug>/"> … <img alt="1996 Toyota Celica GT-Four">
    for (const block of html.split(/class="listing-list-loop/).slice(1)) {
      const head = block.slice(0, 1500); // the row div's own attributes/classes
      const b = block.slice(0, 6000);
      const slug = b.match(/href="https?:\/\/(?:www\.)?jdmsportclassics\.com\/inventory\/([a-z0-9-]+)\//)?.[1];
      if (!slug || !/^(?:19|20)\d\d-/.test(slug)) continue; // car slugs start with the year
      if (!/listing_is_active/.test(head)) continue; // sold rows lose this class
      const url = `https://jdmsportclassics.com/inventory/${slug}/`;
      if (out.some((l) => l.source_url === url)) continue;
      const title = decode(b.match(/<img[^>]*\balt="([^"]{6,90})"/)?.[1] || "") || titleFromSlug(slug);
      if (!isJDM(title)) continue;
      const { year, make, model } = parseTitle(title);
      if (!year || !make) continue;
      const dateRaw = head.match(/data-date="(\d{12})"/)?.[1];
      const listedAt = dateRaw
        ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}T${dateRaw.slice(8, 10)}:${dateRaw.slice(10, 12)}:00Z`
        : "";
      const manual = head.match(/\b(\d)-manual\b/);
      out.push(baseListing({
        title, year, make, model,
        price: Number(head.match(/data-price="(\d+)"/)?.[1]) || firstPrice(b),
        mileage: Number(head.match(/data-mileage="(\d+)"/)?.[1]) || 0,
        transmission: manual ? `${manual[1]}-Speed Manual` : (/\bautomatic\b/.test(head) ? "Automatic" : ""),
        location: "Ontario, CA",
        source: "JDM Sport Classics",
        source_url: url,
        image_url: firstImage(b, "https://jdmsportclassics.com"),
        ...(listedAt ? { listed_at: listedAt } : {}),
      }));
    }
  } catch (err) {
    console.error(`  jdmsportclassics failed: ${err.message}`);
  }
  console.log(`  jdmsportclassics: ${out.length} listings`);
  return out;
}
