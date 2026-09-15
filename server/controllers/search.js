const db = require('../db');
const { escapeLike } = require('../lib/tables');

let trigramAvailable = null;

async function hasTrigram() {
  if (trigramAvailable === null) {
    const { rows } = await db.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'");
    trigramAvailable = rows.length > 0;
  }
  return trigramAvailable;
}

/**
 * One search box for everything: products, customers, suppliers and sales in a
 * single round trip. Ranked by trigram similarity, so a misspelling still finds
 * its match ("balpoint" finds "Ballpoint Pen") and the closest name comes first.
 */
exports.search = async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) return res.json({ query: q, results: [] });
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 10);
    const like = `%${escapeLike(q)}%`;
    const fuzzy = await hasTrigram();

    // Without pg_trgm, fall back to plain "contains" matching and alphabetical order.
    const score = (expr) => (fuzzy ? `GREATEST(similarity(${expr}, $1), word_similarity($1, ${expr}))` : '0');
    const match = (expr) => (fuzzy ? `(${expr} ILIKE $2 OR ${expr} % $1 OR $1 <% ${expr})` : `${expr} ILIKE $2`);

    const { rows } = await db.query(
      `(SELECT 'product' AS kind, p.id, p.name AS title,
               concat_ws(' · ', p.sku, trim_scale(p.stock_quantity) || ' in stock') AS subtitle,
               p.sale_price AS amount, ${score('p.name')} AS score
          FROM products p
         WHERE ${match('p.name')} OR p.sku ILIKE $2
         ORDER BY score DESC, p.name LIMIT $3)
       UNION ALL
       (SELECT 'customer', c.id, c.name, concat_ws(' · ', c.phone, c.email), NULL, ${score('c.name')} AS score
          FROM customers c
         WHERE ${match('c.name')} OR c.phone ILIKE $2 OR c.email ILIKE $2
         ORDER BY score DESC, c.name LIMIT $3)
       UNION ALL
       (SELECT 'supplier', s.id, s.name, concat_ws(' · ', s.contact_name, s.phone), NULL, ${score('s.name')} AS score
          FROM suppliers s
         WHERE ${match('s.name')} OR s.contact_name ILIKE $2
         ORDER BY score DESC, s.name LIMIT $3)
       UNION ALL
       (SELECT 'sale', s.id, s.reference, concat_ws(' · ', COALESCE(c.name, 'Walk-in'), s.payment_status), s.total, 1 AS score
          FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
         WHERE s.reference ILIKE $2 OR c.name ILIKE $2
         ORDER BY s.created_at DESC LIMIT $3)`,
      [q, like, limit]
    );

    res.json({ query: q, fuzzy, results: rows.map((r) => ({ ...r, score: Math.round(Number(r.score) * 100) / 100 })) });
  } catch (err) {
    next(err);
  }
};
