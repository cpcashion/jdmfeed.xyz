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

import fs from "node:fs";
import { decode, isJDM, parseTitle, specsFromText } from "./jdm.mjs";

// eBay keyset values never contain whitespace, so strip ALL whitespace and
// invisible characters — phone copy/paste loves to smuggle one into the
// middle of a repo secret, which corrupts Basic auth.
const clean = (s) => String(s || "").replace(/[\s\u00A0\u200B-\u200D\uFEFF]+/g, "");
const CLIENT_ID = clean(process.env.EBAY_CLIENT_ID) || "ChrisCas-JDMFeed-PRD-662558e1b-d9772e1c";
const CERT_ID = clean(process.env.EBAY_CERT_ID);

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
  // Safe diagnostics: identifies a mis-pasted secret without revealing it.
  console.log(
    `  eBay auth: client ${CLIENT_ID.slice(0, 18)}… (len ${CLIENT_ID.length}), ` +
    `cert len ${CERT_ID.length}${CERT_ID.startsWith("PRD-") ? "" : " — does NOT start with PRD-, likely the wrong value"}`,
  );
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
  if (!res.ok) {
    const hint = res.status === 401
      ? " (either the Cert ID doesn't match this App ID, or the keyset is deactivated — a keyset marked 'Non Compliant' for Marketplace Account Deletion is disabled by eBay until compliance/exemption is set)"
      : "";
    throw new Error(`eBay token HTTP ${res.status}: ${body.slice(0, 300)}${hint}`);
  }
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
      const specs = specsFromText(title); // titles often carry "5-Speed" etc.
      byId.set(it.itemId, {
        title,
        year,
        make,
        model,
        chassis: "",
        trim: "",
        price,
        mileage: specs.mileage || 0,
        transmission: specs.transmission || "",
        engine: specs.engine || "",
        drivetrain: specs.drivetrain || "",
        color: specs.color || "",
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

  await enrichAll(token, byId);
  return [...byId.values()];
}

/* ---- item-detail enrichment: real mileage/transmission/engine/color ----

   The search response has no vehicle aspects, so each NEW listing gets one
   GET /buy/browse/v1/item/{id} call. Rows already enriched in the previous
   listings.json are reused, so steady-state runs only pay for the delta. */

const ITEM_URL = "https://api.ebay.com/buy/browse/v1/item/";

async function enrichOne(token, l, itemId) {
  const res = await fetch(ITEM_URL + encodeURIComponent(itemId), {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
  });
  if (!res.ok) throw new Error(`item ${itemId} HTTP ${res.status}`);
  const it = JSON.parse(await res.text());
  const aspects = {};
  for (const a of it.localizedAspects || []) aspects[String(a.name).toLowerCase()] = String(a.value);
  const pick = (...names) => { for (const n of names) if (aspects[n]) return aspects[n]; return ""; };

  const mil = parseInt(pick("mileage", "vehicle mileage").replace(/[^0-9]/g, ""), 10);
  if (mil > 0 && mil < 2e6) l.mileage = mil;
  l.transmission = pick("transmission") || l.transmission;
  l.engine = pick("engine", "engine size", "engine type") || l.engine;
  l.drivetrain = pick("drive type", "drivetrain") || l.drivetrain;
  l.color = pick("exterior color", "color") || l.color;
  const yr = parseInt(pick("model year", "year"), 10);
  if (yr >= 1950 && yr <= 2027) l.year = yr; // seller aspects beat title parsing
  if (!l.description && it.shortDescription) l.description = decode(it.shortDescription);
  // Full photo gallery for the detail sheet's slider.
  const gallery = [it.image?.imageUrl, ...(it.additionalImages || []).map((a) => a?.imageUrl)]
    .filter(Boolean).map(hiRes);
  l.images = [...new Set(gallery)].slice(0, 14);
  l.enriched = true; // don't re-fetch this listing on future runs
}

async function enrichAll(token, byId) {
  // Reuse enrichment from the previous run's listings.json.
  const prev = new Map();
  try {
    const old = JSON.parse(fs.readFileSync("app/public/listings.json", "utf8"));
    for (const l of old.listings || []) {
      if (l.source === "eBay Motors" && l.enriched) prev.set(l.source_url, l);
    }
  } catch { /* first run */ }

  let cached = 0;
  for (const l of byId.values()) {
    const c = prev.get(l.source_url);
    // Rows enriched before the gallery existed lack images — re-fetch those
    // once so the slider gets photos.
    if (!c || !Array.isArray(c.images) || c.images.length === 0) continue;
    l.mileage = c.mileage || l.mileage;
    l.transmission = c.transmission || l.transmission;
    l.engine = c.engine || l.engine;
    l.drivetrain = c.drivetrain || l.drivetrain;
    l.color = c.color || l.color;
    l.description = l.description || c.description || "";
    l.year = c.year || l.year;
    l.images = c.images;
    l.enriched = true;
    cached++;
  }

  const todo = [...byId.entries()].filter(([, l]) => !l.enriched);
  let done = 0, failed = 0;
  // Small worker pool: hundreds of detail calls without hammering the API.
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (todo.length) {
      const [id, l] = todo.shift();
      try { await enrichOne(token, l, id); done++; } catch { failed++; }
    }
  }));
  console.log(`  eBay enrichment: ${done} fetched, ${cached} cached, ${failed} failed`);
}
