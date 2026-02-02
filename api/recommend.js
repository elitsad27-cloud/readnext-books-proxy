// api/recommend.js
export default async function handler(req, res) {
  try {
    // ---- Read inputs ----
    const qRaw = (req.query.q || "").toString().trim();
    const genreRaw = (req.query.genre || "").toString().trim();
    const moodRaw = (req.query.mood || "").toString().trim();

    // Basic sanity: you can still get results even if q is empty
    const q = qRaw || "";
    const genre = genreRaw || "";
    const mood = moodRaw || "";

    // ---- Build a set of "search ideas" (broad -> specific) ----
    const queriesUsed = [];

    // If user gave a book they liked, use it
    if (q) queriesUsed.push(q);

    // Genre/mood alone should also work
    if (genre) queriesUsed.push(genre);
    if (mood) queriesUsed.push(mood);

    // Combined signals
    if (genre && mood) queriesUsed.push(`${genre} ${mood}`);
    if (genre && q) queriesUsed.push(`${genre} ${q}`);
    if (mood && q) queriesUsed.push(`${mood} ${q}`);
    if (genre && mood && q) queriesUsed.push(`${genre} ${mood} ${q}`);

    // General discovery fallbacks (help when mood/genre is vague)
    if (genre) queriesUsed.push(`${genre} best books`);
    if (genre) queriesUsed.push(`${genre} new releases`);
    if (genre) queriesUsed.push(`${genre} bestsellers`);

    // Last resort: if literally nothing was provided
    if (queriesUsed.length === 0) queriesUsed.push("bestselling books");

    // Deduplicate while preserving order
    const uniqQueries = [];
    const seen = new Set();
    for (const item of queriesUsed) {
      const key = item.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqQueries.push(item);
      }
    }

    // ---- Google Books fetch helper ----
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY || "";
    const base = "https://www.googleapis.com/books/v1/volumes";

    // We keep this deliberately NOT over-filtered.
    // If you over-filter, you get zero candidates.
    async function fetchBooks(searchTerm) {
      const params = new URLSearchParams();
      params.set("q", searchTerm);                // IMPORTANT: plain q
      params.set("maxResults", "20");
      params.set("orderBy", "relevance");
      params.set("printType", "books");           // ok, not too restrictive
      params.set("projection", "lite");           // faster
      params.set("langRestrict", "en");           // optional; remove if you want any language
      // params.set("key", apiKey) only if present
      if (apiKey) params.set("key", apiKey);

      const url = `${base}?${params.toString()}`;
      const r = await fetch(url);
      const data = await r.json();

      return {
        url,
        items: Array.isArray(data.items) ? data.items : []
      };
    }

    // ---- Fetch in parallel (but not too many) ----
    // Limit to avoid hitting quotas / slowdowns
    const limitedQueries = uniqQueries.slice(0, 8);

    const results = await Promise.all(
      limitedQueries.map(async (term) => {
        const out = await fetchBooks(term);
        return { term, ...out };
      })
    );

    // ---- Flatten and dedupe candidates ----
    const byId = new Map();
    for (const block of results) {
      for (const item of block.items) {
        if (!item || !item.id) continue;
        if (!byId.has(item.id)) byId.set(item.id, item);
      }
    }

    const candidates = Array.from(byId.values());

    // ---- Debug info so you can see what is failing ----
    const debug = results.map((r) => ({
      term: r.term,
      count: r.items.length,
      // url is useful while debugging; you can remove later if you want
      url: r.url
    }));

    return res.status(200).json({
      queriesUsed: limitedQueries,
      count: candidates.length,
      candidates,
      debug
    });
  } catch (err) {
    return res.status(500).json({
      error: "recommend endpoint failed",
      message: err?.message || String(err)
    });
  }
}
