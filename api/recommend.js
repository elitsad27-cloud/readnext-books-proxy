export default async function handler(req, res) {
  try {
    const googleKey = process.env.GOOGLE_BOOKS_KEY;

    if (!googleKey) {
      return res.status(500).json({
        error: "Missing GOOGLE_BOOKS_KEY environment variable in Vercel",
        hint: "Vercel Project > Settings > Environment Variables > GOOGLE_BOOKS_KEY (Production + Preview), then redeploy",
      });
    }

    // Inputs
    const seed = (req.query.q || "").toString().trim();       // e.g. "Gone Girl"
    const genre = (req.query.genre || "").toString().trim();  // e.g. "thriller"
    const mood = (req.query.mood || "").toString().trim();    // e.g. "twisty" (DO NOT use in Google search)

    // --- Build search terms (ONLY seed + genre) ---
    // Use intitle: for better precision when user enters a book title
    const terms = [];
    if (seed) terms.push(`intitle:"${seed}"`);
    if (genre) terms.push(genre);

    // Combine seed+genre to steer results
    if (seed && genre) terms.push(`${genre} intitle:"${seed}"`);

    // Add broad discovery queries per genre
    if (genre) terms.push(`${genre} bestseller`);
    if (genre) terms.push(`${genre} new releases`);

    const uniqueTerms = Array.from(new Set(terms)).filter(Boolean);

    async function fetchBooks(term) {
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

      if (!resp.ok) {
        let bodyText = "";
        try_toggle: try {
          bodyText = await resp.text();
        } catch (e) {
          break try_toggle;
        }

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

    // Run searches (sequential = fewer rate limit headaches)
    const debug = [];
    const allItems = [];

    for (const term of uniqueTerms) {
      const result = await fetchBooks(term);
      debug.push(result);

      if (result.ok && result.items.length) {
        allItems.push(...result.items);
      }

      if (allItems.length >= 80) break;
    }

    // --- Clean + dedupe ---
    const seen = new Set();
    const candidates = [];

    for (const item of allItems) {
      if (!item || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);

      const info = item.volumeInfo || {};
      const title = info.title || "";
      const authors = info.authors || [];
      const publishedDate = info.publishedDate || "";
      const description = info.description || "";
      const categories = info.categories || [];

      // Basic quality filters (keep classics; just avoid junk)
      if (!title) continue;
      if (!authors.length) continue;

      // Remove entries with no description (AI has nothing to judge vibe on)
      if (!description || description.length < 40) continue;

      candidates.push({
        id: item.id,
        title,
        authors,
        publishedDate,
        description,
        categories,
        thumbnail:
          (info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)) || "",
        infoLink: info.infoLink || "",
      });
    }

    return res.status(200).json({
      seed,
      genre,
      mood, // we keep mood for the AI layer, but we DO NOT use it in Google searching
      queriesUsed: uniqueTerms,
      count: candidates.length,
      candidates,
      debug: debug.map((d) => {
        if (d.ok) {
          return { term: d.term, ok: true, count: d.count, url: d.urlWithoutKey };
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
