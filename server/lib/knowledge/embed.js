/**
 * Embeddings, if there are any.
 *
 * Retrieval here is hybrid, and the lexical half carries it. That is not a
 * compromise: on a corpus of tens to hundreds of short paragraphs, answering
 * short factual questions, full text and trigram matching genuinely beat
 * embeddings more often than not. Fusing them is better still, but the fusion
 * degrades gracefully to lexical alone, and kb_search is written so a null
 * embedding costs nothing.
 *
 * So this file is deliberately allowed to return null, and nothing above it
 * treats that as an error.
 *
 * Why not just add the dependency. Running MiniLM locally means
 * @huggingface/transformers, which pulls onnxruntime-node and sharp - well over
 * a hundred megabytes of native binaries, plus a model download on first use -
 * onto a shop computer, to slightly improve ranking over a knowledge base
 * somebody can read in one sitting. It is a genuine upgrade for a larger
 * corpus, so it is wired to be used the moment it is installed, and written up
 * in REQUIREMENTS-RECEPTIONIST.md as optional rather than assumed.
 */

const DIMENSIONS = 384;

let pipelinePromise = null;
let unavailableReason = null;

/** Loads the optional local model, once, and never complains twice. */
async function loadPipeline() {
  if (unavailableReason) return null;
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      try {
        // eslint-disable-next-line global-require, import/no-extraneous-dependencies
        const { pipeline } = require('@huggingface/transformers');
        const model = process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2';
        return await pipeline('feature-extraction', model, { dtype: 'q8' });
      } catch (err) {
        unavailableReason = err.code === 'MODULE_NOT_FOUND'
          ? 'not installed'
          : err.message.slice(0, 120);
        return null;
      }
    })();
  }
  return pipelinePromise;
}

/**
 * @returns {Promise<number[]|null>} a 384-value embedding, or null when there
 * is no model - which is the normal case and not a failure.
 */
async function embed(text) {
  const input = String(text || '').trim();
  if (!input) return null;

  const pipe = await loadPipeline();
  if (!pipe) return null;

  try {
    const output = await pipe(input, { pooling: 'mean', normalize: true });
    const values = Array.from(output.data || []);
    return values.length === DIMENSIONS ? values : null;
  } catch {
    return null;
  }
}

/** Which model produced the embeddings, so a change of model invalidates them. */
function embeddingModel() {
  if (unavailableReason) return null;
  return pipelinePromise ? (process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2') : null;
}

/** For the Health tab: whether semantic search is on, and why not if it is off. */
async function status() {
  const pipe = await loadPipeline();
  return {
    available: Boolean(pipe),
    model: embeddingModel(),
    reason: unavailableReason,
    dimensions: DIMENSIONS,
    note: pipe
      ? 'Semantic search is on.'
      : 'Semantic search is off. Search uses full text and trigram matching, which is enough for a knowledge base this size.',
  };
}

module.exports = { embed, embeddingModel, status, DIMENSIONS };
