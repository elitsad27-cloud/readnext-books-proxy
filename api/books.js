export default async function handler(req, res) {
  try {
    const q = (req.query.q || "").toString().trim();

    if (!q) {
      return res.status(400).json({ error: "Missing q parameter" });
    }

    const url =
      "https://www.googleapis.com/books/v1/volumes" +
      `?q=${encodeURIComponent(q)}` +
      "&maxResults=40" +
      "&printType=books" +
      "&langRestrict=en" +
      "&orderBy=relevance" +
      "&filter=ebooks" +
      `&key=${process.env.GOOGLE_BOOKS_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    // If Google returns an error (bad key, quota, etc.), pass it through clearly
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const bannedWords = [
      "summary",
      "study guide",
      "workbook",
      "analysis",
      "journal",
      "notebook",
      "companion",
      "collection set",
      "boxed set",
      "guide to",
      "unofficial"
    ];

    const cleanedItems = (data.items || [])
      .filter((item) => {
        const v = item.volumeInfo || {};
        const title = (v.title || "").toLowerCase();
        const subtitle = (v.subtitle || "").toLowerCase();
        const desc = (v.description || "").toLowerCase();

        // Basic quality signals
        const hasAuthor = Array.isArray(v.authors) && v.authors.length > 0;
        const hasPages = typeof v.pageCount === "number" && v.pageCount >= 150;
        const hasCover = !!(
          v.imageLinks &&
          (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail)
        );

        // Reject obvious junk
        const textBlob = `${title} ${subtitle} ${desc}`;
        const isBanned = bannedWords.some((w) => textBlob.includes(w));

        return hasAuthor && hasPages && hasCover && !isBanned;
      })
      .slice(0, 12);

    return res.status(200).json({
      ...data,
      items: cleanedItems,
      totalItems: cleanedItems.length
    });
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error?.toString?.() || String(error)
    });
  }
}
