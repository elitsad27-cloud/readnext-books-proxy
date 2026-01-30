export default async function handler(req, res) {
  try {
    const q = (req.query.q || "").toString().trim();

    if (!q) {
      return res.status(400).json({ error: "Missing q parameter" });
    }

    const url =
      "https://www.googleapis.com/books/v1/volumes" +
      `?q=${encodeURIComponent(q)}` +
      `&maxResults=12` +
      `&printType=books` +
      `&langRestrict=en` +
      `&key=${process.env.GOOGLE_BOOKS_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.toString(),
    });
  }
}
