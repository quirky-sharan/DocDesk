const db = require('./index');

const SUPPLIERS = [
  ['Northwind Trading', 'Asha Mehta', '+91 98200 11223', 'orders@northwind.example', 'Mon-Fri, 48h lead time'],
  ['Kapoor Wholesale', 'Ravi Kapoor', '+91 98110 44556', 'sales@kapoor.example', 'Best prices on bulk stationery'],
  ['Meridian Supplies', 'Faisal Khan', '+91 99870 33445', 'hello@meridian.example', 'Next-day on hygiene lines'],
  ['Lakeview Distributors', 'Nina Rao', '+91 97640 88112', 'accounts@lakeview.example', 'Minimum order 5000'],
];

// [sku, name, category, unit, cost, price, stock, reorder_level]
// Spread across price points and stock states so every filter, badge and chart
// has something real to show.
const PRODUCTS = [
  ['SKU-001', 'A4 Paper Ream', 'Stationery', 'ream', 210, 285, 48, 10],
  ['SKU-002', 'Ballpoint Pen (Blue)', 'Stationery', 'box', 90, 140, 6, 12],
  ['SKU-003', 'Hand Sanitiser 500ml', 'Hygiene', 'bottle', 115, 180, 0, 8],
  ['SKU-004', 'Nitrile Gloves (M)', 'Hygiene', 'box', 340, 460, 22, 10],
  ['SKU-005', 'Thermal Till Roll', 'Consumables', 'roll', 18, 30, 150, 40],
  ['SKU-006', 'Desk Organiser', 'Stationery', 'unit', 260, 420, 17, 5],
  ['SKU-007', 'Whiteboard Marker Set', 'Stationery', 'set', 130, 215, 9, 10],
  ['SKU-008', 'Surface Wipes (200pk)', 'Hygiene', 'tub', 195, 310, 31, 12],
  ['SKU-009', 'Printer Toner TN-2400', 'Electronics', 'cartridge', 1850, 2600, 4, 3],
  ['SKU-010', 'USB-C Cable 1m', 'Electronics', 'unit', 120, 240, 64, 20],
  ['SKU-011', 'Desk Lamp (LED)', 'Electronics', 'unit', 890, 1399, 11, 4],
  ['SKU-012', 'Sticky Notes (12pk)', 'Stationery', 'pack', 85, 150, 73, 25],
  ['SKU-013', 'Box File (Foolscap)', 'Stationery', 'unit', 95, 165, 2, 15],
  ['SKU-014', 'Disinfectant Spray 1L', 'Hygiene', 'bottle', 175, 275, 26, 10],
  ['SKU-015', 'Stapler (Heavy Duty)', 'Stationery', 'unit', 240, 385, 13, 6],
  ['SKU-016', 'Paper Clips (1000)', 'Stationery', 'box', 45, 90, 88, 30],
  ['SKU-017', 'Laminating Pouches A4', 'Consumables', 'pack', 310, 480, 19, 8],
  ['SKU-018', 'Extension Lead 4-way', 'Electronics', 'unit', 420, 690, 7, 5],
];

const CUSTOMERS = [
  ['Priya Sharma', '+91 99300 12345', 'priya@example.com', '14 Nehru Park, Indore'],
  ['Arun Desai', '+91 99300 67890', 'arun@example.com', '2B Lake Road, Bhopal'],
  ['Meera Iyer', '+91 98450 22110', 'meera@example.com', '88 Residency Road'],
  ['Sunrise Dental Clinic', '+91 97300 55221', 'admin@sunrisedental.example', '5 Clinic Lane'],
  ['Vikram Nair', '+91 90010 77553', 'vikram@example.com', ''],
  ['Greenfield Academy', '+91 93110 66442', 'office@greenfield.example', '12 School Road'],
  ['Rohit Malhotra', '+91 99887 12009', 'rohit@example.com', ''],
  ['Anita Bose', '+91 98330 45670', 'anita@example.com', '31 Park Street'],
];

const PAYMENT_METHODS = ['cash', 'card', 'upi', 'bank'];

// Seeded generator: the sample data looks varied but is identical every time,
// so a screenshot or a bug report is reproducible.
function makeRandom(seed) {
  let state = seed;
  return function random() {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function dateDaysAgo(days, hour) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, (hour * 7) % 60, 0, 0);
  // Matches the 'YYYY-MM-DD HH:MM:SS' the database's own clock produces.
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const DAYS_OF_HISTORY = 75;

async function seed() {
  // Sample rows use fixed SKUs, which are UNIQUE, so a second run would collide.
  // Refuse before touching anything rather than failing partway through, and
  // never silently overwrite records the user may have entered themselves.
  const { rows } = await db.query('SELECT COUNT(*) AS count FROM products');
  if (Number(rows[0].count) > 0) {
    const err = new Error(
      'There are already records in the database. Use "Clear all" first if you want to reload the sample data.'
    );
    err.status = 409;
    throw err;
  }

  return db.transaction(async (tx) => {
    const random = makeRandom(20260915);

    const supplierIds = [];
    for (const [name, contact, phone, email, notes] of SUPPLIERS) {
      const { rows: r } = await tx.query(
        `INSERT INTO suppliers (name, contact_name, phone, email, notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [name, contact, phone, email, notes]
      );
      supplierIds.push(r[0].id);
    }

    const products = [];
    for (const [i, p] of PRODUCTS.entries()) {
      const { rows: r } = await tx.query(
        `INSERT INTO products
           (sku, name, category, unit, cost_price, sale_price, stock_quantity, reorder_level, supplier_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, name, sale_price, cost_price, stock_quantity`,
        [...p, supplierIds[i % supplierIds.length]]
      );
      products.push(r[0]);
    }

    const customerIds = [];
    for (const [name, phone, email, address] of CUSTOMERS) {
      const { rows: r } = await tx.query(
        `INSERT INTO customers (name, phone, email, address) VALUES ($1,$2,$3,$4) RETURNING id`,
        [name, phone, email, address]
      );
      customerIds.push(r[0].id);
    }

    // Sales are backdated across the last ~2.5 months so the trend charts and
    // the date filters have a real shape to show. Stock is NOT decremented for
    // these: the quantities above are the current on-hand figures, and a sale
    // from six weeks ago has already been accounted for in them.
    let saleCount = 0;
    let saleSeq = 0;

    for (let daysAgo = DAYS_OF_HISTORY; daysAgo >= 0; daysAgo--) {
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      const weekday = date.getDay();

      // Quieter at weekends, and busier in the recent weeks, so the chart is
      // not a flat wall of identical bars.
      const weekendFactor = weekday === 0 ? 0.25 : weekday === 6 ? 0.6 : 1;
      const recencyFactor = 0.7 + (1 - daysAgo / DAYS_OF_HISTORY) * 0.6;
      const salesToday = Math.round(random() * 4 * weekendFactor * recencyFactor);

      for (let n = 0; n < salesToday; n++) {
        const hour = 9 + Math.floor(random() * 9);
        const createdAt = dateDaysAgo(daysAgo, hour);

        // Roughly a third are walk-ins with no customer record.
        const customerId = random() < 0.66
          ? customerIds[Math.floor(random() * customerIds.length)]
          : null;

        const lineCount = 1 + Math.floor(random() * 3);
        const chosen = [];
        for (let l = 0; l < lineCount; l++) {
          const product = products[Math.floor(random() * products.length)];
          if (chosen.some((c) => c.id === product.id)) continue;
          chosen.push(product);
        }
        if (!chosen.length) continue;

        const lines = chosen.map((product) => {
          const quantity = 1 + Math.floor(random() * 4);
          const unitPrice = Number(product.sale_price);
          return {
            productId: product.id,
            description: product.name,
            quantity,
            unitPrice,
            lineTotal: money(quantity * unitPrice),
          };
        });

        const subtotal = money(lines.reduce((sum, l) => sum + l.lineTotal, 0));
        const discount = random() < 0.15 ? money(subtotal * 0.05) : 0;
        const taxable = subtotal - discount;
        const tax = money(taxable * 0.05);
        const total = money(taxable + tax);

        // Some recent sales are left unpaid so the outstanding figure and the
        // unpaid filter have something in them.
        const unpaid = daysAgo < 30 && random() < 0.3;
        const paymentStatus = unpaid ? (random() < 0.5 ? 'unpaid' : 'partial') : 'paid';

        saleSeq++;
        const { rows: saleRows } = await tx.query(
          `INSERT INTO sales (reference, customer_id, subtotal, tax, discount, total,
                              payment_status, payment_method, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            `S-${1000 + saleSeq}`,
            customerId,
            subtotal,
            tax,
            discount,
            total,
            paymentStatus,
            PAYMENT_METHODS[Math.floor(random() * PAYMENT_METHODS.length)],
            createdAt,
          ]
        );
        const saleId = saleRows[0].id;

        for (const line of lines) {
          await tx.query(
            `INSERT INTO sale_items (sale_id, product_id, description, quantity, unit_price, line_total)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [saleId, line.productId, line.description, line.quantity, line.unitPrice, line.lineTotal]
          );
        }
        saleCount++;
      }
    }

    // One order already fully received, one part-arrived, one still outstanding,
    // so every status badge and the receive flow have a real example.
    const purchaseOrders = [
      { supplier: 0, status: 'received', daysAgo: 12, items: [[0, 50, 1.0], [4, 200, 1.0]] },
      { supplier: 2, status: 'partial', daysAgo: 4, items: [[2, 40, 0.5], [13, 20, 0.0]] },
      { supplier: 1, status: 'ordered', daysAgo: 1, items: [[1, 30, 0.0], [12, 40, 0.0], [15, 25, 0.0]] },
    ];

    let poSeq = 0;
    for (const order of purchaseOrders) {
      poSeq++;
      const lines = order.items.map(([index, quantity, receivedRatio]) => {
        const product = products[index];
        return {
          productId: product.id,
          description: product.name,
          quantity,
          received: Math.round(quantity * receivedRatio),
          unitCost: Number(product.cost_price),
        };
      });
      const total = money(lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0));

      const expected = new Date();
      expected.setDate(expected.getDate() - order.daysAgo + 7);

      const { rows: poRows } = await tx.query(
        `INSERT INTO purchase_orders (reference, supplier_id, status, expected_date, received_date, total, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          `PO-${1000 + poSeq}`,
          supplierIds[order.supplier],
          order.status,
          expected.toISOString().slice(0, 10),
          order.status === 'received' ? dateDaysAgo(order.daysAgo - 2, 11).slice(0, 10) : null,
          total,
          dateDaysAgo(order.daysAgo, 10),
        ]
      );

      for (const line of lines) {
        await tx.query(
          `INSERT INTO purchase_order_items
             (purchase_order_id, product_id, description, quantity, quantity_received, unit_cost)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [poRows[0].id, line.productId, line.description, line.quantity, line.received, line.unitCost]
        );
      }
    }

    // Queue the alerts the current stock levels would actually have raised.
    const { rows: lowStock } = await tx.query(
      `SELECT id, name, sku, stock_quantity, reorder_level FROM products
       WHERE reorder_level > 0 AND stock_quantity <= reorder_level`
    );
    for (const product of lowStock) {
      const out = Number(product.stock_quantity) <= 0;
      await tx.query(
        `INSERT INTO message_log (channel, subject, body, trigger_type, status, related_type, related_id)
         VALUES ('email',$1,$2,'low_stock','queued','product',$3)`,
        [
          out ? `Out of stock: ${product.name}` : `Running low: ${product.name}`,
          out
            ? `${product.name} (${product.sku}) has sold out. Reorder level is ${product.reorder_level}.`
            : `${product.name} (${product.sku}) is down to ${product.stock_quantity}, at or below its reorder level of ${product.reorder_level}.`,
          product.id,
        ]
      );
    }

    await tx.query(
      `INSERT INTO settings (key, value) VALUES ('business_name', 'DocDesk Demo Store')`
    );

    return {
      suppliers: supplierIds.length,
      products: products.length,
      customers: customerIds.length,
      sales: saleCount,
      purchaseOrders: purchaseOrders.length,
      alerts: lowStock.length,
    };
  });
}

// Order matters: children before parents, so foreign keys stay satisfied.
const CLEAR_ORDER = [
  'sale_items', 'sales', 'purchase_order_items', 'purchase_orders',
  'message_log', 'products', 'customers', 'suppliers', 'settings',
];

async function clear() {
  return db.transaction(async (tx) => {
    for (const table of CLEAR_ORDER) {
      await tx.query(`DELETE FROM ${table}`);
    }
    return { cleared: CLEAR_ORDER.length };
  });
}

module.exports = { seed, clear };

if (require.main === module) {
  const action = process.argv[2] === 'clear' ? clear : seed;
  action()
    .then(async (result) => {
      console.log(process.argv[2] === 'clear' ? 'cleared' : 'seeded', result);
      await db.close();
    })
    .catch(async (err) => {
      console.error('failed:', err.message);
      await db.close();
      process.exit(1);
    });
}
