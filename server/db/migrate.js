const fs = require('fs');
const path = require('path');
const db = require('./index');

async function migrate() {
  const file = path.join(__dirname, `schema.${db.name}.sql`);
  const sql = fs.readFileSync(file, 'utf8');

  // Split on semicolons at end of line so each DDL statement runs on its own;
  // SQLite's driver only executes one statement per prepare().
  const statements = sql
    .split(/;\s*$/m)
    // A chunk that is only comments and whitespace is not a statement.
    .filter((s) => s.replace(/--[^\n]*/g, '').trim());

  for (const statement of statements) {
    await db.query(statement);
  }

  return listTables();
}

async function listTables() {
  const sql =
    db.name === 'postgres'
      ? `SELECT table_name AS name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY name`
      : `SELECT name FROM sqlite_master WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%' ORDER BY name`;
  const { rows } = await db.query(sql);
  return rows.map((r) => r.name);
}

module.exports = { migrate, listTables };

if (require.main === module) {
  migrate()
    .then(async (tables) => {
      console.log(`migrated (${db.name})`);
      tables.forEach((t) => console.log('  -', t));
      await db.close();
    })
    .catch(async (err) => {
      console.error('migration failed:', err.message);
      await db.close();
      process.exit(1);
    });
}
