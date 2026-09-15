// Postgres-style `$1` placeholders are the canonical form for all SQL in this
// project. SQLite needs positional `?`, and better-sqlite3 rejects `?N` bound
// from an array, so we rewrite to `?` and expand params into occurrence order.
// That also makes a reused placeholder ($1 twice) bind correctly.
function toPositional(sql, params = []) {
  const out = [];
  const ordered = [];
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    // Skip over string literals so a `$` inside one is left alone.
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out.push(ch);
      i++;
      while (i < sql.length) {
        out.push(sql[i]);
        if (sql[i] === quote) {
          // Doubled quote is an escaped quote, not the end of the literal.
          if (sql[i + 1] === quote) {
            out.push(sql[i + 1]);
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === '$' && /[0-9]/.test(sql[i + 1] || '')) {
      let j = i + 1;
      while (j < sql.length && /[0-9]/.test(sql[j])) j++;
      const index = Number(sql.slice(i + 1, j));
      ordered.push(params[index - 1]);
      out.push('?');
      i = j;
      continue;
    }

    out.push(ch);
    i++;
  }

  return { sql: out.join(''), params: ordered };
}

module.exports = { toPositional };
