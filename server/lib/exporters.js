const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const FORMATS = ['csv', 'json', 'xlsx', 'pdf'];

function prettyHeader(key) {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function cellToText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

// RFC 4180: quote when the value contains a delimiter, quote or newline, and
// escape embedded quotes by doubling them.
function csvCell(value) {
  const text = cellToText(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows, columns) {
  const header = columns.map((c) => csvCell(prettyHeader(c))).join(',');
  const body = rows.map((row) => columns.map((c) => csvCell(row[c])).join(','));
  // Excel only reliably detects UTF-8 in a CSV when there is a byte order mark.
  return '﻿' + [header, ...body].join('\r\n');
}

async function toXlsx(rows, columns, sheetName) {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31) || 'Data');

  sheet.columns = columns.map((key) => ({
    header: prettyHeader(key),
    key,
    width: Math.min(Math.max(prettyHeader(key).length + 4, 12), 40),
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of rows) {
    const record = {};
    for (const key of columns) record[key] = row[key] ?? '';
    sheet.addRow(record);
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function pdfToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

async function toPdfTable(rows, columns, title) {
  // Landscape, because an exported table is usually wider than it is tall.
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });

  doc.fontSize(16).text(title, { continued: false });
  doc.fontSize(9).fillColor('#666')
    .text(`${rows.length} record${rows.length === 1 ? '' : 's'} — exported ${new Date().toLocaleString()}`);
  doc.moveDown(0.8);
  doc.fillColor('#000');

  const usable = doc.page.width - doc.options.margin * 2;
  const columnWidth = usable / columns.length;
  const rowHeight = 16;

  function drawHeader() {
    const y = doc.y;
    doc.fontSize(8).font('Helvetica-Bold');
    columns.forEach((c, i) => {
      doc.text(prettyHeader(c), doc.options.margin + i * columnWidth, y, {
        width: columnWidth - 4,
        ellipsis: true,
      });
    });
    doc.font('Helvetica');
    doc.moveTo(doc.options.margin, y + rowHeight - 4)
      .lineTo(doc.page.width - doc.options.margin, y + rowHeight - 4)
      .strokeColor('#ccc').stroke();
    doc.y = y + rowHeight;
  }

  drawHeader();

  for (const row of rows) {
    if (doc.y + rowHeight > doc.page.height - doc.options.margin) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    doc.fontSize(8);
    columns.forEach((c, i) => {
      doc.text(cellToText(row[c]), doc.options.margin + i * columnWidth, y, {
        width: columnWidth - 4,
        height: rowHeight,
        ellipsis: true,
        lineBreak: false,
      });
    });
    doc.y = y + rowHeight;
  }

  if (!rows.length) {
    doc.moveDown().fontSize(10).fillColor('#666').text('No records to export.');
  }

  return pdfToBuffer(doc);
}

async function receiptToPdf(receipt) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const money = (n) => Number(n || 0).toFixed(2);
  const right = doc.page.width - 50;

  const business = receipt.business || {};
  doc.fontSize(22).font('Helvetica-Bold').text(business.name || 'Receipt');
  doc.fontSize(10).font('Helvetica').fillColor('#666');
  for (const line of [business.address, [business.phone, business.email].filter(Boolean).join('  ·  ')]) {
    if (line) doc.text(line);
  }
  doc.fillColor('#000').moveDown(1.2);

  doc.fontSize(11).font('Helvetica-Bold').text(receipt.reference || 'Receipt');
  doc.font('Helvetica').fontSize(9).fillColor('#666')
    .text(new Date(receipt.issuedAt).toLocaleString());
  doc.fillColor('#000');

  if (receipt.customer?.name) {
    doc.moveDown(0.6).fontSize(10).text(`Billed to: ${receipt.customer.name}`);
    const contact = [receipt.customer.phone, receipt.customer.email].filter(Boolean).join('  ·  ');
    if (contact) doc.fontSize(9).fillColor('#666').text(contact).fillColor('#000');
  }

  doc.moveDown(1);

  const columns = [
    { label: 'Description', x: 50, width: 240, align: 'left' },
    { label: 'Qty', x: 300, width: 50, align: 'right' },
    { label: 'Price', x: 360, width: 80, align: 'right' },
    { label: 'Amount', x: 450, width: 95, align: 'right' },
  ];

  let y = doc.y;
  doc.fontSize(9).font('Helvetica-Bold');
  columns.forEach((c) => doc.text(c.label, c.x, y, { width: c.width, align: c.align }));
  doc.font('Helvetica');
  y += 14;
  doc.moveTo(50, y).lineTo(right, y).strokeColor('#ddd').stroke();
  y += 8;

  for (const item of receipt.items) {
    if (y > doc.page.height - 160) {
      doc.addPage();
      y = 50;
    }
    const values = [item.description, String(item.quantity), money(item.unitPrice), money(item.lineTotal)];
    doc.fontSize(9);
    columns.forEach((c, i) => {
      doc.text(values[i], c.x, y, { width: c.width, align: c.align, ellipsis: true });
    });
    y += 16;
  }

  y += 4;
  doc.moveTo(50, y).lineTo(right, y).strokeColor('#ddd').stroke();
  y += 10;

  const totals = [
    ['Subtotal', receipt.totals.subtotal],
    ...(receipt.totals.discount ? [['Discount', -receipt.totals.discount]] : []),
    ...(receipt.totals.tax ? [['Tax', receipt.totals.tax]] : []),
  ];

  doc.fontSize(9);
  for (const [label, amount] of totals) {
    doc.text(label, 360, y, { width: 80, align: 'right' });
    doc.text(money(amount), 450, y, { width: 95, align: 'right' });
    y += 14;
  }

  doc.fontSize(12).font('Helvetica-Bold');
  doc.text('Total', 360, y + 2, { width: 80, align: 'right' });
  doc.text(money(receipt.totals.total), 450, y + 2, { width: 95, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#666');
  y += 24;
  doc.text(
    `Payment: ${receipt.payment.status}${receipt.payment.method ? ` (${receipt.payment.method})` : ''}`,
    50,
    y
  );

  if (receipt.notes) {
    doc.moveDown(1).fillColor('#000').fontSize(9).text(receipt.notes, 50, undefined, { width: 400 });
  }
  if (business.footer) {
    doc.moveDown(1.5).fillColor('#666').fontSize(9).text(business.footer, 50, undefined, {
      width: doc.page.width - 100,
      align: 'center',
    });
  }

  return pdfToBuffer(doc);
}

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/**
 * Renders rows in the requested format and returns what the route needs to
 * stream it back.
 */
async function render({ rows, columns, format, title, filename }) {
  switch (format) {
    case 'csv':
      return { body: Buffer.from(toCsv(rows, columns), 'utf8'), contentType: CONTENT_TYPES.csv, filename: `${filename}.csv` };
    case 'json':
      return {
        body: Buffer.from(JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, rows }, null, 2), 'utf8'),
        contentType: CONTENT_TYPES.json,
        filename: `${filename}.json`,
      };
    case 'xlsx':
      return { body: await toXlsx(rows, columns, title), contentType: CONTENT_TYPES.xlsx, filename: `${filename}.xlsx` };
    case 'pdf':
      return { body: await toPdfTable(rows, columns, title), contentType: CONTENT_TYPES.pdf, filename: `${filename}.pdf` };
    default:
      throw Object.assign(new Error(`Unsupported format "${format}". Use one of: ${FORMATS.join(', ')}`), { status: 400 });
  }
}

module.exports = { FORMATS, render, receiptToPdf, CONTENT_TYPES };
