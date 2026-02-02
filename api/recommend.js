export default async function handler(req, res) {
  try {
    const googleKey = process.env.GOOGLE_BOOKS_KEY;

    // If the key isn't available in Vercel, fail loudly (otherwise you just get empty results forever)
    if (!googleKey) {
      return res.status(500).json({
        error: "Missing GOOGLE_BOOKS_KEY environment variable in Vercel",
        hint: "Vercel Project > Settings > Environment Variables > GOOGLE_BOOKS_KEY (Production + Preview), then redeploy",
      });
    }

    // Read inputs
    const q = (req.query.q || "").toString().trim(); // e.g. "Gone Girl"
    const genre = (req.query.genre || "").toString().trim(); // e.g. "thriller"
    const mood = (req.query.mood || "").toString().trim(); // e.g. "twisty"

    // Build a set of search terms (simple expansion)
    const terms = [];
    if (q) terms.push(q);
    if (genre) terms.push(genre);
    if (mood) terms.push(mood);
    if (genre && mood) terms.push(`${genre} ${mood}`);
    if (genre && q) terms.push(`${genre} ${q}`);
    if (mood && q) terms.push(`${mood} ${q}`);
    if (genre && mood && q) terms.push(`${genre} ${mood} ${q}`);

    // Helpful “broad” queries
    if (genre) terms.push(`${genre} best books`);
    if (genre) terms.push(`${genre} new releases`);

    // Remove duplicates + empty
    const uniqueTerms = Array.from(new Set(terms)).filter(Boolean);

    // Fetch helper
    async function fetchBooks(term) {
      // Note: using projection=full so you actually get description more often
      const params = new URLSearchParams({
        q: term,
        maxResults: "20",
        orderBy: "relevance",
        printType: "books",
        projection: "full",
        langRestrict: "en",
        key: googleKey,
      });

      const url = `https://www.googleapis.com/books/v1/volumes?${params.toString()}`;

      const resp = await fetch(url);

      // If Google returns an error, return it clearly
      if (!resp.ok) {
        let bodyText = "";
        try {
          bodyText = await resp.text();
        } catch (e) {}

        return {
          ok: false,
          term,
          status: resp.status,
          urlWithoutKey: url.replace(googleKey, "[REDACTED]"),
          errorBody: bodyText ? bodyText.slice(0, 500) : "",
        };
      }

      const data = await resp.json();
      const items = Array.isArray(data.items) ? data.items : [];

      return {
        ok: true,
        term,
        count: items.length,
        urlWithoutKey: url.replace(googleKey, "[REDACTED]"),
        items,
      };
    }

    // Run searches (sequential to reduce rate-limit pain)
    const debug = [];
    const allItems = [];

    for (const term of uniqueTerms) {
      const result = await fetchBooks(term);
      debug.push(result);

      if (result.ok && result.items.length) {
        allItems.push(...result.items);
      }

      // Basic stop condition to avoid hammering the API in development
      if (allItems.length >= 60) break;
    }

    // Dedupe by volume ID
    const seen = new Set();
    const candidates = [];

    for (const item of allItems) {
      if (!item || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);

      const info = item.volumeInfo || {};
      candidates.push({
        id: item.id,
        title: info.title || "",
        authors: info.authors || [],
        publishedDate: info.publishedDate || "",
        description: info.description || "",
        categories: info.categories || [],
        thumbnail:
          (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) || "",
        infoLink: info.infoLink || "",
      });
    }

    return res.status(200).json({
      queriesUsed: uniqueTerms,
      count: candidates.length,
      candidates,
      debug: debug.map((d) => {
        // Keep debug useful but safe
        if (d.ok) {
          return {
            term: d.term,
            ok: true,
            count: d.count,
            url: d.urlWithoutKey,
          };
        }
        return {
          term: d.term,
          ok: false,
          status: d.status,
          url: d.urlWithoutKey,
          errorBody: d.errorBody,
        };
      }),
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error?.toString?.() || String(error),
    });
  }
}
