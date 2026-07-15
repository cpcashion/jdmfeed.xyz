/**
 * BaT source — Bring a Trailer live auctions.
 *
 * BaT server-renders its /auctions/ page with an embedded
 * `var auctionsCurrentInitialData = {"items":[...]}` blob containing ONLY
 * currently-active auctions (each item has active:true, a current_bid, a
 * thumbnail photo, and a timestamp_end). We parse that, keep the Japanese /
 * JDM cars located in the US, and map them to the app's listing shape.
 *
 * Because we only ever read the *current* auctions blob, sold/ended cars can
 * never appear — which is exactly the "for sale, not sold" requirement.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// A car qualifies as JDM only if it has BOTH a Japanese make AND a model or
// chassis code from the JDM canon — this drops US-market trucks (Tacoma),
// non-Japanese false positives ("Continental Mark II"), and, together with
// the moto filter, motorcycles.
const JAPANESE_MAKE =
  /\b(Nissan|Toyota|Mazda|Honda|Mitsubishi|Subaru|Suzuki|Daihatsu|Isuzu|Autozam|Eunos|Datsun|Infiniti|Lexus|Acura)\b/i;

const JDM_CANON =
  /\b(GT-?R|Skyline|Silvia|180SX|200SX|240SX|300ZX|350Z|370Z|Fairlady|Z32|Z33|Pulsar|Figaro|Pao|Stagea|Cedric|Gloria|Laurel|Cima|President|Supra|MR2|MR-?S|Celica|AE86|Trueno|Levin|Chaser|Cresta|Mark ?II|Soarer|Aristo|Century|Crown|Land ?Cruiser|Starlet|Sera|2000GT|240Z|260Z|280Z|Fairlady|510|Roadster|RX-?7|RX-?8|RX-?3|RX-?2|Cosmo|Savanna|Miata|MX-?5|NSX|S2000|S600|S800|Civic|Integra|Prelude|CRX|Beat|Del ?Sol|Acty|3000GT|GTO|Lancer|Evolution|Evo|Starion|Pajero|Montero|Delica|FTO|Galant|Impreza|WRX|STI|Legacy|BRZ|SVX|Sambar|Cappuccino|Jimny|Samurai|Cara|Copen|Charade|Hijet|AZ-?1|Piazza|VehiCROSS|Bellett|Hakosuka|Kenmeri|FD3S|FC3S|JZA80|JZA70|JZX9\d|JZX1\d\d|S13|S14|S15|R3[234]|BNR32|BCNR33|BNR34|EK9|EG6|DC[25]|GC8|GD[AB]|GRB|CT9A|C[PEN]9A|SW20|ZN6)\b/i;

// Motorcycles / scooters / ATVs — BaT lists many; keep them out of a car feed.
const MOTO =
  /\b(CB\d|CBR|GSX|GSX-?R|Ninja|YZF|MT-?\d|Katana|Hayabusa|Grom|TS\d|DR\d|DRZ|KLR|KLX|KX\d|RM\d|RMZ|XR\d|XL\d|CRF|XT\d|DT\d|SR400|SR500|W650|W800|Vespa|scooter|motorcycle|mini-?bike|moped|ATV|dirt-?bike|Cub)\b/i;

const MAKES = [
  "Nissan", "Toyota", "Mazda", "Honda", "Mitsubishi", "Subaru", "Suzuki",
  "Daihatsu", "Isuzu", "Autozam", "Eunos", "Datsun", "Infiniti", "Lexus", "Acura",
];

const decode = (s) =>
  String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "’").replace(/&#8211;|&ndash;/g, "–")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

const isJDM = (title) =>
  JAPANESE_MAKE.test(title) && JDM_CANON.test(title) && !MOTO.test(title);

function parseTitle(title) {
  const t = decode(title);
  const ym = t.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
  const year = ym ? Number(ym[0]) : null;
  const rest = ym ? t.slice(ym.index + 4).trim() : t;
  let make = "", model = "";
  for (const m of MAKES) {
    if (new RegExp(`\\b${m}\\b`, "i").test(rest)) { make = m; break; }
  }
  if (make) {
    const i = rest.toLowerCase().indexOf(make.toLowerCase());
    model = rest.slice(i + make.length).replace(/^[\s,-]+/, "").split(/\s{2,}|,|\(|–|—/)[0].trim();
  }
  return { year, make, model };
}

/** Pull the balanced {...} that follows `auctionsCurrentInitialData =`. */
function extractInitialData(html) {
  const marker = "auctionsCurrentInitialData";
  const at = html.indexOf(marker);
  if (at === -1) return null;
  const braceStart = html.indexOf("{", at);
  if (braceStart === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = braceStart; i < html.length; i++) {
    const c = html[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(html.slice(braceStart, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export async function fetchBringATrailer() {
  const res = await fetch("https://bringatrailer.com/auctions/", {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`BaT auctions HTTP ${res.status}`);
  const html = await res.text();
  const data = extractInitialData(html);
  const items = data?.items;
  if (!Array.isArray(items)) throw new Error("BaT: could not parse auctionsCurrentInitialData.items");

  const now = new Date().toISOString();
  const out = [];
  for (const it of items) {
    if (!it || it.active !== true || !it.title || !it.url) continue;
    if ((it.country_code || "US") !== "US") continue; // for sale in the US
    if (!isJDM(it.title)) continue;
    const { year, make, model } = parseTitle(it.title);
    out.push({
      title: decode(it.title),
      year,
      make,
      model,
      chassis: "",
      trim: "",
      price: Number(it.current_bid) || 0,
      mileage: 0,
      transmission: "",
      engine: "",
      drivetrain: "",
      location: it.country || "United States",
      source: "Bring a Trailer",
      source_url: it.url,
      image_url: typeof it.thumbnail_url === "string" ? it.thumbnail_url : "",
      description: decode(it.excerpt),
      paint: "",
      ends_at: it.timestamp_end ? new Date(it.timestamp_end * 1000).toISOString() : "",
      live: true,
      scraped_date: now,
    });
  }
  return out;
}
