/**
 * Shared JDM vocabulary + title parsing used by every listing source.
 *
 * A car qualifies as JDM only if it has BOTH a Japanese make AND a model or
 * chassis code from the JDM canon — this drops US-market trucks (Tacoma),
 * non-Japanese false positives ("Continental Mark II"), and, together with
 * the moto filter, motorcycles.
 */

export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export const JAPANESE_MAKE =
  /\b(Nissan|Toyota|Mazda|Honda|Mitsubishi|Subaru|Suzuki|Daihatsu|Isuzu|Autozam|Eunos|Datsun|Infiniti|Lexus|Acura)\b/i;

export const JDM_CANON =
  /\b(GT-?R|Skyline|Silvia|180SX|200SX|240SX|300ZX|350Z|370Z|Fairlady|Z32|Z33|Pulsar|Figaro|Pao|Stagea|Cedric|Gloria|Laurel|Cima|President|Supra|MR2|MR-?S|Celica|AE86|Trueno|Levin|Chaser|Cresta|Mark ?II|Soarer|Aristo|Century|Crown|Land ?Cruiser|Starlet|Sera|2000GT|240Z|260Z|280Z|Fairlady|510|Roadster|RX-?7|RX-?8|RX-?3|RX-?2|Cosmo|Savanna|Miata|MX-?5|NSX|S2000|S600|S800|Civic|Integra|Prelude|CRX|Beat|Del ?Sol|Acty|3000GT|GTO|Lancer|Evolution|Evo|Starion|Pajero|Montero|Delica|FTO|Galant|Impreza|WRX|STI|Legacy|BRZ|SVX|Sambar|Cappuccino|Jimny|Samurai|Cara|Copen|Charade|Hijet|AZ-?1|Piazza|VehiCROSS|Bellett|Hakosuka|Kenmeri|FD3S|FC3S|JZA80|JZA70|JZX9\d|JZX1\d\d|S13|S14|S15|R3[234]|BNR32|BCNR33|BNR34|EK9|EG6|DC[25]|GC8|GD[AB]|GRB|CT9A|C[PEN]9A|SW20|ZN6)\b/i;

// Motorcycles / scooters / ATVs — keep them out of a car feed.
export const MOTO =
  /\b(CB\d|CBR|GSX|GSX-?R|Ninja|YZF|MT-?\d|Katana|Hayabusa|Grom|TS\d|DR\d|DRZ|KLR|KLX|KX\d|RM\d|RMZ|XR\d|XL\d|CRF|XT\d|DT\d|SR400|SR500|W650|W800|Vespa|scooter|motorcycle|mini-?bike|moped|ATV|dirt-?bike|Cub)\b/i;

export const MAKES = [
  "Nissan", "Toyota", "Mazda", "Honda", "Mitsubishi", "Subaru", "Suzuki",
  "Daihatsu", "Isuzu", "Autozam", "Eunos", "Datsun", "Infiniti", "Lexus", "Acura",
];

export const decode = (s) =>
  String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "’").replace(/&#8211;|&ndash;/g, "–")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

export const isJDM = (title) =>
  JAPANESE_MAKE.test(title) && JDM_CANON.test(title) && !MOTO.test(title);

export function parseTitle(title) {
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

/* ---- spec extraction from listing prose (titles, excerpts) ---- */

export function specsFromText(text) {
  const t = String(text || "");
  const out = {};

  // "41k-Mile", "34,000 miles", "shows 90k miles"
  const mi = t.match(/(\d{1,3}(?:,\d{3})+|\d{1,3}k|\d{3,6})[- ]?miles?\b/i);
  if (mi) {
    const raw = mi[1].toLowerCase();
    out.mileage = raw.endsWith("k") ? parseInt(raw, 10) * 1000 : parseInt(raw.replace(/,/g, ""), 10);
  }

  if (/\bautomatic\b|\bauto\b(?!crosser)/i.test(t)) out.transmission = "Automatic";
  else {
    const sp = t.match(/(\d)-speed/i);
    if (sp) out.transmission = `${sp[1]}-speed manual`;
    else if (/\bmanual\b/i.test(t)) out.transmission = "Manual";
  }

  // "powered by a 2.8-liter L28 inline-six linked to..."
  // Dots are allowed inside ("2.8-liter") — the phrase ends at a comma, a
  // sentence break, or a joining verb.
  const eng = t.match(/(?:powered by|equipped with) (?:an? )?(.{6,60}?)(?=,| (?:linked|paired|mated|backed|and)\b|\.(?:\s|$))/i);
  if (eng) out.engine = eng[1].trim();

  if (/\b(4wd|4x4|four-wheel)/i.test(t)) out.drivetrain = "4WD";
  else if (/\b(awd|all-wheel)/i.test(t)) out.drivetrain = "AWD";
  else if (/\b(rwd|rear-wheel)/i.test(t)) out.drivetrain = "RWD";
  else if (/\b(fwd|front-wheel)/i.test(t)) out.drivetrain = "FWD";

  // BaT convention: "Finished in Midnight Purple over black upholstery"
  const col = t.match(/finished in ([A-Za-z0-9 \-]{3,32}?) (?:over|with|and)\b/i);
  if (col) out.color = col[1].trim();

  return out;
}
