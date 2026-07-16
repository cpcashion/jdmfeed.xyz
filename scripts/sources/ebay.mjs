/**
 * eBay Motors source — live vehicle listings via the eBay Browse API.
 *
 * Auth is the OAuth2 client-credentials flow: the app's Client ID (public)
 * plus its Cert ID (secret, from the EBAY_CERT_ID repo secret) mint a
 * short-lived application token, which then queries
 * /buy/browse/v1/item_summary/search restricted to the Cars & Trucks
 * category (6001) and US item location.
 *
 * The Browse API only returns ACTIVE listings — ended/sold items never
 * appear — which is exactly the "for sale, not sold" requirement. We sweep
 * one search per JDM nameplate below, post-filter every title through the
 * shared JDM canon, and map to the app's listing shape.
 */

import { decode, isJDM, parseTitle } from "./jdm.mjs";

const CLIENT_ID = process.env.EBAY_CLIENT_ID || "ChrisCas-JDMFeed-PRD-662558e1b-d9772e1c";
const CERT_ID = process.env.EBAY_CERT_ID || "";

const TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const SEARCH_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const CARS_AND_TRUCKS = "6001";

// One Browse search per nameplate. ~40 calls per refresh × 4 runs/day is
// far inside the 5,000/day default quota.
const QUERIES = [
  "Nissan Skyline", "Nissan GT-R", "Nissan Silvia", "Nissan 240SX", "Nissan 300ZX",
  "Nissan 350Z", "Datsun 240Z", "Datsun 280Z", "Nissan Figaro", "Nissan Pao",
  "Toyota Supra", "Toyota AE86", "Toyota MR2", "Toyota Celica", "Toyota Chaser",
  "Toyota Soarer", "Toyota Land Cruiser", "Toyota Century", "Toyota Starlet",
  "Mazda RX-7", "Mazda RX-8", "Mazda Cosmo", "Mazda Miata",
  "Honda NSX", "Acura NSX", "Honda S2000", "Honda Civic Type R", "Acura Integra",
  "Honda Prelude", "Honda CRX", "Honda Beat",
  "Mitsubishi Lancer Evolution", "Mitsubishi 3000GT", "Mitsubishi Pajero", "Mitsubishi Delica",
  "Subaru WRX STI", "Subaru SVX",
  "Suzuki Cappuccino", "Autozam AZ-1", "Suzuki Jimny", "Daihatsu Hijet",
];

async function getAppToken() {
  if (!CERT_ID) throw new Error("EBAY_CERT_ID secret is not set — add the keyset's Cert ID as a GitHub repo secret");
  const basic = Buffer.from(`${CLIENT_ID}:${CERT_ID}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`eBay token HTTP ${res.status}: ${body.slice(0, 300)}`);
  const token = JSON.parse(body).access_token;
  if (!token) throw new Error("eBay token response had no access_token");
  return token;
}

// eBay thumbnails come as .../s-l225.jpg — the same asset serves 1600px.
const hiRes = (url) => String(url || "").replace(/s-l\d+\./, "s-l1600.");

async function search(token, q) {
  const params = new URLSearchParams({
    q,
    category_ids: CARS_AND_TRUCKS,
    limit: "200",
    filter: "itemLocationCountry:US,price:[1500..500000],priceCurrency:USD",
  });
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`eBay search "${q}" HTTP ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body).itemSummaries || [];
}

export async function fetchEbayMotors() {
  const token = await getAppToken();
  const now = new Date().toISOString();
  const byId = new Map(); // nameplate sweeps overlap — dedupe by itemId
  let apiErrors = 0;

  for (const q of QUERIES) {
    let items;
    try {
      items = await search(token, q);
    } catch (err) {
      // Surface the first hard failure (usually auth/compliance) instead of
      // silently returning an empty feed slice.
      if (byId.size === 0 && ++apiErrors >= 3) throw err;
      console.error(`  eBay query skipped: ${err.message}`);
      continue;
    }
    for (const it of items) {
      if (!it?.itemId || byId.has(it.itemId)) continue;
      const title = decode(it.title);
      if (!isJDM(title)) continue;
      const { year, make, model } = parseTitle(title);
      if (!year || !make) continue; // no year+make in a vehicle title → junk row
      const price = Number(it.price?.value ?? it.currentBidPrice?.value) || 0;
      const loc = [it.itemLocation?.city, it.itemLocation?.stateOrProvince].filter(Boolean).join(", ");
      byId.set(it.itemId, {
        title,
        year,
        make,
        model,
        chassis: "",
        trim: "",
        price,
        mileage: 0,
        transmission: "",
        engine: "",
        drivetrain: "",
        location: loc || "United States",
        source: "eBay Motors",
        source_url: it.itemWebUrl || "",
        image_url: hiRes(it.image?.imageUrl),
        description: "",
        paint: "",
        ends_at: it.itemEndDate || "",
        live: true,
        scraped_date: now,
      });
    }
  }
  return [...byId.values()];
}
