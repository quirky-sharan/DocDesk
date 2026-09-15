const { TABLES, INTERNAL_COLUMNS, assertTable, listColumns, listRows } = require('../lib/tables');
const { render, receiptToPdf, CONTENT_TYPES, FORMATS } = require('../lib/exporters');
const { buildReceipt } = require('./sales');
const { resolveTimezone } = require('../lib/timezone');

// The same filters the list pages use, so a download is exactly what was on screen.
const STOCK_FILTERS = {
  low: 't.reorder_level > 0 AND t.stock_quantity > 0 AND t.stock_quantity <= t.reorder_level',
  out: 't.stock_quantity <= 0',
  in: 't.stock_quantity > 0',
};
const FILE_KINDS = {
  image: "t.mime_type LIKE 'image/%'",
  pdf: "t.mime_type = 'application/pdf'",
  document: "(t.mime_type LIKE 'application/vnd%' OR t.mime_type = 'application/msword')",
  data: "t.mime_type IN ('text/csv', 'application/json', 'text/plain')",
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function filtersFor(table, query, req) {
  switch (table) {
    case 'products':
      return {
        where: { category: query.category, supplier_id: query.supplier_id },
        extraConditions: STOCK_FILTERS[query.stock] ? [STOCK_FILTERS[query.stock]] : [],
      };
    case 'sales':
      return {
        where: { payment_status: query.payment_status },
        ranges: [{
          column: 'created_at',
          from: DATE.test(query.from || '') ? query.from : undefined,
          to: DATE.test(query.to || '') ? query.to : undefined,
          timezone: await resolveTimezone(req),
        }],
      };
    case 'purchase_orders':
    case 'message_log':
      return { where: { status: query.status } };
    case 'files':
      return { extraConditions: FILE_KINDS[query.kind] ? [FILE_KINDS[query.kind]] : [] };
    default:
      return {};
  }
}

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
 * Exports any whitelisted table in any supported format. Honours the search,
 * sort and filters the person had applied on screen.
 */
exports.table = async (req, res, next) => {
  try {
    const { table } = req.params;
    const config = assertTable(table);
    const format = String(req.query.format || 'csv').toLowerCase();
    const { search, sort, dir } = req.query;

    // paginate:false - an export is the whole filtered set, not one page.
    const { rows } = await listRows(table, { search, sort, dir, paginate: false, ...(await filtersFor(table, req.query, req)) });
    const columns = (await listColumns(table)).map((c) => c.name).filter((name) => !INTERNAL_COLUMNS.has(name));

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
