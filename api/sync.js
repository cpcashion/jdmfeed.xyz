/**
 * POST /api/sync
 * Live listing aggregation for the feed.
 *
 * Uses the Anthropic Messages API with the server-side web_search tool to
 * find real, current JDM listings across US marketplaces (Bring a Trailer,
 * Cars & Bids, Hemmings, importer sites, etc.), then returns them as a
 * normalized JSON array the client can drop straight into the deck.
 *
 * Env: ANTHROPIC_API_KEY (Vercel → Project → Settings → Environment Variables)
 * Note: Web Search must be enabled for your org in the Anthropic Console.
 * Cost: web search is billed per search (see Anthropic pricing); this
 * endpoint caps each request at max_uses: 5.
 *
 * This function is the seam for the "real" scraper backend later — swap its
 * body for a database read fed by scheduled scraper adapters and nothing in
 * the client changes.
 */

const MODEL = "claude-sonnet-4-6";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST" });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.",
    });
  }

  const exclude = Array.isArray(req.body?.exclude) ? req.body.exclude.slice(0, 15) : [];

  const prompt = `Search the web for JDM (Japanese domestic market) enthusiast cars currently for sale in the United States right now — sources like Bring a Trailer, Cars & Bids, Hemmings, classic.com, Duncan Imports, Toprank Importers, JDM Sport Classics, Garage Defined. Find 5 real current listings (e.g. Skyline GT-R, Supra, RX-7, NSX, Silvia, Type R Hondas, Lancer Evolution, Land Cruiser, Delica, kei cars). Avoid these already-shown cars: ${exclude.join("; ") || "none"}.
Respond with ONLY a raw JSON array — no markdown fences, no prose before or after. Each element:
{"title":"1995 Nissan Skyline GT-R","year":1995,"make":"Nissan","model":"Skyline GT-R","chassis":"BCNR33","trim":"V-Spec","price":74000,"mileage":52000,"transmission":"5-speed manual","engine":"2.6L RB26DETT","drivetrain":"AWD","location":"Austin, TX","source":"Bring a Trailer","source_url":"https://...","description":"one sentence","paint":"Midnight Purple"}
price = number in USD (current bid if auction, 0 if unknown). source_url must be a real URL taken from your search results — never invent one. If you cannot verify a listing, leave it out.`;

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      }),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      const msg = data?.error?.message || `Anthropic API error (${upstream.status})`;
      return res.status(502).json({ error: msg });
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end <= start) {
      return res.status(502).json({ error: "No listings found in this pass — try syncing again." });
    }

    let items;
    try {
      items = JSON.parse(text.slice(start, end + 1));
    } catch {
      return res.status(502).json({ error: "Listings response could not be parsed — try syncing again." });
    }

    const clean = (Array.isArray(items) ? items : [])
      .filter((it) => it && it.title && it.source_url)
      .slice(0, 8)
      .map((it, i) => ({
        id: `live-${Date.now()}-${i}`,
        title: String(it.title),
        year: Number(it.year) || null,
        make: it.make || "",
        model: it.model || "",
        chassis: it.chassis || "",
        trim: it.trim || "",
        price: Number(it.price) || 0,
        mileage: Number(it.mileage) || 0,
        transmission: it.transmission || "",
        engine: it.engine || "",
        drivetrain: it.drivetrain || "",
        location: it.location || "United States",
        source: it.source || "Web",
        source_url: it.source_url,
        description: it.description || "",
        paintName: it.paint || "",
        live: true,
        scraped_date: new Date().toISOString(),
      }));

    return res.status(200).json({ listings: clean });
  } catch (err) {
    return res.status(500).json({ error: "Sync failed: " + (err?.message || "unknown error") });
  }
}
