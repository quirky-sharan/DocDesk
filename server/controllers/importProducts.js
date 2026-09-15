const fs = require('fs');
const db = require('../db');
const { fail, text, number, money } = require('../lib/validate');
const { deleteStored } = require('../lib/storage');
const { checkStockLevels } = require('../lib/messaging');

/**
 * Minimal RFC 4180 parser. Written rather than pulled in because the whole job
 * is quoted fields, doubled quotes and newlines inside quotes - and a
 * spreadsheet export from a real shop will contain all three.
 */
function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // A byte order mark from Excel would otherwise become part of the first header.
  if (content.charCodeAt(0) === 0xfeff) i = 1;

  while (i < content.length) {
    const char = content[i];

    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
    } else if (char === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (char === '\r') {
      i++;
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else {
      field += char;
      i++;
    }
  }

  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

// Header aliases, because nobody's spreadsheet uses our column names. Matching
// is done on a normalised form so "Sale Price", "sale_price" and "saleprice"
// all land in the same place.
const COLUMN_ALIASES = {
  name: ['name', 'product', 'productname', 'item', 'itemname', 'description', 'title'],
  sku: ['sku', 'code', 'productcode', 'itemcode', 'barcode', 'ref'],
  category: ['category', 'type', 'group', 'department'],
  unit: ['unit', 'uom', 'measure'],
  cost_price: ['costprice', 'cost', 'buyprice', 'purchaseprice', 'wholesale'],
  sale_price: ['saleprice', 'price', 'sellprice', 'retail', 'mrp', 'rate'],
  stock_quantity: ['stockquantity', 'stock', 'quantity', 'qty', 'onhand', 'instock'],
  reorder_level: ['reorderlevel', 'reorder', 'minstock', 'minimum', 'reorderpoint', 'threshold'],
};

function normalise(header) {
  return String(header).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapHeaders(headerRow) {
  const mapping = {};
  headerRow.forEach((header, index) => {
    const key = normalise(header);
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (mapping[field] === undefined && aliases.includes(key)) {
        mapping[field] = index;
        return;
      }
    }
  });
  return mapping;
}

/** Reads the file and reports what would be imported, without writing anything. */
exports.preview = async (req, res, next) => {
  try {
    const parsed = await readUpload(req);
    res.json(parsed);
  } catch (err) {
    next(err);
  } finally {
    if (req.file) await deleteStored(req.file.filename).catch(() => {});
  }
};

async function readUpload(req) {
  if (!req.file) throw fail('Choose a CSV file to import.');
  const content = await fs.promises.readFile(req.file.path, 'utf8');
  const rows = parseCsv(content);
  if (rows.length < 2) throw fail('That file has no rows under its heading line.');

  const headerRow = rows[0];
  const mapping = mapHeaders(headerRow);
  if (mapping.name === undefined) {
    throw fail(
      `Couldn't find a product name column. The heading row was: ${headerRow.join(', ')}. ` +
        'Rename one column to "Name" and try again.'
    );
  }

  const items = [];
  const problems = [];

  rows.slice(1).forEach((cells, index) => {
    const lineNumber = index + 2;
    const read = (field) => (mapping[field] === undefined ? '' : (cells[mapping[field]] ?? '').trim());

    try {
      const item = {
        name: text(read('name'), `Row ${lineNumber}: name`, { required: true, max: 200 }),
        sku: text(read('sku'), `Row ${lineNumber}: SKU`, { max: 80 }),
        category: text(read('category'), `Row ${lineNumber}: category`, { max: 100 }),
        unit: text(read('unit'), `Row ${lineNumber}: unit`, { max: 40 }) || 'unit',
        cost_price: money(number(read('cost_price'), `Row ${lineNumber}: cost price`, { min: 0, fallback: 0 })),
        sale_price: money(number(read('sale_price'), `Row ${lineNumber}: sale price`, { min: 0, fallback: 0 })),
        stock_quantity: number(read('stock_quantity'), `Row ${lineNumber}: stock`, { integer: true, fallback: 0 }),
        reorder_level: number(read('reorder_level'), `Row ${lineNumber}: reorder level`, { min: 0, integer: true, fallback: 0 }),
      };
      items.push({ line: lineNumber, item });
    } catch (err) {
      problems.push({ line: lineNumber, message: err.message });
    }
  });

  return {
    detectedColumns: Object.fromEntries(
      Object.entries(mapping).map(([field, index]) => [field, headerRow[index]])
    ),
    ignoredColumns: headerRow.filter((_, i) => !Object.values(mapping).includes(i)),
    readyCount: items.length,
    problemCount: problems.length,
    problems: problems.slice(0, 25),
    sample: items.slice(0, 5).map((r) => r.item),
    items: items.map((r) => r.item),
  };
}

/**
 * Writes the rows. Existing SKUs are updated rather than duplicated, so
 * re-importing a corrected spreadsheet is safe.
 */
exports.commit = async (req, res, next) => {
  try {
    const parsed = await readUpload(req);
    if (!parsed.items.length) throw fail('There were no usable rows to import.');

    const result = await db.transaction(async (tx) => {
      let created = 0;
      let updated = 0;
      const touched = [];

      for (const item of parsed.items) {
        let existingId = null;
        if (item.sku) {
          const { rows } = await tx.query('SELECT id FROM products WHERE sku = $1', [item.sku]);
          existingId = rows[0]?.id ?? null;
        }

        if (existingId) {
          await tx.query(
            `UPDATE products SET name=$1, category=$2, unit=$3, cost_price=$4,
               sale_price=$5, stock_quantity=$6, reorder_level=$7, updated_at=CURRENT_TIMESTAMP
             WHERE id=$8`,
            [item.name, item.category, item.unit, item.cost_price, item.sale_price,
             item.stock_quantity, item.reorder_level, existingId]
          );
          touched.push(existingId);
          updated++;
        } else {
          const { rows } = await tx.query(
            `INSERT INTO products (name, sku, category, unit, cost_price, sale_price, stock_quantity, reorder_level)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [item.name, item.sku, item.category, item.unit, item.cost_price,
             item.sale_price, item.stock_quantity, item.reorder_level]
          );
          touched.push(rows[0].id);
          created++;
        }
      }

      await checkStockLevels(tx, touched);
      return { created, updated };
    });

    res.status(201).json({
      ok: true,
      ...result,
      skipped: parsed.problemCount,
      problems: parsed.problems,
    });
  } catch (err) {
    next(err);
  } finally {
    if (req.file) await deleteStored(req.file.filename).catch(() => {});
  }
};

exports.parseCsv = parseCsv;
