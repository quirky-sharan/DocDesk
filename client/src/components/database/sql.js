// A small SQL tokenizer for the console: enough to colour a query, suggest
// names and tidy the layout. It never decides what may run - the server does.

export const KEYWORDS = new Set(`
select from where and or not in is null like ilike between exists as on join inner left right full outer cross natural using
group by order having limit offset fetch first next rows only distinct all any some union intersect except case when then
else end asc desc nulls last with recursive insert into values update set delete returning create index view materialized
unique concurrently if replace refresh analyze analyse vacuum explain verbose buffers format json filter over partition window
lateral true false default primary key foreign references check constraint table column cascade restrict comment show
interval date time timestamp timestamptz numeric integer bigint text boolean jsonb array cast collate at zone similar to
`.trim().split(/\s+/));

export const FUNCTIONS = new Set(`
count sum avg min max round floor ceil abs coalesce nullif greatest least now current_date current_timestamp date_trunc
extract to_char to_date age lower upper trim length substring concat string_agg array_agg json_agg jsonb_agg row_number
rank dense_rank lag lead generate_series similarity percentile_cont percentile_disc make_interval sign mod power sqrt
exp ln log random split_part left right position replace regexp_replace format pg_size_pretty pg_total_relation_size
report_sales_by_day report_sales_heatmap app_clock business_timezone
`.trim().split(/\s+/));

/** Splits SQL into coloured pieces, preserving every character so the text lines up exactly. */
export function tokenize(sql) {
  const tokens = [];
  let i = 0;
  const push = (type, text) => tokens.push({ type, text });
  while (i < sql.length) {
    const ch = sql[i];
    const rest = sql.slice(i);
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      push('comment', sql.slice(i, stop));
      i = stop;
    } else if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      push('comment', sql.slice(i, stop));
      i = stop;
    } else if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j += 1;
      }
      push('string', sql.slice(i, j + 1));
      i = j + 1;
    } else if (ch === '"') {
      const end = sql.indexOf('"', i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      push('ident', sql.slice(i, stop));
      i = stop;
    } else if (/[0-9]/.test(ch)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(rest);
      push('number', m[0]);
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(rest);
      const word = m[0];
      const lower = word.toLowerCase();
      const next = sql.slice(i + word.length).match(/^\s*\(/);
      push(KEYWORDS.has(lower) ? 'keyword' : next || FUNCTIONS.has(lower) ? 'function' : 'ident', word);
      i += word.length;
    } else if (ch === '$' && /^\$[0-9]+/.test(rest)) {
      const m = /^\$[0-9]+/.exec(rest);
      push('param', m[0]);
      i += m[0].length;
    } else if (/\s/.test(ch)) {
      const m = /^\s+/.exec(rest);
      push('space', m[0]);
      i += m[0].length;
    } else if (rest.startsWith('::')) {
      push('operator', '::');
      i += 2;
    } else {
      push(/[(),;.]/.test(ch) ? 'punct' : 'operator', ch);
      i += 1;
    }
  }
  return tokens;
}

export const TOKEN_COLORS = {
  keyword: 'rgb(var(--c-accent))',
  function: 'rgb(var(--c-violet))',
  string: 'rgb(var(--c-success))',
  number: 'rgb(var(--c-warning))',
  param: 'rgb(var(--c-warning))',
  comment: 'rgb(var(--c-text-3))',
  operator: 'rgb(var(--c-text-2))',
  punct: 'rgb(var(--c-text-3))',
  ident: 'rgb(var(--c-text))',
  space: 'inherit',
};

const BREAK_BEFORE = ['select', 'from', 'where', 'group by', 'order by', 'having', 'limit', 'offset', 'returning', 'values', 'set', 'union', 'union all', 'except', 'intersect', 'with'];
const JOINS = ['join', 'left join', 'right join', 'inner join', 'full join', 'cross join', 'left outer join', 'right outer join', 'full outer join'];

/**
 * Tidies a query: keywords in capitals, each main clause on its own line, joins
 * and AND/OR indented. Comments and strings are left exactly as written.
 */
export function formatSql(sql) {
  const words = tokenize(sql)
    .filter((t) => t.type !== 'space')
    .map((t) => (t.type === 'keyword' ? { ...t, text: t.text.toUpperCase() } : t));
  if (!words.length) return sql;

  let out = '';
  let depth = 0;
  let inBetween = false;
  const lineStart = () => out.length === 0 || out.endsWith('\n');
  const newline = (indent = 0) => {
    out = out.replace(/[ \t]+$/, '');
    if (!lineStart()) out += '\n';
    out += '  '.repeat(depth + indent);
  };

  for (let k = 0; k < words.length; k++) {
    const t = words[k];
    const lower = t.text.toLowerCase();
    const pair = `${lower} ${(words[k + 1]?.text || '').toLowerCase()}`;
    const triple = `${pair} ${(words[k + 2]?.text || '').toLowerCase()}`;

    if (t.type === 'keyword' && (BREAK_BEFORE.includes(pair) || (BREAK_BEFORE.includes(lower) && !['by', 'all'].includes(lower)))) {
      if (!(lower === 'select' && out.trim().endsWith('('))) newline();
    } else if (t.type === 'keyword' && (JOINS.includes(triple) || JOINS.includes(pair) || lower === 'join')) {
      const prev = (words[k - 1]?.text || '').toLowerCase();
      if (!['left', 'right', 'inner', 'full', 'cross', 'outer'].includes(prev)) newline(1);
    } else if (t.type === 'keyword' && (lower === 'and' || lower === 'or')) {
      // The AND of "BETWEEN a AND b" stays on the line.
      if (lower === 'and' && inBetween) inBetween = false;
      else newline(1);
    } else if (t.type === 'comment') {
      if (!lineStart()) out += ' ';
    }

    if (t.text === '(') depth += 1;
    if (t.text === ')') depth = Math.max(0, depth - 1);

    const prev = out.slice(-1);
    if (t.type === 'keyword' && lower === 'between') inBetween = true;
    const call = t.text === '(' && ['function', 'ident'].includes(words[k - 1]?.type);
    const glue = call || t.text === ',' || t.text === ')' || t.text === '.' || t.text === ';' || t.text === '::' || prev === '(' || prev === '.' || out.endsWith('::') || lineStart() || prev === ' ';
    out += (glue ? '' : ' ') + t.text;
    if (t.text === ',' && depth === 0) out += '\n  ';
    else if (t.type === 'comment' && t.text.startsWith('--')) out += '\n';
  }
  return out.replace(/\n\s*\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

/** The word being typed at the caret, and where it starts. */
export function wordAt(text, caret) {
  const before = text.slice(0, caret);
  const m = /([A-Za-z_][A-Za-z0-9_]*)?(\.)?([A-Za-z_][A-Za-z0-9_]*)?$/.exec(before);
  if (!m || !m[0]) return null;
  if (m[2]) return { start: caret - (m[3] || '').length, word: m[3] || '', qualifier: m[1] };
  return { start: caret - (m[1] || '').length, word: m[1] || '', qualifier: null };
}

/** Aliases in the FROM / JOIN clauses: "products p" → { p: 'products' }. */
export function aliasesIn(sql, tableNames) {
  const map = {};
  const re = /\b(?:from|join)\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi;
  let m;
  while ((m = re.exec(sql))) {
    const table = m[1].toLowerCase();
    if (!tableNames.has(table)) continue;
    map[table] = table;
    const alias = m[2]?.toLowerCase();
    if (alias && !KEYWORDS.has(alias)) map[alias] = table;
  }
  return map;
}
