const { describeTable, assertTable, badRequest } = require('../tables');
const { complete, isConfigured, LlmError } = require('../llm');
const { validateOperation, COLUMN_TYPES, OPERATORS, AGGREGATES } = require('./operations');

const SYSTEM_PROMPT = `You translate a shopkeeper's plain-English request into ONE structured operation on a database table.

You never write SQL. You return only a JSON object.

Allowed "type" values and their fields:
- "sort": { "column": string, "direction": "asc" | "desc" }
- "filter": { "conditions": [{ "column": string, "operator": string, "value": any }], "match": "all" | "any" }
- "add_column": { "name": string, "type_hint": "text"|"number"|"integer"|"date"|"boolean" }
- "rename_column": { "from": string, "to": string }
- "drop_column": { "name": string }
- "set_values": { "assignments": [{ "column": string, "value": any }], "conditions": [...] }
- "summarize": { "metrics": [{ "fn": "count"|"sum"|"avg"|"min"|"max", "column": string }], "group_by": string | null }

Comparison operators: ${Object.keys(OPERATORS).join(', ')}.

Rules:
- Use ONLY column names from the provided list. Never invent one.
- If the request is ambiguous or names a column that doesn't exist, return
  { "type": "unclear", "reason": "<one short sentence a shopkeeper would understand>" }.
- "cheapest"/"lowest" means ascending; "most expensive"/"highest"/"best" means descending.
- "running low" means comparing stock_quantity against reorder_level - if you cannot express
  it with one operator, return "unclear".
- Respond with the JSON object only. No prose, no markdown fence.`;

function buildUserPrompt(table, columns, request) {
  const columnList = columns
    .map((c) => `- ${c.name} (${c.type.toLowerCase()})`)
    .join('\n');
  return `Table: ${table}
Columns:
${columnList}

Column types you may create: ${Object.keys(COLUMN_TYPES).join(', ')}
Summary functions: ${Object.keys(AGGREGATES).join(', ')}

Request: "${request}"

JSON:`;
}

/** Models sometimes wrap JSON in a fence or add a sentence. Recover both. */
function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the first balanced object in the string.
    const start = candidate.indexOf('{');
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < candidate.length; i++) {
      if (candidate[i] === '{') depth++;
      else if (candidate[i] === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  }
}

/**
 * A small rule-based interpreter for the most common phrasings.
 *
 * It exists for two reasons: the feature still does something useful before an
 * API key is configured, and it is a cheap correctness check - if this and the
 * model disagree on an obvious request, the prompt has drifted.
 */
function ruleBased(request, columns) {
  const text = String(request).toLowerCase().trim();
  const names = columns.map((c) => c.name);

  // What a shopkeeper says, mapped to what the column is actually called.
  // Checked only after exact column names fail, so a real name always wins.
  const ALIASES = {
    price: ['sale_price', 'price', 'unit_price', 'total'],
    cost: ['cost_price', 'unit_cost'],
    stock: ['stock_quantity', 'quantity'],
    quantity: ['stock_quantity', 'quantity'],
    qty: ['stock_quantity', 'quantity'],
    amount: ['total', 'line_total', 'sale_price'],
    total: ['total', 'line_total'],
    date: ['created_at', 'expected_date', 'appointment_date'],
    added: ['created_at'],
    code: ['sku'],
    supplier: ['supplier_name', 'supplier_id'],
    customer: ['customer_name', 'customer_id'],
  };

  const findColumn = () => {
    // Longest match first, so "sale_price" wins over "price".
    const sorted = [...names].sort((a, b) => b.length - a.length);
    for (const name of sorted) {
      if (text.includes(name.toLowerCase()) || text.includes(name.replace(/_/g, ' '))) return name;
    }
    for (const [word, candidates] of Object.entries(ALIASES)) {
      if (!new RegExp(`\\b${word}\\b`).test(text)) continue;
      const match = candidates.find((c) => names.includes(c));
      if (match) return match;
    }
    return null;
  };

  // sort by X / order by X (ascending|descending|highest|lowest)
  if (/\b(sort|order|arrange)\b/.test(text)) {
    const column = findColumn();
    if (column) {
      const descending = /\b(desc|descending|highest|largest|biggest|most|newest|expensive)\b/.test(text);
      return { type: 'sort', column, direction: descending ? 'desc' : 'asc' };
    }
  }

  // add a column called X / add X column
  const addMatch = text.match(/\badd\b.*?\bcolumn\b(?:\s+(?:for|called|named)\s+)?\s*["']?([a-z0-9 _-]{2,40})["']?/)
    || text.match(/\badd\b\s+(?:a\s+)?["']?([a-z0-9 _-]{2,40})["']?\s+column\b/);
  if (addMatch) {
    const label = addMatch[1].trim().replace(/\b(column|field)\b/g, '').trim();
    if (label) {
      const typeHint = /\bdate|expiry|expires|when\b/.test(text)
        ? 'date'
        : /\bnumber|amount|qty|quantity|price|cost|weight\b/.test(text)
          ? 'number'
          : 'text';
      return { type: 'add_column', name: label, type_hint: typeHint };
    }
  }

  return null;
}

/**
 * Turns a plain-English request into a validated operation.
 * Returns { operation, source, explanation, latencyMs, model }.
 */
async function interpret(table, request) {
  assertTable(table);
  const trimmed = String(request || '').trim();
  if (!trimmed) throw badRequest('Type what you want to do first.');
  if (trimmed.length > 500) throw badRequest('That request is too long. Try saying it more briefly.');

  const columns = await describeTable(table);

  if (!isConfigured()) {
    const guess = ruleBased(trimmed, columns);
    if (!guess) {
      const err = new Error(
        'The AI assistant is not connected yet, so only simple requests like "sort by price" or "add a column for expiry date" work. See REQUIREMENTS.md for how to switch it on.'
      );
      err.status = 503;
      throw err;
    }
    return {
      operation: await validateOperation(table, guess),
      source: 'rules',
      model: null,
      latencyMs: 0,
    };
  }

  // 12s: long enough for a cold model, short enough that a hung provider does
  // not leave someone staring at a spinner.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  let result;
  try {
    result = await complete({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(table, columns, trimmed),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const parsed = extractJson(result.text);
  if (!parsed) {
    throw new LlmError("The AI didn't answer in a form I could use. Try rewording that.", { retryable: true });
  }

  if (parsed.type === 'unclear') {
    throw badRequest(
      parsed.reason || "I couldn't work out which columns you meant. Try naming them exactly."
    );
  }

  return {
    operation: await validateOperation(table, parsed),
    source: 'model',
    model: result.model,
    provider: result.provider,
    latencyMs: result.latencyMs,
    usage: result.usage,
  };
}

module.exports = { interpret, ruleBased, extractJson, SYSTEM_PROMPT, buildUserPrompt };
