const { status: llmStatus } = require('../lib/llm');
const { interpret } = require('../lib/nlq/interpret');
const { validateOperation, describe, isDestructive, changesSchema } = require('../lib/nlq/operations');
const { preview, apply } = require('../lib/nlq/execute');
const { TABLES, describeTable, badRequest } = require('../lib/tables');

exports.status = async (req, res, next) => {
  try {
    const info = llmStatus();
    res.json({
      ...info,
      // Without a key a few common phrasings still work through the rule-based
      // interpreter, so the UI can say that rather than just "unavailable".
      fallback: info.configured ? null : 'Simple requests like "sort by price" still work without a key.',
      tables: Object.entries(TABLES).map(([name, c]) => ({ name, label: c.label })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Plain English in, a described operation plus a preview out. Nothing is
 * changed here - the user sees what would happen and confirms separately.
 */
exports.interpret = async (req, res, next) => {
  try {
    const { table, request } = req.body || {};
    if (!table) throw badRequest('Which table did you mean?');

    const result = await interpret(table, request);
    const previewResult = await preview(table, result.operation);

    res.json({
      operation: result.operation,
      explanation: describe(result.operation),
      destructive: isDestructive(result.operation),
      changesSchema: changesSchema(result.operation),
      preview: previewResult,
      source: result.source,
      model: result.model,
      provider: result.provider,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Runs an operation the user has already seen and agreed to.
 *
 * The operation is re-validated rather than trusted: this request arrives from
 * the browser, so the shape that was approved is not necessarily the shape that
 * comes back.
 */
exports.apply = async (req, res, next) => {
  try {
    const { table, operation } = req.body || {};
    if (!table) throw badRequest('Which table did you mean?');
    if (!operation) throw badRequest('There is nothing to apply.');

    const validated = await validateOperation(table, {
      ...operation,
      // validateOperation reads the creation type from type_hint; the validated
      // operation carries it as columnType.
      type_hint: operation.type_hint || operation.columnType,
    });

    const result = await apply(table, validated);
    const columns = await describeTable(table);

    res.json({
      ...result,
      operation: validated,
      explanation: describe(validated),
      columns: columns.map((c) => c.name),
    });
  } catch (err) {
    next(err);
  }
};
