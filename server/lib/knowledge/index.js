const db = require('../../db');
const { embed, embeddingModel } = require('./embed');

/**
 * What the receptionist is allowed to say about the business, and the gate that
 * stops it saying anything else.
 *
 * The rule, which is not negotiable and not tunable below a floor: before
 * answering a factual question about the business, retrieval must find support.
 * Below the threshold the receptionist does not answer and does not guess - it
 * says it is not sure and offers to take a message or fetch someone.
 *
 * This is the highest-value guardrail in the whole feature. Inventing opening
 * hours is the failure that gets a real business in trouble, and no wording of
 * a prompt prevents it reliably: a model asked a question it cannot answer will
 * produce something plausible, because that is what it is for. The only
 * dependable fix is to not ask it unless there is something to answer from.
 *
 * Every refusal is recorded as a knowledge gap, so the Knowledge page can show
 * the questions nobody could answer and the owner can close the loop with three
 * sentences.
 */

/**
 * The floor. Tunable upwards by an owner who wants the receptionist to be more
 * cautious, never downwards - a setting that could switch this off would
 * eventually be switched off.
 */
const MIN_LEXICAL = 0.05;
const MIN_SEMANTIC = 0.5;
const HARD_FLOOR = 0.05;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'you', 'your', 'yours',
  'i', 'me', 'my', 'we', 'us', 'our', 'it', 'its', 'to', 'of', 'in', 'on', 'at', 'for', 'and',
  'or', 'but', 'if', 'so', 'be', 'been', 'have', 'has', 'had', 'can', 'could', 'will', 'would',
  'should', 'what', 'when', 'where', 'who', 'why', 'how', 'there', 'this', 'that', 'these',
  'those', 'any', 'some', 'with', 'from', 'about', 'please', 'thanks', 'hi', 'hello',
]);

/** The words in a question that carry its meaning. */
function contentWords(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * Whether a chunk actually talks about what was asked.
 *
 * A ranking score alone is not enough: every ranking returns a best row, and
 * "best" over a corpus that says nothing relevant is still nothing relevant.
 * Requiring a real word in common is crude and very hard to argue with.
 */
function overlaps(question, content) {
  const asked = contentWords(question);
  if (!asked.length) return false;
  const haystack = String(content || '').toLowerCase();
  return asked.some((word) => {
    if (haystack.includes(word)) return true;
    // "close" should match "closed", "closing".
    const stem = word.replace(/(ing|ed|es|s)$/, '');
    return stem.length > 3 && haystack.includes(stem);
  });
}

/**
 * Looks for support for an answer.
 *
 * @returns {{
 *   supported: boolean, chunks: object[], score: number, reason: string|null
 * }}
 */
async function retrieve(question, { limit = 4, minLexical = MIN_LEXICAL } = {}) {
  const text = String(question || '').trim();
  if (!text) return { supported: false, chunks: [], score: 0, reason: 'nothing was asked' };

  const vector = await embed(text).catch(() => null);
  const floor = Math.max(HARD_FLOOR, Number(minLexical) || MIN_LEXICAL);

  const { rows } = await db.query(
    'SELECT chunk_id, document_id, title, content, score, lexical, semantic FROM kb_search($1, $2, $3, $4)',
    [text, vector, limit, floor]
  );

  if (!rows.length) {
    return { supported: false, chunks: [], score: 0, reason: 'nothing in the knowledge base covers this' };
  }

  const best = rows[0];
  const strongEnough = Number(best.lexical) >= floor || Number(best.semantic) >= MIN_SEMANTIC;
  const onTopic = overlaps(text, best.content);

  if (!strongEnough || !onTopic) {
    return {
      supported: false,
      chunks: rows,
      score: Number(best.score),
      reason: onTopic ? 'the closest match is too weak to rely on' : 'the closest match is not about what was asked',
    };
  }

  return { supported: true, chunks: rows, score: Number(best.score), reason: null };
}

/**
 * Retrieval plus the record of what happened. The conversation id is optional
 * so the same call works from the benchmark, where there is no conversation.
 */
async function ask(question, { conversationId = null, limit = 4 } = {}) {
  const result = await retrieve(question, { limit });

  await db.query(
    `INSERT INTO kb_feedback (chunk_id, conversation_id, question, answered, score)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      result.supported ? result.chunks[0].chunk_id : null,
      conversationId,
      String(question).slice(0, 500),
      result.supported,
      result.score,
    ]
  ).catch(() => {
    // The record is useful, not essential. Never fail an answer over it.
  });

  return result;
}

/** The questions nobody could answer, most asked first. */
async function gaps({ limit = 20, days = 90 } = {}) {
  const { rows } = await db.query(
    `SELECT lower(btrim(question)) AS question, count(*)::int AS times, max(created_at) AS last_asked
       FROM kb_feedback
      WHERE NOT answered
        AND created_at > now() - make_interval(days => $1)
      GROUP BY 1
      ORDER BY times DESC, last_asked DESC
      LIMIT $2`,
    [days, limit]
  );
  return rows;
}

// --- writing to it ----------------------------------------------------------

/**
 * Splits a document into retrievable pieces.
 *
 * Paragraph boundaries, not a fixed character count: a shop's knowledge base is
 * short prose where a paragraph is usually one fact, and cutting mid-sentence
 * to hit a length makes both halves useless.
 */
function chunk(body, { maxChars = 700 } = {}) {
  const paragraphs = String(body || '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  const out = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      if (current) { out.push(current); current = ''; }
      // A very long paragraph is split on sentences rather than mid-word.
      let piece = '';
      for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
        if ((piece + ' ' + sentence).trim().length > maxChars && piece) { out.push(piece.trim()); piece = ''; }
        piece += ` ${sentence}`;
      }
      if (piece.trim()) out.push(piece.trim());
      continue;
    }
    if ((current + '\n\n' + paragraph).trim().length > maxChars && current) {
      out.push(current.trim());
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** Writes a document and rebuilds its chunks and embeddings. */
async function save({ id = null, title, body, source = 'manual', isGenerated = false, isActive = true }) {
  const pieces = chunk(body);
  const model = embeddingModel();

  return db.transaction(async (tx) => {
    let document;
    if (id) {
      const { rows } = await tx.query(
        `UPDATE kb_documents SET title = $2, body = $3, source = $4, is_active = $5 WHERE id = $1 RETURNING *`,
        [id, title, body, source, isActive]
      );
      document = rows[0];
    } else {
      const { rows } = await tx.query(
        `INSERT INTO kb_documents (title, body, source, is_generated, is_active)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [title, body, source, isGenerated, isActive]
      );
      document = rows[0];
    }
    if (!document) return null;

    await tx.query('DELETE FROM kb_chunks WHERE document_id = $1', [document.id]);
    for (const [ordinal, content] of pieces.entries()) {
      const vector = await embed(content).catch(() => null);
      await tx.query(
        'INSERT INTO kb_chunks (document_id, ordinal, content, embedding, embedded_by) VALUES ($1, $2, $3, $4, $5)',
        [document.id, ordinal, content, vector, vector ? model : null]
      );
    }
    return { ...document, chunks: pieces.length };
  });
}

async function remove(id) {
  const { rowCount } = await db.query('DELETE FROM kb_documents WHERE id = $1 AND NOT is_generated', [id]);
  return rowCount > 0;
}

async function list({ includeGenerated = true } = {}) {
  const { rows } = await db.query(
    `SELECT d.id, d.title, d.source, d.is_generated, d.is_active, d.updated_at,
            count(c.id)::int AS chunks,
            count(c.id) FILTER (WHERE c.embedding IS NOT NULL)::int AS embedded
       FROM kb_documents d
       LEFT JOIN kb_chunks c ON c.document_id = d.id
      ${includeGenerated ? '' : 'WHERE NOT d.is_generated'}
      GROUP BY d.id
      ORDER BY d.is_generated, d.title`
  );
  return rows;
}

async function capabilities() {
  const { rows } = await db.query('SELECT knowledge_capabilities() AS c');
  return { ...rows[0].c, embeddingModel: embeddingModel() };
}

module.exports = {
  retrieve, ask, gaps, chunk, save, remove, list, capabilities,
  contentWords, overlaps, MIN_LEXICAL, MIN_SEMANTIC, HARD_FLOOR,
};
