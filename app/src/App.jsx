import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";

/* ============================================================
   PopJDM — jdmfeed.xyz
   ------------------------------------------------------------
   • Data layer: static listings.json, refreshed by a scheduled GitHub Action
   • Persistence: localStorage (swipes + live listings survive reloads)
   • Gestures: Pointer Events → identical on touch and mouse
   • PWA-ready shell → installable today, Capacitor/RN later
   ============================================================ */

/* ---------------- design tokens ---------------- */

const T = {
  bg: "#07080D",
  ink: "#F4F5F7",
  dim: "rgba(244,245,247,0.55)",
  faint: "rgba(244,245,247,0.32)",
  save: "#39D98A",
  pass: "#FF5A48",
  glassBg: "rgba(20,22,32,0.47)",
  glassBrd: "rgba(255,255,255,0.15)",
  glassHi: "inset 0 1px 0 rgba(255,255,255,0.24), inset 0 -1px 0 rgba(255,255,255,0.06)",
};

const FONT = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=IBM+Plex+Mono:wght@400;500&display=swap');
* { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
html, body, #root { height: 100%; }
body { margin: 0; background: ${T.bg}; overscroll-behavior: none; }
input[type=range]{ -webkit-appearance:none; appearance:none; height:3px; border-radius:2px;
  background:linear-gradient(90deg, rgba(255,255,255,0.6) var(--fill,50%), rgba(255,255,255,0.14) var(--fill,50%)); width:100%; }
input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; width:22px; height:22px; border-radius:50%;
  background:rgba(255,255,255,0.92); border:1px solid rgba(255,255,255,0.4);
  box-shadow:0 2px 10px rgba(0,0,0,0.5); cursor:pointer; }
.photostrip::-webkit-scrollbar { display: none; }
@keyframes riseIn { from { opacity:0; transform:translateY(14px) scale(0.985);} to { opacity:1; transform:none;} }
@keyframes pillIn { from { opacity:0; transform:translate(-50%, 10px);} to { opacity:1; transform:translate(-50%, 0);} }
@keyframes spinDash { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;

const display = (weight = 900) => ({
  fontFamily: "'Archivo', -apple-system, sans-serif",
  fontWeight: weight,
  fontVariationSettings: `'wdth' 118`,
  letterSpacing: "-0.02em",
});
const body = { fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Archivo', sans-serif" };
const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

/* Iconic factory paints → the card's whole atmosphere. */
const PAINTS = {
  "Midnight Purple II": { stops: ["#1B1033", "#3D2A6E", "#145C5B"], glow: "#6E5BC4" },
  "Bayside Blue":       { stops: ["#04122B", "#0A3F86", "#1173C8"], glow: "#3D9BFF" },
  "Championship White": { stops: ["#B9BDC4", "#E8EAEC", "#9AA0AB"], glow: "#FFFFFF", darkInk: true },
  "Super White":        { stops: ["#AEB3BC", "#E3E5E9", "#8F96A2"], glow: "#FFFFFF", darkInk: true },
  "Vintage Red":        { stops: ["#2B060A", "#7E1220", "#B3202C"], glow: "#FF4D5E" },
  "Milano Red":         { stops: ["#30070B", "#8A1420", "#C42430"], glow: "#FF5C66" },
  "Competition Yellow": { stops: ["#3A2E05", "#8F7A0E", "#D8B912"], glow: "#FFE04D" },
  "Spark Silver":       { stops: ["#1A1D24", "#5C636F", "#9AA2AE"], glow: "#C9D2DE" },
  "Deep Marine":        { stops: ["#03131A", "#0A3A47", "#12616F"], glow: "#2FB3C4" },
  "Gun Grey":           { stops: ["#0D0F13", "#2E333C", "#555D69"], glow: "#8A94A3" },
  "Black Pearl":        { stops: ["#050608", "#15181F", "#272C36"], glow: "#5A6472" },
  "Sonic Blue":         { stops: ["#071A33", "#134A8E", "#2E7BD4"], glow: "#5AA4FF" },
};
const PAINT_KEYS = Object.keys(PAINTS);
const paintFor = (name, seedStr = "") => {
  if (PAINTS[name]) return { name, ...PAINTS[name] };
  let h = 0;
  for (const c of (name || "") + seedStr) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const k = PAINT_KEYS[h % PAINT_KEYS.length];
  return { name: name || k, ...PAINTS[k] };
};

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E\")";

/* ---------------- domain ---------------- */

const fmtPrice = (n) => (typeof n === "number" && n > 0 ? "$" + n.toLocaleString() : "Auction");
const fmtMiles = (n) => (typeof n === "number" && n > 0 ? Math.round(n).toLocaleString() + " mi" : "—");
const decadeOf = (y) => Math.floor(y / 10) * 10;

/* "Cypress, CA" -> "California" for the card face; unknown shapes pass through. */
const STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "Washington DC",
};
const STATE_NAMES = new Map(Object.values(STATES).map((n) => [n.toLowerCase(), n]));
const stateOf = (loc) => {
  const s = String(loc || "").trim();
  const m = s.match(/,\s*([A-Za-z]{2})\.?$/);
  if (m && STATES[m[1].toUpperCase()]) return STATES[m[1].toUpperCase()];
  if (STATES[s.toUpperCase()]) return STATES[s.toUpperCase()];
  if (STATE_NAMES.has(s.toLowerCase())) return STATE_NAMES.get(s.toLowerCase());
  // "Fort Lauderdale, Florida" — take the trailing full state name.
  const tail = s.match(/,\s*([A-Za-z .]+?)$/)?.[1]?.trim().toLowerCase();
  if (tail && STATE_NAMES.has(tail)) return STATE_NAMES.get(tail);
  return s || "United States";
};

const normalize = (raw, i, live = false) => ({
  id: raw.id || `${live ? "live" : "seed"}-${i}-${(raw.title || "x").slice(0, 12)}`,
  title: raw.title || `${raw.year} ${raw.make} ${raw.model}`,
  year: Number(raw.year) || 1995,
  make: raw.make || "—",
  model: raw.model || "—",
  chassis: (raw.chassis || raw.model || "JDM").toString().toUpperCase().slice(0, 7),
  trim: raw.trim || "",
  price: typeof raw.price === "number" ? raw.price : Number(String(raw.price).replace(/[^0-9.]/g, "")) || 0,
  mileage: Number(raw.mileage) || 0,
  // Unknown stays empty (and hidden in the UI) — never a made-up default.
  transmission: raw.transmission || "",
  engine: raw.engine === "—" ? "" : raw.engine || "",
  drivetrain: raw.drivetrain === "—" ? "" : raw.drivetrain || "",
  color: raw.color || "",
  rhd: !!raw.rhd,
  location: raw.location || "United States",
  source: raw.source || (live ? "Web" : "Demo data"),
  source_url: raw.source_url || "",
  image: raw.image_url || raw.image || "",
  images: Array.isArray(raw.images) && raw.images.length
    ? raw.images
    : (raw.image_url || raw.image ? [raw.image_url || raw.image] : []),
  cutout: raw.cutout || "",
  description: raw.description || "",
  paintName: raw.paintName || raw.paint || "",
  paint: paintFor(raw.paintName || raw.paint, raw.title || ""),
  live: raw.live ?? live,
});

/* Demo deck so the app works before the first live sync. */
const SEED = [
  { year: 1999, make: "Nissan", model: "Skyline GT-R", chassis: "BNR34", trim: "V·Spec", price: 168500, mileage: 41200, transmission: "6-speed manual", engine: "2.6L RB26DETT twin-turbo I6", drivetrain: "ATTESA AWD", location: "Cypress, CA", source: "Demo data", paint: "Midnight Purple II", description: "Series 1 V·Spec, unmodified interior, NISMO shift boot, service records from Japan. Now over 25 years old and fully street-legal in all 50 states." },
  { year: 1994, make: "Toyota", model: "Supra RZ", chassis: "JZA80", trim: "Twin Turbo", price: 129900, mileage: 58600, transmission: "6-speed manual (V160)", engine: "3.0L 2JZ-GTE twin-turbo I6", drivetrain: "RWD", location: "Fort Worth, TX", source: "Demo data", paint: "Super White", description: "RHD Japanese-market RZ with the Getrag six-speed. Original targa roof, tasteful TRD touches, compression tested on import." },
  { year: 1992, make: "Honda", model: "NSX", chassis: "NA1", trim: "5-speed", price: 94500, mileage: 62100, transmission: "5-speed manual", engine: "3.0L C30A VTEC V6", drivetrain: "Mid-engine RWD", location: "Bellevue, WA", source: "Demo data", paint: "Championship White", description: "Early NA1 with the analog cabin Honda never made again. New timing belt service, original tool kit and books." },
  { year: 1997, make: "Mazda", model: "RX-7 Type RS", chassis: "FD3S", trim: "Series 8-style", price: 62800, mileage: 47900, transmission: "5-speed manual", engine: "1.3L 13B-REW twin-rotor", drivetrain: "RWD", location: "Orlando, FL", source: "Demo data", paint: "Vintage Red", description: "Sequential twins recently rebuilt, compression numbers in the listing. The shape that still stops traffic." },
  { year: 1998, make: "Honda", model: "Integra Type R", chassis: "DC2", trim: "JDM 98-spec", price: 46900, mileage: 71300, transmission: "5-speed manual", engine: "1.8L B18C VTEC I4", drivetrain: "FWD, helical LSD", location: "Denver, CO", source: "Demo data", paint: "Championship White", description: "98-spec with 4-lug-to-5-lug factory upgrade, Recaros unripped, 8,400 rpm of the best four-cylinder ever screwed together." },
  { year: 1995, make: "Nissan", model: "Silvia K's", chassis: "S14", trim: "Aero", price: 28400, mileage: 88200, transmission: "5-speed manual", engine: "2.0L SR20DET turbo I4", drivetrain: "RWD", location: "Phoenix, AZ", source: "Demo data", paint: "Spark Silver", description: "Zenki S14 K's, never drifted per auction sheet grade 4. Coilovers and exhaust, otherwise honest and stock." },
  { year: 1991, make: "Toyota", model: "Land Cruiser", chassis: "HDJ81", trim: "VX Limited", price: 31900, mileage: 118000, transmission: "Automatic", engine: "4.2L 1HD-T turbodiesel I6", drivetrain: "Full-time 4WD, triple locked", location: "Boise, ID", source: "Demo data", paint: "Deep Marine", description: "Factory triple-locked 80-series turbodiesel. The forever truck — rust-free Japanese chassis, new glow plugs." },
  { year: 1996, make: "Mitsubishi", model: "Lancer Evolution IV", chassis: "CN9A", trim: "GSR", price: 38700, mileage: 76400, transmission: "5-speed manual", engine: "2.0L 4G63T turbo I4", drivetrain: "AWD, AYC", location: "Chicago, IL", source: "Demo data", paint: "Sonic Blue", description: "First of the widebody Evos with Active Yaw Control. Timing belt done on landing, unmolested ECU." },
  { year: 1993, make: "Autozam", model: "AZ-1", chassis: "PG6SA", trim: "Mazdaspeed ver.", price: 24500, mileage: 39800, transmission: "5-speed manual", engine: "660cc F6A turbo I3", drivetrain: "Mid-engine RWD", location: "Portland, OR", source: "Demo data", paint: "Competition Yellow", description: "Gullwing kei supercar, one of ~4,400 built. Mazdaspeed aero, new clutch, fits in half a parking space." },
  { year: 1990, make: "Nissan", model: "Skyline GT-R", chassis: "BNR32", trim: "Standard", price: 52900, mileage: 93500, transmission: "5-speed manual", engine: "2.6L RB26DETT twin-turbo I6", drivetrain: "ATTESA AWD", location: "Nashville, TN", source: "Demo data", paint: "Gun Grey", description: "Godzilla in its original skin. Auction grade 4B, minor touch-ups noted, HICAS intact. The one that started it all." },
].map((r, i) => normalize(r, i, false));

/* ---------------- persistence ---------------- */

const LS_SWIPED = "touge.swiped.v1";
const LS_LIVE = "touge.live.v1";
const LS_USER = "touge.user.v1";

const loadJSON = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const saveJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — the session still works in memory */
  }
};

/* ---------------- data layer ---------------- */

/* Live listings are published as a static file by the scheduled
   refresh-listings GitHub Action — no server needed on GitHub Pages. */
async function fetchLiveListings() {
  const res = await fetch(`${import.meta.env.BASE_URL}listings.json?_=${Date.now()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("No live listings published yet");
  const data = await res.json().catch(() => null);
  const items = Array.isArray(data) ? data : data?.listings || [];
  return items.map((it, i) => normalize(it, i, true));
}

/* ---------------- auth (Google Identity Services) ---------------- */

const GOOGLE_CLIENT_ID = "588469885844-t6l3d20opq64nhah8nbolf3rf1i660s5.apps.googleusercontent.com";

let gisPromise = null;
const loadGis = () => {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { gisPromise = null; reject(new Error("Could not load Google sign-in")); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
};

/* The GIS credential is a JWT; the profile lives in its payload. */
const profileFromCredential = (credential) => {
  const payload = JSON.parse(atob(credential.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  return { sub: payload.sub, name: payload.name || "", email: payload.email || "", picture: payload.picture || "" };
};

/* Lightweight analytics — no-ops unless the GA loader in index.html ran. */
const track = (name, params) => { try { window.gtag?.("event", name, params); } catch { /* blocked */ } };

/* ---------------- garage sync (Google Drive appDataFolder) ----------------

   Saves live in localStorage per device; signing in with Google turns on
   cross-device sync by mirroring the swipe map into a private file in the
   USER'S OWN Google Drive app-data folder — no server, no database, free,
   and invisible in their Drive UI. Entries are timestamped ({ d, t }) and
   merged last-writer-wins per car, with "none" tombstones so removing a
   car from the garage on one device removes it everywhere. */

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE_FILE = "popjdm-garage.json";

const dirOf = (e) => {
  const d = typeof e === "string" ? e : e?.d; // legacy entries were bare strings
  return d === "left" || d === "right" ? d : null;
};
const mark = (d) => ({ d, t: Date.now() });
const entryTime = (e) => (typeof e === "object" && e ? e.t || 0 : 0);
/* Per-key last-writer-wins; ties go to `b` (call with local second). */
const mergeSwiped = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (!(k in out) || entryTime(v) >= entryTime(out[k])) out[k] = v;
  }
  return out;
};

let driveTokenClient = null;
let driveToken = null;
let driveTokenExp = 0;
const resetDriveAuth = () => { driveToken = null; driveTokenExp = 0; };

const getDriveToken = (interactive) => new Promise((resolve) => {
  if (driveToken && Date.now() < driveTokenExp - 60000) return resolve(driveToken);
  loadGis()
    .then(() => {
      if (!driveTokenClient) {
        driveTokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID, scope: DRIVE_SCOPE, callback: () => {},
        });
      }
      driveTokenClient.callback = (resp) => {
        if (resp?.access_token) {
          driveToken = resp.access_token;
          driveTokenExp = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
          resolve(driveToken);
        } else resolve(null);
      };
      try {
        driveTokenClient.requestAccessToken({ prompt: interactive ? "" : "none" });
      } catch { resolve(null); }
    })
    .catch(() => resolve(null));
});

const driveHeaders = (tok) => ({ Authorization: `Bearer ${tok}` });

const driveFindFile = async (tok) => {
  const q = encodeURIComponent(`name='${DRIVE_FILE}'`);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)&q=${q}`, { headers: driveHeaders(tok) });
  if (!r.ok) throw new Error(`drive list ${r.status}`);
  return (await r.json()).files?.[0]?.id || null;
};

const driveRead = async (tok, id) => {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, { headers: driveHeaders(tok) });
  if (!r.ok) throw new Error(`drive read ${r.status}`);
  return r.json();
};

const driveWrite = async (tok, id, data) => {
  if (id) {
    const r = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: "PATCH", headers: { ...driveHeaders(tok), "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error(`drive update ${r.status}`);
    return id;
  }
  const boundary = "popjdm" + Date.now();
  const body =
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    JSON.stringify({ name: DRIVE_FILE, parents: ["appDataFolder"] }) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    JSON.stringify(data) + `\r\n--${boundary}--`;
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST", headers: { ...driveHeaders(tok), "Content-Type": `multipart/related; boundary=${boundary}` }, body,
  });
  if (!r.ok) throw new Error(`drive create ${r.status}`);
  return (await r.json()).id;
};

/* ---------------- shared glass surface ---------------- */

const Glass = React.forwardRef(({ children, style, radius = 22, ...rest }, ref) => (
  <div
    ref={ref}
    {...rest}
    style={{
      background: T.glassBg,
      backdropFilter: "blur(28px) saturate(1.85)",
      WebkitBackdropFilter: "blur(28px) saturate(1.85)",
      border: `1px solid ${T.glassBrd}`,
      boxShadow: `${T.glassHi}, 0 12px 40px rgba(0,0,0,0.45)`,
      borderRadius: radius,
      ...style,
    }}
  >
    {children}
  </div>
));

const IconBtn = ({ label, onClick, size = 56, color = T.ink, border, children, style }) => (
  <button
    aria-label={label}
    onClick={onClick}
    style={{
      width: size, height: size, borderRadius: size / 2, cursor: "pointer",
      display: "grid", placeItems: "center", color,
      background: "rgba(255,255,255,0.07)",
      backdropFilter: "blur(18px) saturate(1.5)",
      WebkitBackdropFilter: "blur(18px) saturate(1.5)",
      border: `1px solid ${border || T.glassBrd}`,
      boxShadow: T.glassHi,
      transition: "transform 0.15s ease, background 0.2s ease",
      ...style,
    }}
    onPointerDown={(e) => (e.currentTarget.style.transform = "scale(0.9)")}
    onPointerUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
    onPointerLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
  >
    {children}
  </button>
);

const XIcon = ({ s = 22 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
const HeartIcon = ({ s = 22, filled }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
    <path d="M12 20.5S3.5 15.3 3.5 9.6C3.5 6.6 5.9 4.5 8.5 4.5c1.5 0 2.8 0.7 3.5 1.9 0.7-1.2 2-1.9 3.5-1.9 2.6 0 5 2.1 5 5.1 0 5.7-8.5 10.9-8.5 10.9z" />
  </svg>
);

/* ---------------- swipe card ---------------- */

const THRESH = 80;
const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

/* Release velocity from a ~110ms window of trailing samples, the way native
   velocity trackers do it — a single stationary event at release (or a
   finger micro-pause) must not zero out a genuine flick. */
const trackSample = (d, x, y) => {
  const t = performance.now();
  d.samples.push({ t, x, y });
  if (d.samples.length > 8) d.samples.shift();
  return t;
};
const releaseVelocity = (d) => {
  const s = d.samples;
  if (!s || s.length < 2) return { vx: 0, vy: 0 };
  const last = s[s.length - 1];
  let first = s[0];
  for (const p of s) if (last.t - p.t <= 110) { first = p; break; }
  const dt = Math.max(last.t - first.t, 1);
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
};

function SwipeCard({ listing, isTop, stackIndex, exiting, forced, onSwipeStart, onSwipeCommit, onOpen }) {
  const rootRef = useRef(null);
  const saveRef = useRef(null);
  const passRef = useRef(null);
  const drag = useRef(null); // live gesture: offsets + smoothed velocity
  const gone = useRef(false); // fly-out started — this card is done taking input
  const btnDown = useRef(null); // where the DETAILS press started (drift check)
  const [imgOk, setImgOk] = useState(true);
  const [cutOk, setCutOk] = useState(true);
  const p = listing.paint;
  const showCutout = Boolean(listing.cutout) && cutOk;
  // The masked full photo is the fallback when no cutout exists yet.
  const showPhoto = !showCutout && Boolean(listing.image) && imgOk;

  /* The drag paints straight to the DOM inside the pointermove handler —
     browsers already coalesce moves to display cadence, so skipping the
     extra rAF hop removes a frame of lag and the card feels glued to the
     finger. Rotation direction follows the grab point (grab the top half
     and the nose leads; grab the bottom and it trails), the way physical
     cards behave. */
  const paint = () => {
    const d = drag.current;
    if (!d || !rootRef.current) return;
    const rot = Math.max(-15, Math.min(15, d.dx * 0.06)) * d.rotDir;
    rootRef.current.style.transform = `translate3d(${d.dx}px, ${d.dy * 0.9}px, 0) rotate(${rot}deg)`;
    const so = clamp01(d.dx / THRESH), po = clamp01(-d.dx / THRESH);
    if (saveRef.current) { saveRef.current.style.opacity = so; saveRef.current.style.transform = `rotate(-9deg) scale(${0.9 + so * 0.15})`; }
    if (passRef.current) { passRef.current.style.opacity = po; passRef.current.style.transform = `rotate(9deg) scale(${0.9 + po * 0.15})`; }
  };

  const flyOut = useCallback((dir, vx = 0, vy = 0) => {
    if (gone.current) return;
    gone.current = true;
    buzz(12);
    const d = drag.current || { dx: 0, dy: 0, rotDir: 1 };
    drag.current = null;
    const sign = dir === "right" ? 1 : -1;
    const distX = (window.innerWidth || 420) * 1.15 + 120;
    // The card leaves at the finger's speed — a hard flick exits faster —
    // and stays fully visible while it flies clear off-screen (no fade).
    const speed = Math.max(Math.abs(vx), 1.1);
    const ms = Math.round(Math.min(Math.max((distX - Math.abs(d.dx)) / speed, 180), 380));
    const el = rootRef.current;
    if (el) {
      el.style.transition = `transform ${ms}ms cubic-bezier(0.32, 0.72, 0.46, 1)`;
      el.style.transform = `translate3d(${sign * distX}px, ${d.dy * 0.9 + vy * ms * 0.35}px, 0) rotate(${sign * 22 * (d.rotDir || 1)}deg)`;
    }
    const stamp = dir === "right" ? saveRef.current : passRef.current;
    if (stamp) stamp.style.opacity = 1;
    onSwipeStart(listing.id, dir); // promote the next card immediately — no dead gap
    setTimeout(() => onSwipeCommit(listing.id, dir), ms + 40);
  }, [listing.id, onSwipeStart, onSwipeCommit]);

  useEffect(() => {
    if (isTop && forced && forced.n > 0) flyOut(forced.dir, 1.5, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forced && forced.n]);

  const settle = () => {
    const el = rootRef.current;
    if (el) {
      el.style.transition = "transform 0.45s cubic-bezier(0.2, 1.25, 0.35, 1)"; // springy return
      el.style.transform = "translate3d(0px, 0px, 0) rotate(0deg)";
    }
    for (const r of [saveRef, passRef]) if (r.current) r.current.style.opacity = 0;
  };

  const onDown = (e) => {
    if (!isTop || gone.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (rootRef.current) rootRef.current.style.transition = "none";
    const r = e.currentTarget.getBoundingClientRect();
    drag.current = {
      dx: 0, dy: 0, x0: e.clientX, y0: e.clientY, moved: false,
      rotDir: e.clientY < r.top + r.height / 2 ? 1 : -1, // grab point sets the pivot feel
      samples: [{ t: performance.now(), x: 0, y: 0 }],
    };
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d || gone.current) return;
    d.dx = e.clientX - d.x0;
    d.dy = e.clientY - d.y0;
    trackSample(d, d.dx, d.dy);
    if (Math.abs(d.dx) + Math.abs(d.dy) > 14) d.moved = true; // forgiving tap slop
    paint();
  };
  const onUp = () => {
    const d = drag.current;
    if (!d || gone.current) return;
    const { vx, vy } = releaseVelocity(d);
    // Decide on the PROJECTED landing point (position + velocity carry),
    // the way native swipe UIs do — no dead zone between "far enough" and
    // "fast enough": a slow far drag and a quick short flick both commit.
    const proj = d.dx + vx * 200;
    if (proj > THRESH && d.dx > 20) return flyOut("right", vx, vy);
    if (proj < -THRESH && d.dx < -20) return flyOut("left", vx, vy);
    drag.current = null;
    settle();
    // A clean tap anywhere on the card opens the details.
    if (!d.moved) { buzz(6); onOpen(listing); }
  };
  const onCancel = () => {
    if (!drag.current) return;
    drag.current = null;
    settle();
  };

  const behind = isTop || exiting ? 0 : stackIndex;
  const ink = p.darkInk ? "#14161C" : T.ink;

  return (
    <div
      ref={rootRef}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
      style={{
        position: "absolute", inset: 0, touchAction: "none",
        transform: `translate3d(0px, ${behind * 12}px, 0) rotate(0deg) scale(${1 - behind * 0.045})`,
        transition: "transform 0.45s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease",
        opacity: 1 - behind * 0.18,
        zIndex: exiting ? 30 : 10 - behind,
        willChange: isTop || exiting ? "transform" : "auto",
        cursor: isTop ? "grab" : "default",
      }}
    >
      <div style={{
        position: "relative", width: "100%", height: "100%", borderRadius: 34, overflow: "hidden",
        background: `linear-gradient(158deg, ${p.stops[0]} 0%, ${p.stops[1]} 52%, ${p.stops[2]} 100%)`,
        border: "1px solid rgba(255,255,255,0.16)",
        boxShadow: "inset 0 1.5px 0 rgba(255,255,255,0.24), inset 0 -1px 0 rgba(255,255,255,0.05), 0 24px 70px rgba(0,0,0,0.6)",
      }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(90% 70% at 78% 8%, ${p.glow}55, transparent 60%)` }} />
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 20% 110%, rgba(0,0,0,0.55), transparent 55%)" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, mixBlendMode: "overlay" }} />

        <div aria-hidden style={{
          position: "absolute", top: "8%", left: -8, right: 0, ...display(900),
          fontSize: "clamp(88px, 27vw, 156px)", lineHeight: 0.84, color: ink,
          opacity: p.darkInk ? 0.92 : 0.96, letterSpacing: "-0.04em", whiteSpace: "nowrap",
          textShadow: p.darkInk ? "none" : "0 6px 40px rgba(0,0,0,0.35)", paddingLeft: 22,
        }}>
          <div style={{ ...mono, fontSize: 12, letterSpacing: "0.34em", opacity: 0.75, marginBottom: 12, fontWeight: 500 }}>
            {listing.make.toUpperCase()} · {String(listing.year)}
          </div>
          {listing.chassis}
        </div>

        {showCutout && (
          <>
            {/* Soft ground shadow so the floating car feels planted on the card.
                Sits just above the info glass so the car reads as floating
                clear of the panel rather than tucked behind it. */}
            <div aria-hidden style={{
              position: "absolute", left: "16%", right: "16%", bottom: "40%", height: 28,
              background: "radial-gradient(60% 100% at 50% 50%, rgba(0,0,0,0.6), transparent 70%)",
              filter: "blur(11px)",
            }} />
            {/* The cut-out car floats over its own chassis type — its roofline
                rises into the letters so the type reads BEHIND the car, the
                editorial poster depth the design is going for. It's lifted to
                clear the info glass so the car is never hidden behind it. */}
            <img
              src={`${import.meta.env.BASE_URL}${listing.cutout}`} alt={listing.title} draggable={false}
              loading={isTop ? "eager" : "lazy"}
              onError={() => setCutOk(false)}
              style={{
                position: "absolute", left: "1%", right: "1%", bottom: "38%", width: "98%",
                maxHeight: "47%", objectFit: "contain", objectPosition: "bottom center",
                userSelect: "none", filter: "drop-shadow(0 26px 28px rgba(0,0,0,0.6))",
              }}
            />
          </>
        )}

        {showPhoto && (
          <>
            {/* Fallback: the photo fades in from the top, so the giant chassis
                type sits partially BEHIND the car — the depth effect. */}
            <img
              src={listing.image} alt={listing.title} draggable={false}
              loading={isTop ? "eager" : "lazy"}
              onError={() => setImgOk(false)}
              style={{
                position: "absolute", inset: 0, width: "100%", height: "100%",
                objectFit: "cover", objectPosition: "center 62%", userSelect: "none",
                WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.30) 13%, rgba(0,0,0,0.88) 28%, #000 40%)",
                maskImage: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.30) 13%, rgba(0,0,0,0.88) 28%, #000 40%)",
              }}
            />
            {/* Scrims keep the stamps and the info glass legible over any photo. */}
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.18) 0%, transparent 30%, transparent 55%, rgba(0,0,0,0.62) 100%)" }} />
            <div aria-hidden style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, mixBlendMode: "overlay" }} />
          </>
        )}

        <div ref={saveRef} style={{ position: "absolute", top: 26, left: 22, opacity: 0, transform: "rotate(-9deg) scale(0.9)", ...display(900), fontSize: 30, color: T.save, border: `3px solid ${T.save}`, borderRadius: 12, padding: "4px 14px", background: "rgba(0,0,0,0.25)", backdropFilter: "blur(6px)" }}>
          SAVE
        </div>
        <div ref={passRef} style={{ position: "absolute", top: 26, right: 22, opacity: 0, transform: "rotate(9deg) scale(0.9)", ...display(900), fontSize: 30, color: T.pass, border: `3px solid ${T.pass}`, borderRadius: 12, padding: "4px 14px", background: "rgba(0,0,0,0.25)", backdropFilter: "blur(6px)" }}>
          PASS
        </div>

        {/* The panel is passive on purpose: the card's gesture engine owns
            every pointer, so a swipe that STARTS here still swipes, and a
            clean tap here opens the details (the card-level tap path). Only
            the DETAILS button intercepts its own presses. */}
        <Glass radius={24} style={{ position: "absolute", left: 14, right: 14, bottom: 14, padding: "16px 18px 14px", cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <div style={{
              ...display(800), fontSize: 21, color: T.ink, lineHeight: 1.1,
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>
              {listing.year} {listing.model}
              {listing.trim ? <span style={{ ...body, fontWeight: 500, fontSize: 14, color: T.dim }}>  {listing.trim}</span> : null}
            </div>
            <div style={{ ...display(900), fontSize: 22, color: T.ink, whiteSpace: "nowrap" }}>{fmtPrice(listing.price)}</div>
          </div>
          {(() => {
            // Only the specs the source actually knows — no "—" placeholders.
            const quick = [
              listing.mileage > 0 ? fmtMiles(listing.mileage) : "",
              listing.transmission, listing.drivetrain,
            ].filter(Boolean);
            return quick.length ? (
              <div style={{ ...mono, fontSize: 12, color: T.dim, marginTop: 8, display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                {quick.map((s) => <span key={s}>{s}</span>)}
              </div>
            ) : null;
          })()}
          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ ...body, fontSize: 12.5, color: T.faint }}>
              {listing.rhd ? <span style={{ ...mono, fontSize: 10, letterSpacing: "0.1em", color: T.dim, marginRight: 8, padding: "2px 6px", borderRadius: 8, border: `1px solid ${T.glassBrd}` }}>RHD</span> : null}
              {stateOf(listing.location)}
            </span>
            <span style={{
              ...mono, fontSize: 10.5, letterSpacing: "0.08em", padding: "4px 9px", borderRadius: 20,
              border: `1px solid ${listing.live ? "rgba(57,217,138,0.45)" : T.glassBrd}`,
              color: listing.live ? T.save : T.faint,
              background: listing.live ? "rgba(57,217,138,0.08)" : "rgba(255,255,255,0.04)",
            }}>
              {listing.live ? "● LIVE · " : ""}{listing.source.toUpperCase()}
            </span>
          </div>
          {/* Guaranteed tap target for the detail sheet. stopPropagation on
              pointerdown keeps the card's swipe engine from ever capturing
              this pointer, so the button works on every device regardless
              of how the platform routes the tap gesture. */}
          <button
            onPointerDown={(e) => { e.stopPropagation(); btnDown.current = { x: e.clientX, y: e.clientY }; }}
            onClick={(e) => {
              e.stopPropagation();
              const s = btnDown.current;
              if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 12) return; // a drag, not a tap
              buzz(6);
              onOpen(listing);
            }}
            style={{
              width: "100%", marginTop: 12, padding: "12px 0", borderRadius: 14, cursor: "pointer",
              ...mono, fontSize: 11, letterSpacing: "0.22em", color: T.ink,
              background: "rgba(255,255,255,0.07)", border: `1px solid ${T.glassBrd}`,
              boxShadow: T.glassHi, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            DETAILS
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6" /></svg>
          </button>
        </Glass>
      </div>
    </div>
  );
}

/* ---------------- shared bottom sheet (drag-to-dismiss) ---------------- */

/* Every sheet in the app — detail, account, filters — uses this. The grab
   handle (and, by touch, the body when scrolled to the top) rides the
   finger 1:1 and dismisses past a distance or velocity threshold. */
function BottomSheet({ onClose, style, children }) {
  const sheetRef = useRef(null);
  const backRef = useRef(null);
  const drag = useRef(null); // live gesture: offset + smoothed velocity
  const closingRef = useRef(false);
  const born = useRef(performance.now()); // ghost-click guard timestamp
  const [shown, setShown] = useState(false); // false = parked below the viewport

  /* The sheet slides in via a transition on the SAME transform the drag
     writes to — a keyframe animation here would override the drag and the
     sheet would ignore the finger. */
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(raf);
  }, []);

  const dismiss = useCallback((vy = 0) => {
    if (closingRef.current) return;
    closingRef.current = true;
    const el = sheetRef.current, back = backRef.current;
    if (!el) { onClose(); return; }
    // Keep the finger's momentum: a hard flick exits faster.
    const ms = Math.round(Math.min(Math.max(320 - vy * 120, 150), 300));
    el.style.transition = `transform ${ms}ms cubic-bezier(0.4, 0.2, 0.7, 1)`;
    el.style.transform = "translate3d(0, 105%, 0)";
    if (back) { back.style.transition = `opacity ${ms}ms ease`; back.style.opacity = "0"; }
    setTimeout(onClose, ms + 30);
  }, [onClose]);

  // Once a pull is committed, stop the browser from scrolling underneath it.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return undefined;
    const block = (e) => { if (drag.current?.committed) e.preventDefault(); };
    el.addEventListener("touchmove", block, { passive: false });
    return () => el.removeEventListener("touchmove", block);
  }, []);

  const paint = () => {
    const d = drag.current;
    if (!d) return;
    d.raf = 0;
    const dy = d.dy < 0 ? d.dy * 0.12 : d.dy; // rubber-band upward pulls
    if (sheetRef.current) sheetRef.current.style.transform = `translate3d(0, ${dy}px, 0)`;
    if (backRef.current) backRef.current.style.opacity = String(1 - clamp01(Math.max(dy, 0) / 700));
  };

  const onDown = (e) => {
    if (closingRef.current) return;
    const el = sheetRef.current;
    if (!el) return;
    drag.current = {
      dy: 0, dx: 0, y0: e.clientY, x0: e.clientX,
      committed: false, raf: 0, pid: e.pointerId,
      samples: [{ t: performance.now(), x: 0, y: 0 }],
      // The handle zone always drags; the body drags by touch from the top of the scroll.
      fromHandle: e.clientY - el.getBoundingClientRect().top < 56,
      touch: e.pointerType !== "mouse",
    };
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d || closingRef.current) return;
    const el = sheetRef.current;
    if (!el) return;
    const dy = e.clientY - d.y0, dx = e.clientX - d.x0;
    d.dy = dy; d.dx = dx;
    trackSample(d, dx, dy);
    if (!d.committed) {
      const pull = d.fromHandle
        ? Math.abs(dy) > 3
        : d.touch && dy > 8 && Math.abs(dy) > Math.abs(dx) * 1.2 && el.scrollTop <= 0;
      if (pull) {
        d.committed = true;
        el.setPointerCapture?.(d.pid);
        el.style.transition = "none";
        if (backRef.current) backRef.current.style.transition = "none";
      } else if (dy < -8 || Math.abs(dx) > 16 || el.scrollTop > 0) {
        drag.current = null; // it's a scroll or horizontal gesture — the browser's
        return;
      } else return;
    }
    if (!d.raf) d.raf = requestAnimationFrame(paint);
  };
  const onUp = () => {
    const d = drag.current;
    if (!d) return;
    if (d.raf) cancelAnimationFrame(d.raf);
    drag.current = null;
    if (!d.committed) return; // plain tap — buttons/links handle themselves
    const el = sheetRef.current, back = backRef.current;
    const h = el ? el.getBoundingClientRect().height : 600;
    const { vy } = releaseVelocity(d);
    if (d.dy > h * 0.22 || (d.dy > 40 && vy > 0.35)) { dismiss(Math.max(vy, 0)); return; }
    // Not far enough — spring back into place.
    if (el) { el.style.transition = "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)"; el.style.transform = "translate3d(0, 0, 0)"; }
    if (back) { back.style.transition = "opacity 0.3s ease"; back.style.opacity = "1"; }
  };

  return (
    <div
      ref={backRef}
      // Ghost-click guard: the tap that OPENED the sheet fires a trailing
      // click that can land on this brand-new backdrop and instantly close
      // it — ignore backdrop clicks for the first 400ms.
      onClick={() => { if (performance.now() - born.current > 400) dismiss(); }}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", display: "flex", alignItems: "flex-end", justifyContent: "center", opacity: shown ? 1 : 0, transition: "opacity 0.34s ease" }}
    >
      <Glass
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        radius={28}
        style={{
          width: "min(560px, 100%)", maxHeight: "88%", overflowY: "auto", margin: "0 8px", padding: "22px 22px 26px",
          background: "rgba(14,16,23,0.82)", overscrollBehavior: "contain",
          transform: shown ? "translate3d(0, 0, 0)" : "translate3d(0, 100%, 0)",
          transition: "transform 0.42s cubic-bezier(0.22, 1, 0.36, 1)",
          willChange: "transform",
          ...style,
        }}
      >
        {/* Grab handle — its zone always drags, even where the sheet scrolls. */}
        <div style={{ padding: "2px 0 14px", margin: "-4px 0 6px", cursor: "grab", touchAction: "none", userSelect: "none" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.28)", margin: "0 auto" }} />
        </div>
        {children}
      </Glass>
    </div>
  );
}

/* ---------------- detail sheet ---------------- */

function DetailSheet({ listing, onClose, saved, onToggleSave }) {
  const [photo, setPhoto] = useState(0);
  const stripRef = useRef(null);
  useEffect(() => {
    setPhoto(0);
    stripRef.current?.scrollTo?.({ left: 0 });
  }, [listing?.id]);
  if (!listing) return null;
  const p = listing.paint;
  const imgs = listing.images?.length ? listing.images : (listing.image ? [listing.image] : []);
  // Only show spec tiles the sources actually know — no blank "—" cells.
  const specs = [
    ["Engine", listing.engine], ["Drivetrain", listing.drivetrain],
    ["Transmission", listing.transmission], ["Mileage", listing.mileage > 0 ? fmtMiles(listing.mileage) : ""],
    ["Chassis", listing.chassis], ["Exterior", listing.color],
    ["Location", listing.location], ["Source", listing.source],
  ].filter(([, v]) => v && String(v).trim() && v !== "—");
  return (
    <BottomSheet key={listing.id} onClose={onClose}>
        {imgs.length > 0 && (
          <div style={{ position: "relative", marginBottom: 16 }}>
            {/* Native scroll-snap photo slider — momentum + snapping for free.
                touchAction pan-x keeps horizontal swipes here; vertical pulls
                still fall through to the sheet's drag-to-dismiss. */}
            <div
              ref={stripRef}
              className="photostrip"
              onScroll={(e) => {
                const el = e.currentTarget;
                setPhoto(Math.min(imgs.length - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
              }}
              style={{
                display: "flex", overflowX: "auto", scrollSnapType: "x mandatory",
                borderRadius: 18, border: `1px solid ${T.glassBrd}`,
                WebkitOverflowScrolling: "touch", overscrollBehaviorX: "contain",
                touchAction: "pan-x", scrollbarWidth: "none",
              }}
            >
              {imgs.map((src, i) => (
                <img
                  key={src} src={src} alt={`${listing.title} — photo ${i + 1}`}
                  loading={i < 2 ? "eager" : "lazy"} draggable={false}
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                  style={{ width: "100%", height: 260, objectFit: "cover", flexShrink: 0, scrollSnapAlign: "center", userSelect: "none" }}
                />
              ))}
            </div>
            {imgs.length > 1 && (
              <>
                <div style={{ position: "absolute", bottom: 10, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 5, pointerEvents: "none" }}>
                  {imgs.map((_, i) => (
                    <div key={i} style={{
                      width: i === photo ? 16 : 5, height: 5, borderRadius: 3,
                      background: i === photo ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)",
                      transition: "all 0.25s ease", boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
                    }} />
                  ))}
                </div>
                <div style={{ position: "absolute", top: 10, right: 10, ...mono, fontSize: 10.5, padding: "3px 9px", borderRadius: 12, background: "rgba(0,0,0,0.55)", color: T.ink, pointerEvents: "none" }}>
                  {photo + 1}/{imgs.length}
                </div>
              </>
            )}
          </div>
        )}
        <div style={{ height: 6, borderRadius: 3, marginBottom: 18, background: `linear-gradient(90deg, ${p.stops[0]}, ${p.stops[1]}, ${p.stops[2]})` }} />
        <div style={{ ...mono, fontSize: 11, letterSpacing: "0.3em", color: T.faint }}>{listing.chassis} · {listing.make.toUpperCase()}</div>
        <h2 style={{ ...display(900), fontSize: 30, color: T.ink, margin: "6px 0 2px", lineHeight: 1.05 }}>
          {listing.year} {listing.model} {listing.trim}
        </h2>
        <div style={{ ...display(800), fontSize: 24, color: T.ink, margin: "8px 0 16px" }}>{fmtPrice(listing.price)}</div>
        {listing.description && <p style={{ ...body, fontSize: 14.5, lineHeight: 1.65, color: T.dim, margin: "0 0 18px" }}>{listing.description}</p>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {specs.map(([k, v]) => (
            <div key={k} style={{ border: `1px solid ${T.glassBrd}`, borderRadius: 14, padding: "10px 12px", background: "rgba(255,255,255,0.03)" }}>
              <div style={{ ...mono, fontSize: 10, letterSpacing: "0.18em", color: T.faint, marginBottom: 4 }}>{k.toUpperCase()}</div>
              <div style={{ ...body, fontSize: 13.5, color: T.ink }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={() => onToggleSave(listing)} style={{
            flex: 1, padding: "14px 0", borderRadius: 16, cursor: "pointer", ...display(800), fontSize: 15,
            color: saved ? T.bg : T.ink, background: saved ? T.save : "rgba(255,255,255,0.08)",
            border: `1px solid ${saved ? T.save : T.glassBrd}`, boxShadow: T.glassHi,
          }}>
            {saved ? "Saved ✓" : "Save this car"}
          </button>
          {listing.source_url ? (
            <a href={listing.source_url} target="_blank" rel="noreferrer" style={{
              flex: 1, padding: "14px 0", borderRadius: 16, textAlign: "center", textDecoration: "none",
              ...display(800), fontSize: 15, color: T.ink, background: "rgba(255,255,255,0.08)",
              border: `1px solid ${T.glassBrd}`, boxShadow: T.glassHi,
            }}>
              View listing ↗
            </a>
          ) : null}
        </div>
    </BottomSheet>
  );
}

/* ---------------- account sheet ---------------- */

function AccountSheet({ open, onClose, user, onSignedIn, onSignOut, savedCount, garageSync, onSyncNow }) {
  const btnRef = useRef(null);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    if (!open || user) return;
    let cancelled = false;
    setAuthError(null);
    loadGis()
      .then(() => {
        if (cancelled || !btnRef.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (resp) => {
            try {
              onSignedIn(profileFromCredential(resp.credential));
            } catch {
              setAuthError("Sign-in response could not be read — try again.");
            }
          },
        });
        window.google.accounts.id.renderButton(btnRef.current, {
          theme: "filled_black", size: "large", shape: "pill", text: "continue_with", width: 280,
        });
      })
      .catch((err) => { if (!cancelled) setAuthError(err.message); });
    return () => { cancelled = true; };
  }, [open, user, onSignedIn]);

  if (!open) return null;
  return (
    <BottomSheet onClose={onClose} style={{ padding: "22px 22px 30px", textAlign: "center" }}>
        {user ? (
          <>
            {user.picture ? (
              <img src={user.picture} alt="" referrerPolicy="no-referrer" style={{ width: 64, height: 64, borderRadius: 32, border: `2px solid ${T.glassBrd}`, marginBottom: 12 }} />
            ) : null}
            <div style={{ ...display(800), fontSize: 20, color: T.ink }}>{user.name || user.email}</div>
            {user.email ? <div style={{ ...body, fontSize: 13, color: T.dim, marginTop: 4 }}>{user.email}</div> : null}
            <div style={{ ...mono, fontSize: 11.5, letterSpacing: "0.12em", color: T.faint, margin: "14px 0 8px" }}>
              {savedCount} CAR{savedCount === 1 ? "" : "S"} IN THE GARAGE
            </div>
            <button onClick={onSyncNow} style={{
              ...mono, fontSize: 10.5, letterSpacing: "0.12em", padding: "7px 14px", borderRadius: 14,
              cursor: "pointer", margin: "0 0 18px",
              color: garageSync === "on" ? T.save : garageSync === "error" ? T.pass : T.dim,
              background: "rgba(255,255,255,0.05)",
              border: `1px solid ${garageSync === "on" ? "rgba(57,217,138,0.4)" : T.glassBrd}`,
            }}>
              {garageSync === "on" ? "● SYNCED ACROSS DEVICES" : garageSync === "error" ? "SYNC OFF — TAP TO ENABLE" : "TAP TO SYNC ACROSS DEVICES"}
            </button>
            <button onClick={onSignOut} style={{
              padding: "13px 26px", borderRadius: 16, cursor: "pointer", ...display(800), fontSize: 14,
              color: T.ink, background: "rgba(255,255,255,0.08)", border: `1px solid ${T.glassBrd}`, boxShadow: T.glassHi,
            }}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <h3 style={{ ...display(900), fontSize: 20, color: T.ink, margin: "0 0 8px" }}>Your garage, everywhere</h3>
            <p style={{ ...body, fontSize: 13.5, color: T.dim, maxWidth: 320, margin: "0 auto 20px", lineHeight: 1.6 }}>
              Sign in to keep your saved cars tied to your profile on this device. Cars you've already saved come with you.
            </p>
            <div ref={btnRef} style={{ display: "flex", justifyContent: "center", minHeight: 44 }} />
            {authError ? <div style={{ ...body, fontSize: 12.5, color: T.pass, marginTop: 12 }}>{authError}</div> : null}
          </>
        )}
    </BottomSheet>
  );
}

/* ---------------- filter sheet ---------------- */

/* Nameplate families — the filter speaks the same language as the cards'
   giant chassis type. Each entry: [label, URL slug, title matcher]. The
   slug makes filters shareable: jdmfeed.xyz/#land-cruiser opens the feed
   pre-tuned to Land Cruisers. */
const NAMEPLATES = [
  ["Skyline / GT-R", "skyline", /GT-?R|Skyline/i],
  ["Supra", "supra", /Supra/i],
  ["Land Cruiser", "land-cruiser", /Land ?Cruiser|FJ\d\d|HJ\d\d|HDJ\d\d|BJ\d\d/i],
  ["Z cars", "z-cars", /2[468]0Z|300ZX|3[57]0Z|Fairlady/i],
  ["Rotary", "rotary", /RX-?[2378]|Cosmo/i],
  ["NSX", "nsx", /NSX/i],
  ["S2000", "s2000", /S2000/i],
  ["Silvia / 240SX", "silvia", /Silvia|180SX|200SX|240SX/i],
  ["Miata", "miata", /Miata|MX-?5/i],
  ["Civic / Integra", "civic", /Civic|Integra|CRX|Prelude|Type ?R/i],
  ["Evo / Lancer", "evo", /Evolution|Lancer|\bEvo\b/i],
  ["WRX / STI", "wrx", /WRX|STI\b|Impreza/i],
  ["AE86 / MR2", "toyota-sport", /AE86|Trueno|Levin|MR-?2|MR-?S|Celica|Starlet/i],
  ["Kei cars", "kei", /Cappuccino|AZ-?1|\bBeat\b|Sambar|Hijet|Acty|Jimny|Copen|Cara\b/i],
  ["4×4 / vans", "4x4", /Delica|Pajero|Montero|VehiCROSS|Samurai|Chaser|Crown|Century/i],
];
const plateMatches = (l, slugs) => {
  if (!slugs.size) return true;
  const hay = `${l.title} ${l.model} ${l.chassis}`;
  return NAMEPLATES.some(([, slug, re]) => slugs.has(slug) && re.test(hay));
};
const platesFromHash = () => {
  try {
    const raw = decodeURIComponent(window.location.hash.slice(1));
    const valid = new Set(NAMEPLATES.map(([, slug]) => slug));
    return new Set(raw.split(",").map((s) => s.trim()).filter((s) => valid.has(s)));
  } catch { return new Set(); }
};

const ERAS = [1980, 1990, 2000];
function FilterSheet({ open, onClose, filters, setFilters, matchCount, listings }) {
  const [copied, setCopied] = useState(false);
  if (!open) return null;
  const chip = (active) => ({
    padding: "9px 16px", borderRadius: 20, cursor: "pointer", ...body, fontSize: 13.5, fontWeight: 600,
    color: active ? T.bg : T.ink, background: active ? T.ink : "rgba(255,255,255,0.06)",
    border: `1px solid ${active ? T.ink : T.glassBrd}`, transition: "all 0.15s ease",
  });
  const toggleEra = (d) => setFilters((f) => {
    const eras = new Set(f.eras); eras.has(d) ? eras.delete(d) : eras.add(d);
    return { ...f, eras };
  });
  const togglePlate = (slug) => setFilters((f) => {
    const plates = new Set(f.plates); plates.has(slug) ? plates.delete(slug) : plates.add(slug);
    return { ...f, plates };
  });
  const plateCount = (re) => listings.reduce((n, l) => n + (re.test(`${l.title} ${l.model} ${l.chassis}`) ? 1 : 0), 0);
  const shareFilter = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${[...filters.plates].join(",")}`;
    try { await navigator.clipboard.writeText(url); } catch { /* http fallback below */ }
    track("share_feed");
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <BottomSheet onClose={onClose} style={{ padding: "22px 22px 28px" }}>
        <h3 style={{ ...display(900), fontSize: 20, color: T.ink, margin: "0 0 20px" }}>Tune the feed</h3>

        <div style={{ ...mono, fontSize: 10.5, letterSpacing: "0.2em", color: T.faint, marginBottom: 10 }}>NAMEPLATE</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {NAMEPLATES.map(([label, slug, re]) => {
            const n = plateCount(re);
            if (!n && !filters.plates.has(slug)) return null;
            return (
              <button key={slug} style={chip(filters.plates.has(slug))} onClick={() => togglePlate(slug)}>
                {label} <span style={{ ...mono, fontSize: 10.5, opacity: 0.55 }}>{n}</span>
              </button>
            );
          })}
        </div>
        {filters.plates.size > 0 && (
          <button onClick={shareFilter} style={{
            marginTop: 12, padding: "10px 16px", borderRadius: 14, cursor: "pointer", ...mono, fontSize: 11.5,
            letterSpacing: "0.08em", color: copied ? T.save : T.dim, background: "rgba(255,255,255,0.05)",
            border: `1px solid ${copied ? "rgba(57,217,138,0.45)" : T.glassBrd}`,
          }}>
            {copied ? "LINK COPIED — TEXT IT TO A FRIEND ✓" : "⇪ SHARE THIS FEED"}
          </button>
        )}

        <div style={{ ...mono, fontSize: 10.5, letterSpacing: "0.2em", color: T.faint, margin: "24px 0 10px" }}>BUDGET CEILING</div>
        <div style={{ ...display(800), fontSize: 24, color: T.ink, marginBottom: 10 }}>
          {filters.maxPrice >= 200000 ? "No limit" : "$" + filters.maxPrice.toLocaleString()}
        </div>
        <input type="range" min={15000} max={200000} step={5000} value={filters.maxPrice}
          style={{ "--fill": `${((filters.maxPrice - 15000) / 185000) * 100}%` }}
          onChange={(e) => setFilters((f) => ({ ...f, maxPrice: Number(e.target.value) }))} />

        <div style={{ ...mono, fontSize: 10.5, letterSpacing: "0.2em", color: T.faint, margin: "24px 0 10px" }}>ERA</div>
        <div style={{ display: "flex", gap: 8 }}>
          {ERAS.map((d) => (
            <button key={d} style={chip(filters.eras.has(d))} onClick={() => toggleEra(d)}>’{String(d).slice(2)}s</button>
          ))}
        </div>

        <div style={{ ...mono, fontSize: 10.5, letterSpacing: "0.2em", color: T.faint, margin: "24px 0 10px" }}>GEARBOX</div>
        <div style={{ display: "flex", gap: 8 }}>
          {["Any", "Manual only"].map((g) => (
            <button key={g} style={chip(filters.gearbox === g)} onClick={() => setFilters((f) => ({ ...f, gearbox: g }))}>{g}</button>
          ))}
        </div>

        <div style={{ ...mono, fontSize: 10.5, letterSpacing: "0.2em", color: T.faint, margin: "24px 0 10px" }}>STEERING</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={chip(!filters.rhdOnly)} onClick={() => setFilters((f) => ({ ...f, rhdOnly: false }))}>Any</button>
          <button style={chip(filters.rhdOnly)} onClick={() => setFilters((f) => ({ ...f, rhdOnly: true }))}>RHD only</button>
        </div>

        <button onClick={onClose} style={{
          width: "100%", marginTop: 26, padding: "15px 0", borderRadius: 16, cursor: "pointer",
          ...display(800), fontSize: 15, color: T.bg, background: T.ink, border: "none",
        }}>
          Show {matchCount} car{matchCount === 1 ? "" : "s"}
        </button>
    </BottomSheet>
  );
}

/* ---------------- saved (garage) view ---------------- */

function Garage({ saved, passed, onRemove, onOpen }) {
  const [bucket, setBucket] = useState("saved"); // "saved" | "passed"
  const [sort, setSort] = useState("recent");
  const source = bucket === "saved" ? saved : passed;
  const rows = useMemo(() => {
    const arr = [...source];
    if (sort === "price↑") arr.sort((a, b) => a.price - b.price);
    if (sort === "price↓") arr.sort((a, b) => b.price - a.price);
    if (sort === "year") arr.sort((a, b) => a.year - b.year);
    return arr;
  }, [source, sort]);

  const seg = (active) => ({
    flex: 1, padding: "10px 0", borderRadius: 14, cursor: "pointer", ...display(800), fontSize: 13,
    letterSpacing: "0.04em", color: active ? T.bg : T.dim, background: active ? T.ink : "transparent",
    border: "none", transition: "all 0.2s ease",
  });

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "8px 16px 140px" }}>
      {/* Saved / Passed buckets — left-swipes aren't gone, they're parked here. */}
      <Glass radius={18} style={{ display: "flex", padding: 4, gap: 4, margin: "4px 0 12px" }}>
        <button style={seg(bucket === "saved")} onClick={() => setBucket("saved")}>Garage {saved.length ? `· ${saved.length}` : ""}</button>
        <button style={seg(bucket === "passed")} onClick={() => setBucket("passed")}>Passed {passed.length ? `· ${passed.length}` : ""}</button>
      </Glass>

      {rows.length === 0 ? (
        <div style={{ display: "grid", placeItems: "center", padding: "80px 24px", textAlign: "center" }}>
          <div>
            <div style={{ ...display(900), fontSize: 56, color: "rgba(255,255,255,0.08)", lineHeight: 1 }}>
              {bucket === "saved" ? "GARAGE" : "PASSED"}
            </div>
            <div style={{ ...display(800), fontSize: 18, color: T.ink, marginTop: 14 }}>
              {bucket === "saved" ? "The garage is empty" : "No passed cars yet"}
            </div>
            <p style={{ ...body, fontSize: 13.5, color: T.dim, maxWidth: 270, margin: "8px auto 0", lineHeight: 1.6 }}>
              {bucket === "saved"
                ? "Swipe right on a car in the feed and it parks here."
                : "Cars you swipe left land here, in case you change your mind later."}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, margin: "2px 0 14px" }}>
            {["recent", "price↑", "price↓", "year"].map((s) => (
              <button key={s} onClick={() => setSort(s)} style={{
                ...mono, fontSize: 11, letterSpacing: "0.06em", padding: "7px 12px", borderRadius: 16, cursor: "pointer",
                color: sort === s ? T.bg : T.dim, background: sort === s ? T.ink : "rgba(255,255,255,0.05)",
                border: `1px solid ${sort === s ? T.ink : T.glassBrd}`,
              }}>{s}</button>
            ))}
          </div>
          {rows.map((l) => (
            <Glass key={l.id} radius={20} style={{ padding: 14, marginBottom: 10, display: "flex", gap: 14, alignItems: "center", animation: "riseIn 0.3s ease both", cursor: "pointer" }} onClick={() => onOpen(l)}>
              <div style={{
                width: 58, height: 58, borderRadius: 15, flexShrink: 0, display: "grid", placeItems: "center", overflow: "hidden",
                background: `${l.image ? `url(${JSON.stringify(l.image)}) center/cover no-repeat, ` : ""}linear-gradient(150deg, ${l.paint.stops[0]}, ${l.paint.stops[1]}, ${l.paint.stops[2]})`,
                border: "1px solid rgba(255,255,255,0.14)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
                ...display(900), fontSize: 13, color: l.paint.darkInk ? "#14161C" : T.ink, letterSpacing: "-0.02em",
              }}>
                {l.image ? "" : l.chassis.slice(0, 5)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...display(800), fontSize: 15, color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {l.year} {l.model}
                </div>
                <div style={{ ...mono, fontSize: 11, color: T.dim, marginTop: 3 }}>
                  {fmtPrice(l.price)} · {fmtMiles(l.mileage)}
                </div>
              </div>
              {/* One action either way: put the car back in the feed. */}
              <button
                aria-label={`Return ${l.title} to the feed`}
                onClick={(e) => { e.stopPropagation(); onRemove(l.id); }}
                style={{
                  width: 34, height: 34, borderRadius: 17, display: "grid", placeItems: "center", cursor: "pointer",
                  color: T.faint, background: "rgba(255,255,255,0.05)", border: `1px solid ${T.glassBrd}`,
                }}
              >
                {bucket === "saved" ? <XIcon s={14} /> : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
                )}
              </button>
            </Glass>
          ))}
        </>
      )}
    </div>
  );
}

/* ---------------- app shell ---------------- */

export default function App() {
  const [liveListings, setLiveListings] = useState(() =>
    loadJSON(LS_LIVE, []).map((r) => normalize(r, 0, true))
  );
  const [user, setUser] = useState(() => loadJSON(LS_USER, null));
  const [accountOpen, setAccountOpen] = useState(false);
  const [swiped, setSwiped] = useState(() =>
    loadJSON(user?.sub ? `${LS_SWIPED}.${user.sub}` : LS_SWIPED, {})
  );
  const [tab, setTab] = useState("feed");
  const [detail, setDetail] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // plates seeds from the URL hash, so a shared jdmfeed.xyz/#land-cruiser
  // link opens the feed already tuned to that nameplate.
  const [filters, setFilters] = useState(() => ({ maxPrice: 200000, eras: new Set(), gearbox: "Any", rhdOnly: false, plates: platesFromHash() }));

  // Keep the URL shareable: the hash always mirrors the nameplate filter.
  useEffect(() => {
    const hash = [...filters.plates].join(",");
    try { window.history.replaceState(null, "", hash ? `#${hash}` : window.location.pathname + window.location.search); } catch { /* sandboxed */ }
  }, [filters.plates]);
  const [forced, setForced] = useState({ dir: null, n: 0 });
  const [swipeHistory, setSwipeHistory] = useState([]);
  const [sync, setSync] = useState("idle");
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const listings = useMemo(() => [...liveListings, ...SEED], [liveListings]);

  useEffect(() => {
    saveJSON(user?.sub ? `${LS_SWIPED}.${user.sub}` : LS_SWIPED, swiped);
  }, [swiped, user]);
  useEffect(() => {
    saveJSON(LS_LIVE, liveListings.map(({ paint, ...rest }) => rest));
  }, [liveListings]);

  const passesFilters = useCallback((l) =>
    (filters.maxPrice >= 200000 || l.price <= filters.maxPrice || l.price === 0) &&
    (filters.eras.size === 0 || filters.eras.has(decadeOf(l.year))) &&
    (filters.gearbox === "Any" || /manual/i.test(l.transmission)) &&
    (!filters.rhdOnly || l.rhd) &&
    plateMatches(l, filters.plates),
  [filters]);

  const deck = useMemo(() => listings.filter((l) => !dirOf(swiped[l.id]) && passesFilters(l)), [listings, swiped, passesFilters]);
  const saved = useMemo(() => listings.filter((l) => dirOf(swiped[l.id]) === "right"), [listings, swiped]);
  const passed = useMemo(() => listings.filter((l) => dirOf(swiped[l.id]) === "left"), [listings, swiped]);

  const showToast = (msg, color) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, color });
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const openDetail = useCallback((l) => { setDetail(l); track("view_details"); }, []);

  const handleSwipe = useCallback((id, dir) => {
    setSwiped((s) => ({ ...s, [id]: mark(dir) }));
    track(dir === "right" ? "save_car" : "pass_car");
    setSwipeHistory((h) => [...h.slice(-30), id]);
    if (dir === "right") {
      const l = listings.find((x) => x.id === id);
      showToast(`${l ? l.chassis : "Car"} parked in the garage`, T.save);
    }
  }, [listings]);

  /* Two-phase swipe: the card announces its fly-out immediately (the next
     card promotes with zero dead time), then commits once it's off-screen. */
  const [exiting, setExiting] = useState([]); // [{ id, dir }] cards mid-flight
  const beginSwipe = useCallback((id, dir) => {
    setExiting((ex) => [...ex, { id, dir }]);
    setForced(null); // consumed — a promoted card must not replay it
  }, []);
  const commitSwipe = useCallback((id, dir) => {
    setExiting((ex) => ex.filter((e) => e.id !== id));
    handleSwipe(id, dir);
  }, [handleSwipe]);

  // Cards on screen: any still flying off, then the next three waiting.
  const stack = useMemo(() => {
    const exIds = new Set(exiting.map((e) => e.id));
    const flying = exiting.map((e) => deck.find((l) => l.id === e.id)).filter(Boolean);
    return [...flying, ...deck.filter((l) => !exIds.has(l.id)).slice(0, 3)];
  }, [deck, exiting]);
  const topListing = useMemo(
    () => stack.find((l) => !exiting.some((e) => e.id === l.id)) || deck[0] || null,
    [stack, exiting, deck],
  );

  const undoSwipe = useCallback(() => {
    setSwipeHistory((h) => {
      if (!h.length) return h;
      const id = h[h.length - 1];
      setSwiped((s) => ({ ...s, [id]: mark("none") }));
      const l = listings.find((x) => x.id === id);
      showToast(`${l ? l.chassis : "Card"} is back on top`, T.dim);
      return h.slice(0, -1);
    });
  }, [listings]);

  const toggleSave = (l) => {
    setSwiped((s) => ({ ...s, [l.id]: mark(dirOf(s[l.id]) === "right" ? "none" : "right") }));
    setDetail(null);
  };

  const refresh = useCallback(async (manual) => {
    setSync("loading");
    try {
      const fresh = await fetchLiveListings();
      setLiveListings((prev) => {
        if (manual) {
          const known = new Set(prev.map((l) => (l.title + l.price).toLowerCase()));
          const add = fresh.filter((l) => !known.has((l.title + l.price).toLowerCase())).length;
          showToast(add ? `${add} new live listing${add > 1 ? "s" : ""} in the feed` : `Feed is current — ${fresh.length} live listings`, add ? T.save : T.dim);
        }
        return fresh;
      });
      setSync("done");
    } catch {
      setSync("error");
      if (manual) showToast("Live listings aren't published yet — showing the demo deck", T.pass);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { refresh(false); }, [refresh]);

  const doSync = () => { if (sync !== "loading") refresh(true); };

  const resetDeck = () => { setSwiped((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, dirOf(v) === "right" ? v : mark("none")]))); };

  /* ---- garage sync wiring ---- */
  const [garageSync, setGarageSync] = useState("off"); // off | on | error
  const driveFileId = useRef(null);
  const pushTimer = useRef(null);
  const syncedOnce = useRef(false);

  const syncFromDrive = useCallback(async (interactive) => {
    const tok = await getDriveToken(interactive);
    if (!tok) { setGarageSync("error"); return; }
    try {
      if (!driveFileId.current) driveFileId.current = await driveFindFile(tok);
      if (driveFileId.current) {
        const remote = await driveRead(tok, driveFileId.current);
        // Local wins ties; otherwise last writer (by timestamp) wins per car.
        setSwiped((local) => mergeSwiped(remote?.swiped || {}, local));
      }
      setGarageSync("on");
      if (!syncedOnce.current) { syncedOnce.current = true; showToast("Garage synced with your Google account", T.save); }
    } catch {
      setGarageSync("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Already signed in from a previous visit → try a silent sync on load.
  useEffect(() => {
    if (user) syncFromDrive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Returning to the tab → pick up swipes made on other devices.
  useEffect(() => {
    const onVis = () => { if (!document.hidden && user && garageSync === "on") syncFromDrive(false); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [user, garageSync, syncFromDrive]);

  // Every swipe-map change pushes to Drive (debounced) while sync is on.
  useEffect(() => {
    if (!user || garageSync !== "on") return undefined;
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(async () => {
      const tok = await getDriveToken(false);
      if (!tok) return;
      try {
        driveFileId.current = await driveWrite(tok, driveFileId.current, { swiped, updated: Date.now() });
      } catch { /* transient — next change retries */ }
    }, 1500);
    return () => clearTimeout(pushTimer.current);
  }, [swiped, user, garageSync]);

  const handleSignedIn = useCallback((profile) => {
    // Carry anonymous saves into the account on first sign-in.
    const anon = loadJSON(LS_SWIPED, {});
    const own = loadJSON(`${LS_SWIPED}.${profile.sub}`, {});
    setSwiped(mergeSwiped(anon, own));
    setUser(profile);
    saveJSON(LS_USER, profile);
    setAccountOpen(false);
    showToast(`Signed in as ${profile.name || profile.email}`, T.save);
    track("login");
    syncFromDrive(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignOut = () => {
    resetDriveAuth();
    setGarageSync("off");
    driveFileId.current = null;
    try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* not loaded */ }
    try { localStorage.removeItem(LS_USER); } catch { /* blocked */ }
    setUser(null);
    setSwiped(loadJSON(LS_SWIPED, {}));
    setAccountOpen(false);
    showToast("Signed out", T.dim);
  };

  /* Keyboard: ← pass · → save · ↑/Enter details · Z/Backspace undo · Esc close */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { setDetail(null); setFiltersOpen(false); return; }
      if (detail || filtersOpen || tab !== "feed") return;
      if (e.key === "ArrowLeft") setForced((f) => ({ dir: "left", n: (f?.n || 0) + 1 }));
      else if (e.key === "ArrowRight") setForced((f) => ({ dir: "right", n: (f?.n || 0) + 1 }));
      else if ((e.key === "ArrowUp" || e.key === "Enter") && topListing) setDetail(topListing);
      else if (e.key === "z" || e.key === "Backspace") undoSwipe();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, filtersOpen, tab, topListing, undoSwipe]);

  return (
    <div style={{ height: "100dvh", background: T.bg, color: T.ink, overflow: "hidden", position: "relative", ...body }}>
      <style>{FONT}</style>

      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `radial-gradient(60% 40% at 50% -6%, rgba(110,91,196,0.16), transparent 65%), radial-gradient(50% 35% at 85% 105%, rgba(17,115,200,0.10), transparent 60%)` }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: GRAIN }} />

      <div style={{ maxWidth: 480, height: "100%", margin: "0 auto", display: "flex", flexDirection: "column", position: "relative" }}>

        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "calc(14px + env(safe-area-inset-top)) 18px 12px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ ...display(900), fontSize: 22, letterSpacing: "0.02em" }}>PopJDM</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <IconBtn label="Sync live listings from the web" size={40} onClick={doSync}
              border={sync === "loading" ? "rgba(57,217,138,0.5)" : undefined}
              style={sync === "loading" ? { color: T.save } : undefined}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                style={sync === "loading" ? { animation: "spinDash 0.9s linear infinite" } : undefined}>
                <path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" />
              </svg>
            </IconBtn>
            <IconBtn label="Filters" size={40} onClick={() => setFiltersOpen(true)}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
            </IconBtn>
            <IconBtn label={user ? "Account" : "Sign in"} size={40} onClick={() => setAccountOpen(true)}
              style={user?.picture ? { padding: 0, overflow: "hidden" } : undefined}>
              {user?.picture ? (
                <img src={user.picture} alt="" referrerPolicy="no-referrer"
                  style={{ width: 40, height: 40, borderRadius: 20, objectFit: "cover" }} />
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" /></svg>
              )}
            </IconBtn>
          </div>
        </header>

        <main style={{ flex: 1, position: "relative", minHeight: 0 }}>
          {tab === "feed" ? (
            <div style={{ position: "absolute", inset: "4px 16px 128px" }}>
              {deck.length === 0 ? (
                <Glass radius={30} style={{ height: "100%", display: "grid", placeItems: "center", textAlign: "center", padding: 28 }}>
                  <div>
                    <div style={{ ...display(900), fontSize: 56, color: "rgba(255,255,255,0.08)", lineHeight: 1 }}>EMPTY</div>
                    <div style={{ ...display(800), fontSize: 18, marginTop: 14 }}>Deck's empty</div>
                    <p style={{ ...body, fontSize: 13.5, color: T.dim, maxWidth: 280, margin: "8px auto 18px", lineHeight: 1.6 }}>
                      Sync live listings from the web, loosen your filters, or bring back the cars you passed on.
                    </p>
                    <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                      <button onClick={doSync} style={{ padding: "12px 20px", borderRadius: 14, cursor: "pointer", ...display(800), fontSize: 13.5, color: T.bg, background: T.ink, border: "none" }}>
                        {sync === "loading" ? "Searching the web…" : "Sync live listings"}
                      </button>
                      <button onClick={resetDeck} style={{ padding: "12px 20px", borderRadius: 14, cursor: "pointer", ...display(800), fontSize: 13.5, color: T.ink, background: "rgba(255,255,255,0.07)", border: `1px solid ${T.glassBrd}` }}>
                        Reshuffle passes
                      </button>
                    </div>
                  </div>
                </Glass>
              ) : (
                stack.map((l, i) => {
                  const ex = exiting.find((e) => e.id === l.id);
                  const idx = ex ? 0 : i - exiting.length;
                  return (
                    <SwipeCard key={l.id} listing={l} isTop={!ex && idx === 0} stackIndex={ex ? 0 : idx}
                      exiting={ex ? ex.dir : null} forced={!ex && idx === 0 ? forced : null}
                      onSwipeStart={beginSwipe} onSwipeCommit={commitSwipe} onOpen={openDetail} />
                  );
                }).reverse()
              )}
            </div>
          ) : (
            <Garage saved={saved} passed={passed} onOpen={openDetail}
              onRemove={(id) => setSwiped((s) => ({ ...s, [id]: mark("none") }))} />
          )}
        </main>

        <Glass radius={30} style={{
          position: "absolute", left: 16, right: 16, bottom: `calc(14px + env(safe-area-inset-bottom))`,
          padding: "10px 14px", display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center",
          background: "rgba(14,16,23,0.62)", zIndex: 30,
        }}>
          <button onClick={() => setTab("feed")} aria-label="Feed" style={{
            border: "none", background: "none", cursor: "pointer", padding: "6px 10px", justifySelf: "start",
            ...display(800), fontSize: 13, letterSpacing: "0.06em",
            color: tab === "feed" ? T.ink : T.faint, borderBottom: `2px solid ${tab === "feed" ? T.ink : "transparent"}`,
          }}>FEED</button>

          {tab === "feed" && deck.length > 0 ? (
            <div style={{ display: "flex", gap: 18, alignItems: "center", justifySelf: "center" }}>
              <IconBtn label="Pass on this car" color={T.pass} border="rgba(255,90,72,0.45)"
                style={{ background: "rgba(255,90,72,0.12)" }}
                onClick={() => setForced((f) => ({ dir: "left", n: (f?.n || 0) + 1 }))}><XIcon /></IconBtn>
              <IconBtn label="Save this car" color={T.save} border="rgba(57,217,138,0.45)"
                style={{ background: "rgba(57,217,138,0.12)" }}
                onClick={() => setForced((f) => ({ dir: "right", n: (f?.n || 0) + 1 }))}><HeartIcon /></IconBtn>
            </div>
          ) : (
            <div style={{ ...mono, fontSize: 10.5, letterSpacing: "0.22em", color: T.faint, justifySelf: "center" }}>
              {tab === "feed" ? "" : `${saved.length} SAVED`}
            </div>
          )}

          <button onClick={() => setTab("garage")} aria-label="Garage — saved cars" style={{
            border: "none", background: "none", cursor: "pointer", padding: "6px 10px", position: "relative", justifySelf: "end",
            ...display(800), fontSize: 13, letterSpacing: "0.06em",
            color: tab === "garage" ? T.ink : T.faint, borderBottom: `2px solid ${tab === "garage" ? T.ink : "transparent"}`,
          }}>
            GARAGE
            {saved.length > 0 && (
              <span style={{ position: "absolute", top: -2, right: -8, minWidth: 16, height: 16, borderRadius: 8, background: T.save, color: T.bg, ...mono, fontSize: 9.5, fontWeight: 500, display: "grid", placeItems: "center", padding: "0 4px" }}>
                {saved.length}
              </span>
            )}
          </button>
        </Glass>

        {toast && (
          <div style={{
            position: "absolute", bottom: 110, left: "50%", zIndex: 50, animation: "pillIn 0.25s ease both",
            transform: "translateX(-50%)", padding: "10px 18px", borderRadius: 22, whiteSpace: "nowrap",
            background: "rgba(14,16,23,0.85)", backdropFilter: "blur(16px)", border: `1px solid ${T.glassBrd}`,
            boxShadow: T.glassHi, ...body, fontSize: 13, fontWeight: 600, color: toast.color,
          }}>
            {toast.msg}
          </div>
        )}
      </div>

      <DetailSheet listing={detail} onClose={() => setDetail(null)}
        saved={detail ? swiped[detail.id] === "right" : false} onToggleSave={toggleSave} />
      <AccountSheet open={accountOpen} onClose={() => setAccountOpen(false)} user={user}
        onSignedIn={handleSignedIn} onSignOut={handleSignOut} savedCount={saved.length}
        garageSync={garageSync} onSyncNow={() => syncFromDrive(true)} />
      <FilterSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} listings={listings}
        filters={filters} setFilters={setFilters}
        matchCount={listings.filter((l) => !dirOf(swiped[l.id]) && passesFilters(l)).length} />
    </div>
  );
}
