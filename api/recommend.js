// api/recommend.js
// Purpose: pull a WIDE pool of candidate books across ALL genres.
// The AI (Lovable) can then filter + rank based on niche preferences (e.g., "has dragons").
// This endpoint should NOT rely on keywords being in the title.

export default async function handler(req, res) {
  try {
    const q = (req.query.q || "").toString().trim();            // free text from user
    const genre = (req.query.genre || "").toString().trim();     // e.g. "thriller", "romantasy", "nonfiction"
    const mood = (req.query.mood || "").toString().trim();       // e.g. "cozy", "dark", "fast-paced"
    const max = Math.min(parseInt(req.query.max || "120", 10), 200); // cap for speed

    if (!q && !genre && !mood) {
      return res.status(400).json({
        error: "Missing query. Provide at least one of ?q=, ?genre=, or ?mood="
      });
    }

    // Build broad queries. We want variety, not precision.
    const queries = [];

    // 1) If the user typed anything, include it as-is.
    if (q) queries.push(q);

    // 2) If they selected a genre, include it in a few broad ways.
    if (genre) {
      queries.push(genre);
      if (mood) queries.push(`${genre} ${mood}`);
      if (q) queries.push(`${genre} ${q}`);
    }

    // 3) If they selected mood, include mood-only searches too
    // (useful if user chooses "cozy" without committing to a genre).
    if (mood) {
      queries.push(mood);
      if (q) queries.push(`${mood} ${q}`);
    }

    // 4) Add a small number of “generic discovery” queries as a fallback
    // so we still get decent candidates even if user input is vague.
    // These are NOT fantasy-specific.
    const discoveryFallbacks = [
      "bestselling books",
      "popular books",
      "award winning books",
      "highly rated books"
    ];

    // Use fallbacks only when the user input is very short/vague.
    const isVague = (q && q.length < 4 && !genre && !mood) || (!q && (genre.length < 4) && !mood);
    if (isVague) {
      discoveryFallbacks.forEach(x => queries.push(x));
      if (genre) queries.push(`${genre} bestsellers`);
    } else {
      // If not vague, still add 1–2 gentle wideners so results aren’t too narrow.
      if (genre) queries.push(`${genre} bestsellers`);
      if (genre) queries.push(`${genre} new releases`);
    }

    // Deduplicate queries
    const uniqueQueries = Array.from(
      new Set(queries.map(s => s.trim()).filter(Boolean))
    ).slice(0, 8); // keep it bounded so we don't spam Google

    const perQuery = Math.max(20, Math.floor(max / uniqueQueries.length));
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY; // optional but recommended

    const fetchOne = async (query) => {
      const params = new URLSearchParams();
      params.set("q", query);
      params.set("maxResults", String(Math.min(perQuery, 40))); // Google max per request is 40
      params.set("printType", "books");
      params.set("langRestrict", "en");
      params.set("orderBy", "relevance");

      if (apiKey) params.set("key", apiKey);

      const url = `https://www.googleapis.com/books/v1/volumes?${params.toString()}`;
      const r = await fetch(url);

      if (!r.ok) {
        return { items: [], error: `Google Books error ${r.status}` };
      }
      return await r.json();
    };

    const results = await Promise.all(uniqueQueries.map(fetchOne));

    // Flatten + dedupe by volume ID
    const map = new Map();
    for (const block of results) {
      for (const item of (block.items || [])) {
        if (!item?.id) continue;
        if (!map.has(item.id)) map.set(item.id, item);
      }
    }

    // Simplify to a clean skeleton for your AI
    const candidates = Array.from(map.values()).slice(0, max).map((item) => {
      const info = item.volumeInfo || {};
      return {
        id: item.id,
        title: info.title || "",
        authors: info.authors || [],
        categories: info.categories || [],
        description: info.description || "",
        publishedDate: info.publishedDate || "",
        averageRating: info.averageRating ?? null,
        ratingsCount: info.ratingsCount ?? null,
        thumbnail: info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || "",
        infoLink: info.infoLink || ""
      };
    });

    return res.status(200).json({
      queriesUsed: uniqueQueries,
      count: candidates.length,
      candidates
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err?.message || err) });
  }
}
