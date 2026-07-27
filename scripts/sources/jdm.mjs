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

/* ---- chassis codes ----

   The chassis code is the JDM world's real unit of identity — enthusiasts
   shop for a BNR34 or an FD3S, not "a Skyline" or "an RX-7". No source
   publishes it as a field, so we resolve it two ways:

     1. The listing title often states it outright ("1999 Nissan Skyline
        GT-R V-Spec BNR34"). Take it verbatim.
     2. Otherwise map (make, model, model-year) → code. Generations are
        year-bounded, which is exactly what separates an S13 from an S15.

   Rows are ordered most-specific-first so "Civic Type R" wins over
   "Civic". A miss returns "" — the app then falls back to the model name
   rather than showing a wrong code, which enthusiasts spot instantly. */

// Codes we accept verbatim when a title spells one out.
const CHASSIS_LITERAL =
  /\b(BNR32|BCNR33|BNR34|ER34|HR34|RPS13|S13|S14|S15|Z31|Z32|Z33|Z34|S30|S130|WC34|FK10|PK10|R35|SA22C|FB3S|FC3S|FD3S|SE3P|JC3S|NA6CE|NA8C|NB6C|NB8C|NA1|NA2|NC1|AP1|AP2|EK9|EP3|FD2|FK8|FL5|EG6|EK4|EF9|DA6|DB8|DC2|DC5|PP1|CD9A|CE9A|CN9A|CP9A|CT9A|CZ4A|Z16A|DE3A|GC8|GDA|GDB|GRB|VAB|CXW|ZC6|ZD8|EA11R|EA21R|PG6SA|MA70|JZA70|JZA80|AE86|AE85|AW11|SW20|ZZW30|ST165|ST185|ST205|JZX81|JZX90|JZX100|JZX110|JZZ30|UZZ30|JZS147|JZS161|EP82|EP91|EXY10|FJ40|FJ60|FJ62|FJ80|HDJ81|HZJ77|UZJ100|GZG50|JB23|JB74|JA11|SJ30|FJ45|FJ55|FZJ80|BJ40|BJ74|HA[3479]|HH[56]|S1[01]0|S2[01]0|S3[23]0|S500|KS[34]|TT[12]|DA16T|DA63T|DE4|A90|A91)\b/i;

// [code, make, model matcher, first model year, last model year]
const CHASSIS_TABLE = [
  // --- Nissan ---
  ["BNR32", "Nissan", /skyline.*gt-?r|gt-?r.*skyline/i, 1989, 1994],
  ["BCNR33", "Nissan", /skyline.*gt-?r|gt-?r.*skyline/i, 1995, 1998],
  ["BNR34", "Nissan", /skyline.*gt-?r|gt-?r.*skyline/i, 1999, 2002],
  ["R35", "Nissan", /gt-?r/i, 2008, 2030],
  ["R32", "Nissan", /skyline/i, 1989, 1994],
  ["R33", "Nissan", /skyline/i, 1995, 1998],
  ["R34", "Nissan", /skyline/i, 1999, 2002],
  ["S12", "Nissan", /silvia|gazelle/i, 1984, 1988],
  ["S13", "Nissan", /silvia|240sx|180sx|200sx/i, 1989, 1994],
  ["S14", "Nissan", /silvia|240sx|200sx/i, 1995, 1998],
  ["S15", "Nissan", /silvia/i, 1999, 2002],
  ["Z31", "Nissan", /300zx/i, 1984, 1989],
  ["Z32", "Nissan", /300zx/i, 1990, 1996],
  ["Z33", "Nissan", /350z|fairlady ?z/i, 2003, 2009],
  ["Z34", "Nissan", /370z/i, 2009, 2020],
  ["S30", "Nissan", /240z|260z|280z(?!x)|fairlady ?z/i, 1970, 1978],
  ["S130", "Nissan", /280zx/i, 1979, 1983],
  ["WC34", "Nissan", /stagea/i, 1996, 2001],
  ["M35", "Nissan", /stagea/i, 2002, 2007],
  ["FK10", "Nissan", /figaro/i, 1989, 1992],
  ["PK10", "Nissan", /\bpao\b/i, 1989, 1991],
  // --- Toyota ---
  ["MA70", "Toyota", /supra/i, 1986, 1992],
  ["JZA80", "Toyota", /supra/i, 1993, 2002],
  ["AE86", "Toyota", /ae86|trueno|levin|corolla gt-?s/i, 1983, 1987],
  ["AW11", "Toyota", /mr2/i, 1984, 1989],
  ["SW20", "Toyota", /mr2/i, 1990, 1999],
  ["ZZW30", "Toyota", /mr2|mr-?s/i, 2000, 2007],
  ["ST165", "Toyota", /celica.*gt-?four|celica.*all-?trac/i, 1986, 1989],
  ["ST185", "Toyota", /celica.*gt-?four|celica.*all-?trac/i, 1990, 1993],
  ["ST205", "Toyota", /celica.*gt-?four/i, 1994, 1999],
  ["JZX81", "Toyota", /chaser|cresta|mark ?ii/i, 1988, 1992],
  ["JZX90", "Toyota", /chaser|cresta|mark ?ii/i, 1993, 1996],
  ["JZX100", "Toyota", /chaser|cresta|mark ?ii/i, 1997, 2001],
  ["Z20", "Toyota", /soarer/i, 1986, 1991],
  ["JZZ30", "Toyota", /soarer/i, 1992, 2000],
  ["JZS147", "Toyota", /aristo/i, 1991, 1997],
  ["JZS161", "Toyota", /aristo/i, 1998, 2004],
  ["EP82", "Toyota", /starlet/i, 1990, 1996],
  ["EP91", "Toyota", /starlet/i, 1997, 1999],
  ["EXY10", "Toyota", /sera/i, 1990, 1995],
  ["GZG50", "Toyota", /century/i, 1997, 2017],
  ["A90", "Toyota", /supra/i, 2019, 2030],
  ["FJ40", "Toyota", /land ?cruiser/i, 1960, 1980],
  ["FJ60", "Toyota", /land ?cruiser/i, 1981, 1987],
  ["FJ62", "Toyota", /land ?cruiser/i, 1988, 1990],
  ["HDJ81", "Toyota", /land ?cruiser/i, 1991, 1997],
  ["UZJ100", "Toyota", /land ?cruiser/i, 1998, 2007],
  ["J200", "Toyota", /land ?cruiser/i, 2008, 2021],
  ["J300", "Toyota", /land ?cruiser/i, 2022, 2030],
  // --- Mazda ---
  ["SA22C", "Mazda", /rx-?7/i, 1978, 1985],
  ["FC3S", "Mazda", /rx-?7/i, 1986, 1992],
  ["FD3S", "Mazda", /rx-?7/i, 1993, 2002],
  ["SE3P", "Mazda", /rx-?8/i, 2003, 2012],
  ["JC3S", "Mazda", /cosmo/i, 1990, 1995],
  ["NA", "Mazda", /miata|mx-?5|roadster/i, 1989, 1997],
  ["NB", "Mazda", /miata|mx-?5|roadster/i, 1998, 2005],
  ["NC", "Mazda", /miata|mx-?5|roadster/i, 2006, 2015],
  ["ND", "Mazda", /miata|mx-?5|roadster/i, 2016, 2030],
  // --- Honda / Acura ---
  ["NA1", "Honda", /nsx/i, 1990, 1997],
  ["NA2", "Honda", /nsx/i, 1998, 2005],
  ["NC1", "Honda", /nsx/i, 2016, 2022],
  ["AP1", "Honda", /s2000/i, 1999, 2003],
  ["AP2", "Honda", /s2000/i, 2004, 2009],
  ["EK9", "Honda", /civic.*type ?r/i, 1997, 2000],
  ["EP3", "Honda", /civic.*type ?r/i, 2001, 2005],
  ["FD2", "Honda", /civic.*type ?r/i, 2007, 2011],
  ["FK8", "Honda", /civic.*type ?r/i, 2017, 2021],
  ["FL5", "Honda", /civic.*type ?r/i, 2023, 2030],
  ["DC2", "Honda", /integra.*type ?r/i, 1995, 2001],
  ["DC5", "Honda", /integra.*type ?r|rsx/i, 2002, 2006],
  ["DA6", "Honda", /integra/i, 1990, 1993],
  ["DC2", "Honda", /integra/i, 1994, 2001],
  ["DC5", "Honda", /integra/i, 2002, 2006],
  ["DE4", "Honda", /integra/i, 2023, 2030],
  ["EF", "Honda", /civic|crx/i, 1988, 1991],
  ["EG", "Honda", /civic|del ?sol/i, 1992, 1995],
  ["EK", "Honda", /civic/i, 1996, 2000],
  ["PP1", "Honda", /\bbeat\b/i, 1991, 1996],
  // --- Mitsubishi ---
  ["CD9A", "Mitsubishi", /lancer|evo/i, 1992, 1994],
  ["CE9A", "Mitsubishi", /lancer|evo/i, 1995, 1996],
  ["CN9A", "Mitsubishi", /lancer|evo/i, 1996, 1998],
  ["CP9A", "Mitsubishi", /lancer|evo/i, 1998, 2001],
  ["CT9A", "Mitsubishi", /lancer|evo/i, 2001, 2007],
  ["CZ4A", "Mitsubishi", /lancer|evo/i, 2008, 2016],
  ["Z16A", "Mitsubishi", /3000gt|\bgto\b/i, 1990, 1999],
  ["DE3A", "Mitsubishi", /\bfto\b/i, 1994, 2000],
  // --- Subaru ---
  ["GC8", "Subaru", /impreza|wrx|sti/i, 1992, 2000],
  ["GDB", "Subaru", /impreza|wrx|sti/i, 2001, 2007],
  ["GRB", "Subaru", /impreza|wrx|sti/i, 2008, 2014],
  ["VAB", "Subaru", /wrx|sti/i, 2015, 2021],
  ["CXW", "Subaru", /svx/i, 1991, 1997],
  ["ZC6", "Subaru", /brz/i, 2012, 2020],
  ["ZD8", "Subaru", /brz/i, 2021, 2030],
  // --- kei + others ---
  // kei trucks + vans — a big slice of the US import feed
  ["HA4", "Honda", /acty/i, 1990, 1999],
  ["HA7", "Honda", /acty/i, 2000, 2009],
  ["HA9", "Honda", /acty/i, 2010, 2021],
  ["S83", "Daihatsu", /hijet/i, 1986, 1993],
  ["S110", "Daihatsu", /hijet/i, 1994, 1998],
  ["S210", "Daihatsu", /hijet/i, 1999, 2004],
  ["S330", "Daihatsu", /hijet/i, 2005, 2013],
  ["S500", "Daihatsu", /hijet/i, 2014, 2030],
  ["KS4", "Subaru", /sambar/i, 1990, 1998],
  ["TT2", "Subaru", /sambar/i, 1999, 2012],
  ["DA16T", "Suzuki", /carry/i, 2013, 2030],
  ["DA63T", "Suzuki", /carry/i, 2002, 2012],
  ["EA11R", "Suzuki", /cappuccino/i, 1991, 1995],
  ["EA21R", "Suzuki", /cappuccino/i, 1996, 1998],
  ["JA11", "Suzuki", /jimny|samurai/i, 1990, 1995],
  ["JB23", "Suzuki", /jimny/i, 1998, 2018],
  ["JB74", "Suzuki", /jimny/i, 2019, 2030],
  ["PG6SA", "Autozam", /az-?1/i, 1992, 1995],
  ["ZN6", "Toyota", /86|gt86|frs|fr-?s/i, 2012, 2020],
];

/** Real chassis code for a listing, or "" when we can't say confidently. */
export function resolveChassis(title, make, model, year) {
  const t = decode(title || "");
  const lit = t.match(CHASSIS_LITERAL);
  if (lit) return lit[0].toUpperCase();
  const y = Number(year) || 0;
  const hay = `${model || ""} ${t}`;
  const mk = String(make || "");
  for (const [code, rowMake, re, lo, hi] of CHASSIS_TABLE) {
    // Acura/Eunos/Datsun badge the same cars as their parent make.
    const makeOk = new RegExp(`^(${rowMake}|${{ Honda: "Acura", Nissan: "Datsun|Infiniti", Mazda: "Eunos", Toyota: "Lexus" }[rowMake] || "\\0"})$`, "i").test(mk);
    if (!makeOk) continue;
    if (y && (y < lo || y > hi)) continue;
    if (re.test(hay)) return code;
  }
  return "";
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
