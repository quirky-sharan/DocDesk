const { TABLES, assertTable, describeTable, listRows } = require('../lib/tables');
const { render, receiptToPdf, CONTENT_TYPES, FORMATS } = require('../lib/exporters');
const { buildReceipt } = require('./sales');

// What can be exported, so the UI can offer it without hardcoding a list.
exports.options = async (req, res, next) => {
  try {
    res.json({
      formats: FORMATS,
      tables: Object.entries(TABLES).map(([name, config]) => ({ name, label: config.label })),
    });
  } catch (err) {
    next(err);
  }
};

function sendFile(res, { body, contentType, filename }) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', body.length);
  res.send(body);
}

/**
 * Exports any whitelisted table in any supported format. Honours the same
 * search/sort/filter the user had applied on screen, so what downloads matches
 * what they were looking at.
 */
exports.table = async (req, res, next) => {
  try {
    const { table } = req.params;
    const config = assertTable(table);
    const format = String(req.query.format || 'csv').toLowerCase();
    const { search, sort, dir } = req.query;

    const { rows } = await listRows(table, { search, sort, dir });
    const columns = (await describeTable(table)).map((c) => c.name);

    const stamp = new Date().toISOString().slice(0, 10);
    sendFile(
      res,
      await render({
        rows,
        columns,
        format,
        title: config.label,
        filename: `docdesk-${table}-${stamp}`,
      })
    );
  } catch (err) {
    next(err);
  }
};

// A receipt is a document rather than a table, so it gets its own layout.
exports.receipt = async (req, res, next) => {
  try {
    const receipt = await buildReceipt(req.params.id);
    const body = await receiptToPdf(receipt);
    sendFile(res, {
      body,
      contentType: CONTENT_TYPES.pdf,
      filename: `receipt-${receipt.reference || req.params.id}.pdf`,
    });
  } catch (err) {
    next(err);
  }
};
