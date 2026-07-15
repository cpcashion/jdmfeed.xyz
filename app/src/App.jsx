import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";

/* ============================================================
   TOUGE 峠 — jdmfeed.xyz
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
  glassBg: "rgba(18,20,28,0.55)",
  glassBrd: "rgba(255,255,255,0.10)",
  glassHi: "inset 0 1px 0 rgba(255,255,255,0.14)",
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
  transmission: raw.transmission || "Manual",
  engine: raw.engine || "—",
  drivetrain: raw.drivetrain || "—",
  location: raw.location || "United States",
  source: raw.source || (live ? "Web" : "Demo data"),
  source_url: raw.source_url || "",
  image: raw.image_url || raw.image || "",
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

/* ---------------- shared glass surface ---------------- */

const Glass = ({ children, style, radius = 22, ...rest }) => (
  <div
    {...rest}
    style={{
      background: T.glassBg,
      backdropFilter: "blur(22px) saturate(1.6)",
      WebkitBackdropFilter: "blur(22px) saturate(1.6)",
      border: `1px solid ${T.glassBrd}`,
      boxShadow: `${T.glassHi}, 0 12px 40px rgba(0,0,0,0.45)`,
      borderRadius: radius,
      ...style,
    }}
  >
    {children}
  </div>
);

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

const THRESH = 96;

const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

function SwipeCard({ listing, isTop, stackIndex, forced, onSwipe, onOpen }) {
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [exit, setExit] = useState(null);
  const [imgOk, setImgOk] = useState(true);
  const [cutOk, setCutOk] = useState(true);
  const start = useRef({ x: 0, y: 0, t: 0, moved: false });
  const p = listing.paint;
  const showCutout = Boolean(listing.cutout) && cutOk;
  // The masked full photo is the fallback when no cutout exists yet.
  const showPhoto = !showCutout && Boolean(listing.image) && imgOk;

  const fly = useCallback((dir) => {
    setExit(dir);
    buzz(12);
    setTimeout(() => onSwipe(listing.id, dir), 300);
  }, [listing.id, onSwipe]);

  useEffect(() => {
    if (isTop && forced && forced.n > 0) fly(forced.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forced && forced.n]);

  const onDown = (e) => {
    if (!isTop || exit) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false };
    setDrag({ x: 0, y: 0, active: true });
  };
  const onMove = (e) => {
    if (!drag.active || exit) return;
    const dx = e.clientX - start.current.x, dy = e.clientY - start.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 10) start.current.moved = true;
    setDrag({ x: dx, y: dy * 0.5, active: true });
  };
  const onUp = () => {
    if (!drag.active || exit) return;
    const vel = Math.abs(drag.x) / Math.max(Date.now() - start.current.t, 1);
    if (drag.x > THRESH || (drag.x > 40 && vel > 0.55)) fly("right");
    else if (drag.x < -THRESH || (drag.x < -40 && vel > 0.55)) fly("left");
    else {
      const vertical = Math.abs(drag.y) > 55 && Math.abs(drag.x) < 50;
      setDrag({ x: 0, y: 0, active: false });
      // Tap or a deliberate vertical swipe opens the detail sheet.
      if (!start.current.moved || vertical) {
        buzz(6);
        onOpen(listing);
      }
    }
  };
  const onCancel = () => {
    if (!drag.active || exit) return;
    setDrag({ x: 0, y: 0, active: false });
  };

  const x = exit ? (exit === "right" ? 640 : -640) : drag.x;
  const y = exit ? drag.y - 60 : drag.y;
  const rot = x * 0.055;
  const saveOp = Math.min(Math.max(x / THRESH, 0), 1);
  const passOp = Math.min(Math.max(-x / THRESH, 0), 1);
  const behind = isTop ? 0 : stackIndex;
  const ink = p.darkInk ? "#14161C" : T.ink;

  return (
    <div
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
      style={{
        position: "absolute", inset: 0, touchAction: "none",
        transform: `translate(${x}px, ${y + behind * 12}px) rotate(${rot}deg) scale(${1 - behind * 0.045})`,
        transition: drag.active ? "none" : "transform 0.32s cubic-bezier(0.2, 0.9, 0.3, 1.05), opacity 0.3s ease",
        opacity: exit ? 0 : 1 - behind * 0.18,
        zIndex: 10 - behind,
        cursor: isTop ? "grab" : "default",
      }}
    >
      <div style={{
        position: "relative", width: "100%", height: "100%", borderRadius: 30, overflow: "hidden",
        background: `linear-gradient(158deg, ${p.stops[0]} 0%, ${p.stops[1]} 52%, ${p.stops[2]} 100%)`,
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18), 0 24px 70px rgba(0,0,0,0.6)",
      }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(90% 70% at 78% 8%, ${p.glow}55, transparent 60%)` }} />
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 20% 110%, rgba(0,0,0,0.55), transparent 55%)" }} />
        <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, mixBlendMode: "overlay" }} />

        <div aria-hidden style={{
          position: "absolute", top: "19%", left: -8, right: 0, ...display(900),
          fontSize: "clamp(88px, 27vw, 156px)", lineHeight: 0.84, color: ink,
          opacity: p.darkInk ? 0.92 : 0.96, letterSpacing: "-0.04em", whiteSpace: "nowrap",
          textShadow: p.darkInk ? "none" : "0 6px 40px rgba(0,0,0,0.35)", paddingLeft: 22,
        }}>
          <div style={{ ...mono, fontSize: 12, letterSpacing: "0.34em", opacity: 0.75, marginBottom: 12, fontWeight: 500 }}>
            {listing.make.toUpperCase()} · {String(listing.year)} · 日本製
          </div>
          {listing.chassis}
        </div>

        {showCutout && (
          <>
            {/* Soft ground shadow so the floating car feels planted on the card.
                Sits just above the info glass so the car reads as floating
                clear of the panel rather than tucked behind it. */}
            <div aria-hidden style={{
              position: "absolute", left: "16%", right: "16%", bottom: "26%", height: 28,
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
                position: "absolute", left: "1%", right: "1%", bottom: "24%", width: "98%",
                maxHeight: "56%", objectFit: "contain", objectPosition: "bottom center",
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

        <div style={{ position: "absolute", top: 26, left: 22, opacity: saveOp, transform: `rotate(-9deg) scale(${0.9 + saveOp * 0.15})`, ...display(900), fontSize: 30, color: T.save, border: `3px solid ${T.save}`, borderRadius: 12, padding: "4px 14px", background: "rgba(0,0,0,0.25)", backdropFilter: "blur(6px)" }}>
          SAVE <span style={{ ...mono, fontSize: 13, fontWeight: 500 }}>保存</span>
        </div>
        <div style={{ position: "absolute", top: 26, right: 22, opacity: passOp, transform: `rotate(9deg) scale(${0.9 + passOp * 0.15})`, ...display(900), fontSize: 30, color: T.pass, border: `3px solid ${T.pass}`, borderRadius: 12, padding: "4px 14px", background: "rgba(0,0,0,0.25)", backdropFilter: "blur(6px)" }}>
          PASS <span style={{ ...mono, fontSize: 13, fontWeight: 500 }}>パス</span>
        </div>

        <Glass radius={22} style={{ position: "absolute", left: 14, right: 14, bottom: 14, padding: "16px 18px 14px" }}>
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
          <div style={{ ...mono, fontSize: 12, color: T.dim, marginTop: 8, display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
            <span>{fmtMiles(listing.mileage)}</span>
            <span>{listing.transmission}</span>
            <span>{listing.drivetrain}</span>
          </div>
          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ ...body, fontSize: 12.5, color: T.faint }}>{listing.location}</span>
            <span style={{
              ...mono, fontSize: 10.5, letterSpacing: "0.08em", padding: "4px 9px", borderRadius: 20,
              border: `1px solid ${listing.live ? "rgba(57,217,138,0.45)" : T.glassBrd}`,
              color: listing.live ? T.save : T.faint,
              background: listing.live ? "rgba(57,217,138,0.08)" : "rgba(255,255,255,0.04)",
            }}>
              {listing.live ? "● LIVE · " : ""}{listing.source.toUpperCase()}
            </span>
          </div>
        </Glass>
      </div>
    </div>
  );
}

/* ---------------- detail sheet ---------------- */

function DetailSheet({ listing, onClose, saved, onToggleSave }) {
  const [dy, setDy] = useState(0); // live drag offset while pulling the sheet down
  const [closing, setClosing] = useState(false);
  const drag = useRef(null); // { startY } while a pull is in progress

  // Reset drag state whenever a new listing opens the sheet.
  useEffect(() => { setDy(0); setClosing(false); drag.current = null; }, [listing]);

  const dismiss = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 240); // let the slide-out finish before unmounting
  }, [onClose]);

  const onHandleDown = (e) => {
    drag.current = { startY: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onHandleMove = (e) => {
    if (!drag.current) return;
    setDy(Math.max(0, e.clientY - drag.current.startY)); // only downward
  };
  const onHandleUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (dy > 130) dismiss(); // pulled far enough → close
    else setDy(0); // spring back
  };

  if (!listing) return null;
  const p = listing.paint;
  const specs = [
    ["Engine", listing.engine], ["Drivetrain", listing.drivetrain],
    ["Transmission", listing.transmission], ["Mileage", fmtMiles(listing.mileage)],
    ["Chassis", listing.chassis], ["Paint", p.name],
    ["Location", listing.location], ["Source", listing.source],
  ];
  const dragging = drag.current != null;
  return (
    <div onClick={dismiss} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", display: "flex", alignItems: "flex-end", justifyContent: "center", opacity: closing ? 0 : 1, transition: "opacity 0.24s ease" }}>
      <Glass onClick={(e) => e.stopPropagation()} radius={28} style={{
        width: "min(560px, 100%)", maxHeight: "88%", overflowY: "auto", margin: "0 8px", padding: "22px 22px 26px",
        background: "rgba(14,16,23,0.82)",
        transform: closing ? "translateY(110%)" : `translateY(${dy}px)`,
        animation: closing ? "none" : "riseIn 0.32s cubic-bezier(0.2,0.9,0.3,1) both",
        transition: closing ? "transform 0.24s cubic-bezier(0.4,0,1,1)" : (dragging ? "none" : "transform 0.28s cubic-bezier(0.2,0.9,0.3,1)"),
      }}>
        {/* Grab handle — pull down to dismiss. touchAction:none so the browser
            hands the vertical gesture to us instead of scrolling the sheet. */}
        <div
          onPointerDown={onHandleDown} onPointerMove={onHandleMove}
          onPointerUp={onHandleUp} onPointerCancel={onHandleUp}
          style={{ padding: "2px 0 14px", margin: "-4px 0 6px", cursor: "grab", touchAction: "none" }}
        >
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.22)", margin: "0 auto" }} />
        </div>
        {listing.image ? (
          <img
            src={listing.image} alt={listing.title}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
            style={{ width: "100%", maxHeight: 260, objectFit: "cover", borderRadius: 18, marginBottom: 16, border: `1px solid ${T.glassBrd}` }}
          />
        ) : null}
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
      </Glass>
    </div>
  );
}

/* ---------------- account sheet ---------------- */

function AccountSheet({ open, onClose, user, onSignedIn, onSignOut, savedCount }) {
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
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <Glass onClick={(e) => e.stopPropagation()} radius={28} style={{ width: "min(560px,100%)", margin: "0 8px", padding: "22px 22px 30px", animation: "riseIn 0.3s ease both", background: "rgba(14,16,23,0.85)", textAlign: "center" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.22)", margin: "0 auto 20px" }} />
        {user ? (
          <>
            {user.picture ? (
              <img src={user.picture} alt="" referrerPolicy="no-referrer" style={{ width: 64, height: 64, borderRadius: 32, border: `2px solid ${T.glassBrd}`, marginBottom: 12 }} />
            ) : null}
            <div style={{ ...display(800), fontSize: 20, color: T.ink }}>{user.name || user.email}</div>
            {user.email ? <div style={{ ...body, fontSize: 13, color: T.dim, marginTop: 4 }}>{user.email}</div> : null}
            <div style={{ ...mono, fontSize: 11.5, letterSpacing: "0.12em", color: T.faint, margin: "14px 0 20px" }}>
              {savedCount} CAR{savedCount === 1 ? "" : "S"} IN THE GARAGE
            </div>
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
      </Glass>
    </div>
  );
}

/* ---------------- filter sheet ---------------- */

const ERAS = [1980, 1990, 2000];
function FilterSheet({ open, onClose, filters, setFilters, matchCount }) {
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
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <Glass onClick={(e) => e.stopPropagation()} radius={28} style={{ width: "min(560px,100%)", margin: "0 8px", padding: "22px 22px 28px", animation: "riseIn 0.3s ease both", background: "rgba(14,16,23,0.85)" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.22)", margin: "0 auto 20px" }} />
        <h3 style={{ ...display(900), fontSize: 20, color: T.ink, margin: "0 0 20px" }}>Tune the feed</h3>

        <div style={{ ...mono, fontSize: 10.5, letterSpacing: "0.2em", color: T.faint, marginBottom: 10 }}>BUDGET CEILING</div>
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

        <button onClick={onClose} style={{
          width: "100%", marginTop: 26, padding: "15px 0", borderRadius: 16, cursor: "pointer",
          ...display(800), fontSize: 15, color: T.bg, background: T.ink, border: "none",
        }}>
          Show {matchCount} car{matchCount === 1 ? "" : "s"}
        </button>
      </Glass>
    </div>
  );
}

/* ---------------- saved (garage) view ---------------- */

function Garage({ saved, onRemove, onOpen }) {
  const [sort, setSort] = useState("recent");
  const rows = useMemo(() => {
    const arr = [...saved];
    if (sort === "price↑") arr.sort((a, b) => a.price - b.price);
    if (sort === "price↓") arr.sort((a, b) => b.price - a.price);
    if (sort === "year") arr.sort((a, b) => a.year - b.year);
    return arr;
  }, [saved, sort]);

  if (!saved.length) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 32, textAlign: "center" }}>
        <div>
          <div style={{ ...display(900), fontSize: 64, color: "rgba(255,255,255,0.08)", lineHeight: 1 }}>車庫</div>
          <div style={{ ...display(800), fontSize: 18, color: T.ink, marginTop: 14 }}>The garage is empty</div>
          <p style={{ ...body, fontSize: 13.5, color: T.dim, maxWidth: 260, margin: "8px auto 0", lineHeight: 1.6 }}>
            Swipe right on a car in the feed and it parks here.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: "8px 16px 140px" }}>
      <div style={{ display: "flex", gap: 8, margin: "6px 0 14px" }}>
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
          <button aria-label={`Remove ${l.title} from garage`} onClick={(e) => { e.stopPropagation(); onRemove(l.id); }} style={{
            width: 34, height: 34, borderRadius: 17, display: "grid", placeItems: "center", cursor: "pointer",
            color: T.faint, background: "rgba(255,255,255,0.05)", border: `1px solid ${T.glassBrd}`,
          }}>
            <XIcon s={14} />
          </button>
        </Glass>
      ))}
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
  const [filters, setFilters] = useState({ maxPrice: 200000, eras: new Set(), gearbox: "Any" });
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
    (filters.gearbox === "Any" || /manual/i.test(l.transmission)),
  [filters]);

  const deck = useMemo(() => listings.filter((l) => !swiped[l.id] && passesFilters(l)), [listings, swiped, passesFilters]);
  const saved = useMemo(() => listings.filter((l) => swiped[l.id] === "right"), [listings, swiped]);

  const showToast = (msg, color) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, color });
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const handleSwipe = useCallback((id, dir) => {
    setSwiped((s) => ({ ...s, [id]: dir }));
    setSwipeHistory((h) => [...h.slice(-30), id]);
    if (dir === "right") {
      const l = listings.find((x) => x.id === id);
      showToast(`${l ? l.chassis : "Car"} parked in the garage`, T.save);
    }
  }, [listings]);

  const undoSwipe = useCallback(() => {
    setSwipeHistory((h) => {
      if (!h.length) return h;
      const id = h[h.length - 1];
      setSwiped((s) => { const n = { ...s }; delete n[id]; return n; });
      const l = listings.find((x) => x.id === id);
      showToast(`${l ? l.chassis : "Card"} is back on top`, T.dim);
      return h.slice(0, -1);
    });
  }, [listings]);

  const toggleSave = (l) => {
    setSwiped((s) => {
      const next = { ...s };
      if (next[l.id] === "right") delete next[l.id];
      else next[l.id] = "right";
      return next;
    });
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

  const resetDeck = () => { setSwiped((s) => Object.fromEntries(Object.entries(s).filter(([, d]) => d === "right"))); };

  const handleSignedIn = useCallback((profile) => {
    // Carry anonymous saves into the account on first sign-in.
    const anon = loadJSON(LS_SWIPED, {});
    const own = loadJSON(`${LS_SWIPED}.${profile.sub}`, {});
    setSwiped({ ...anon, ...own });
    setUser(profile);
    saveJSON(LS_USER, profile);
    setAccountOpen(false);
    showToast(`Signed in as ${profile.name || profile.email}`, T.save);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignOut = () => {
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
      if (e.key === "ArrowLeft") setForced((f) => ({ dir: "left", n: f.n + 1 }));
      else if (e.key === "ArrowRight") setForced((f) => ({ dir: "right", n: f.n + 1 }));
      else if ((e.key === "ArrowUp" || e.key === "Enter") && deck[0]) setDetail(deck[0]);
      else if (e.key === "z" || e.key === "Backspace") undoSwipe();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, filtersOpen, tab, deck, undoSwipe]);

  return (
    <div style={{ height: "100dvh", background: T.bg, color: T.ink, overflow: "hidden", position: "relative", ...body }}>
      <style>{FONT}</style>

      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", background: `radial-gradient(60% 40% at 50% -6%, rgba(110,91,196,0.16), transparent 65%), radial-gradient(50% 35% at 85% 105%, rgba(17,115,200,0.10), transparent 60%)` }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: GRAIN }} />

      <div style={{ maxWidth: 480, height: "100%", margin: "0 auto", display: "flex", flexDirection: "column", position: "relative" }}>

        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "calc(14px + env(safe-area-inset-top)) 18px 12px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ ...display(900), fontSize: 22, letterSpacing: "0.02em" }}>TOUGE</span>
            <span style={{ fontSize: 17, opacity: 0.85 }}>峠</span>
            <span style={{ ...mono, fontSize: 9.5, letterSpacing: "0.28em", color: T.faint }}>JDM FEED · USA</span>
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
                    <div style={{ ...display(900), fontSize: 56, color: "rgba(255,255,255,0.08)", lineHeight: 1 }}>完売</div>
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
                deck.slice(0, 3).map((l, i) => (
                  <SwipeCard key={l.id} listing={l} isTop={i === 0} stackIndex={i}
                    forced={i === 0 ? forced : null} onSwipe={handleSwipe} onOpen={setDetail} />
                )).reverse()
              )}
            </div>
          ) : (
            <Garage saved={saved} onOpen={setDetail}
              onRemove={(id) => setSwiped((s) => { const n = { ...s }; delete n[id]; return n; })} />
          )}
        </main>

        <Glass radius={30} style={{
          position: "absolute", left: 16, right: 16, bottom: `calc(14px + env(safe-area-inset-bottom))`,
          padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "rgba(14,16,23,0.62)", zIndex: 30,
        }}>
          <button onClick={() => setTab("feed")} aria-label="Feed" style={{
            border: "none", background: "none", cursor: "pointer", padding: "6px 10px",
            ...display(800), fontSize: 13, letterSpacing: "0.06em",
            color: tab === "feed" ? T.ink : T.faint, borderBottom: `2px solid ${tab === "feed" ? T.ink : "transparent"}`,
          }}>FEED</button>

          {tab === "feed" && deck.length > 0 ? (
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              {swipeHistory.length > 0 && (
                <IconBtn label="Undo last swipe" size={42} color={T.dim} onClick={undoSwipe}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
                </IconBtn>
              )}
              <IconBtn label="Pass on this car" color={T.pass} border="rgba(255,90,72,0.4)"
                onClick={() => setForced((f) => ({ dir: "left", n: f.n + 1 }))}><XIcon /></IconBtn>
              <IconBtn label="Save this car" color={T.save} border="rgba(57,217,138,0.4)"
                onClick={() => setForced((f) => ({ dir: "right", n: f.n + 1 }))}><HeartIcon /></IconBtn>
            </div>
          ) : (
            <div style={{ ...mono, fontSize: 10.5, letterSpacing: "0.22em", color: T.faint }}>
              {tab === "feed" ? "" : `${saved.length} SAVED`}
            </div>
          )}

          <button onClick={() => setTab("garage")} aria-label="Garage — saved cars" style={{
            border: "none", background: "none", cursor: "pointer", padding: "6px 10px", position: "relative",
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
        onSignedIn={handleSignedIn} onSignOut={handleSignOut} savedCount={saved.length} />
      <FilterSheet open={filtersOpen} onClose={() => setFiltersOpen(false)}
        filters={filters} setFilters={setFilters}
        matchCount={listings.filter((l) => !swiped[l.id] && passesFilters(l)).length} />
    </div>
  );
}
