const db = require('../db');

/**
 * Categories are their own table (so renaming one renames it everywhere), but
 * people type them as plain words on a product. This turns a typed name into the
 * category's id, creating the category the first time it is used. Matching
 * ignores case and surrounding spaces, the same rule as the unique index.
 */
async function categoryIdFor(name) {
  const clean = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!clean) return null;
  const { rows } = await db.query(
    `WITH existing AS (
       SELECT id FROM categories WHERE lower(btrim(name)) = lower($1)
     ), inserted AS (
       INSERT INTO categories (name)
       SELECT $1 WHERE NOT EXISTS (SELECT 1 FROM existing)
       ON CONFLICT DO NOTHING
       RETURNING id
     )
     SELECT id FROM existing UNION ALL SELECT id FROM inserted`,
    [clean]
  );
  if (rows.length) return rows[0].id;
  // Lost a race with someone creating the same category: it exists now.
  const again = await db.query('SELECT id FROM categories WHERE lower(btrim(name)) = lower($1)', [clean]);
  return again.rows[0]?.id ?? null;
}

module.exports = { categoryIdFor };
