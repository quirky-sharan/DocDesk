const db = require('./index');
const { lineTotalCents, taxCents, toCents, fromCents } = require('../lib/money');

/**
 * Sample data: five months of a small shop's trading, generated as a story and
 * replayed through the real database rules - opening stock, then every sale,
 * payment, delivery and stock correction in time order - so the stock ledger,
 * low-stock alerts, payment statuses and reports are exactly what the triggers
 * produce, and the numbers all agree with each other.
 *
 * Seeded random numbers: the data looks varied but is identical on every run,
 * so screenshots and bug reports stay reproducible.
 */

const DAYS = 150;
const TIMEZONE = 'Asia/Kolkata';
const TZ_OFFSET_MINUTES = 330; // IST has no daylight saving

const CATEGORIES = ['Stationery', 'Hygiene', 'Electronics', 'Consumables', 'Pantry', 'Packaging'];

const SUPPLIERS = [
  ['Northwind Trading', 'Asha Mehta', '+91 98200 11223', 'orders@northwind.example', 'Mon-Fri, 48h lead time'],
  ['Kapoor Wholesale', 'Ravi Kapoor', '+91 98110 44556', 'sales@kapoor.example', 'Best prices on bulk stationery'],
  ['Meridian Supplies', 'Faisal Khan', '+91 99870 33445', 'hello@meridian.example', 'Next-day on hygiene lines'],
  ['Lakeview Distributors', 'Nina Rao', '+91 97640 88112', 'accounts@lakeview.example', 'Minimum order 5000'],
  ['Voltline Electronics', 'Karan Sethi', '+91 90040 77881', 'trade@voltline.example', 'Warranty claims via email'],
];

// [sku, name, category, unit, cost, price, stock today, reorder level, supplier, popularity]
const PRODUCTS = [
  ['SKU-001', 'A4 Paper Ream (500 sheets)', 0, 'ream', 210, 285, 48, 10, 0, 9],
  ['SKU-002', 'Ballpoint Pens (Blue, 10pk)', 0, 'pack', 90, 140, 6, 12, 1, 8],
  ['SKU-003', 'Hand Sanitiser 500ml', 1, 'bottle', 115, 180, 0, 8, 2, 6],
  ['SKU-004', 'Nitrile Gloves (M, 100pk)', 1, 'box', 340, 460, 22, 10, 2, 4],
  ['SKU-005', 'Thermal Till Roll', 3, 'roll', 18, 30, 150, 40, 1, 6],
  ['SKU-006', 'Desk Organiser', 0, 'unit', 260, 420, 17, 5, 0, 3],
  ['SKU-007', 'Whiteboard Marker Set', 0, 'set', 130, 215, 9, 10, 1, 4],
  ['SKU-008', 'Surface Wipes (200pk)', 1, 'tub', 195, 310, 31, 12, 2, 4],
  ['SKU-009', 'Printer Toner TN-2400', 2, 'cartridge', 1850, 2600, 4, 3, 4, 2],
  ['SKU-010', 'USB-C Cable 1m', 2, 'unit', 120, 240, 64, 20, 4, 5],
  ['SKU-011', 'Desk Lamp (LED)', 2, 'unit', 890, 1399, 11, 4, 4, 2],
  ['SKU-012', 'Sticky Notes (12pk)', 0, 'pack', 85, 150, 73, 25, 1, 7],
  ['SKU-013', 'Box File (Foolscap)', 0, 'unit', 95, 165, 2, 15, 0, 4],
  ['SKU-014', 'Disinfectant Spray 1L', 1, 'bottle', 175, 275, 26, 10, 2, 3],
  ['SKU-015', 'Stapler (Heavy Duty)', 0, 'unit', 240, 385, 13, 6, 1, 2],
  ['SKU-016', 'Paper Clips (1000)', 0, 'box', 45, 90, 88, 30, 1, 5],
  ['SKU-017', 'Laminating Pouches A4 (100)', 3, 'pack', 310, 480, 19, 8, 1, 2],
  ['SKU-018', 'Extension Lead 4-way', 2, 'unit', 420, 690, 7, 5, 4, 2],
  ['SKU-019', 'Spiral Notebook A5', 0, 'unit', 38, 65, 120, 40, 0, 8],
  ['SKU-020', 'Gel Pen Set (6 colours)', 0, 'set', 110, 180, 0, 8, 1, 4],
  ['SKU-021', 'Hand Wash Refill 5L', 1, 'can', 420, 640, 9, 4, 2, 2],
  ['SKU-022', 'Tissue Box (Pack of 4)', 1, 'pack', 120, 199, 44, 15, 2, 6],
  ['SKU-023', 'Wireless Mouse', 2, 'unit', 390, 699, 18, 6, 4, 3],
  ['SKU-024', 'AA Batteries (8pk)', 2, 'pack', 160, 260, 3, 10, 4, 5],
  ['SKU-025', 'Printer Ink Refill (Black)', 3, 'bottle', 240, 399, 27, 8, 1, 3],
  ['SKU-026', 'Instant Coffee 200g', 4, 'jar', 310, 449, 16, 6, 3, 4],
  ['SKU-027', 'Green Tea (100 bags)', 4, 'box', 260, 375, 21, 8, 3, 3],
  ['SKU-028', 'Drinking Water 20L', 4, 'can', 55, 90, 34, 12, 3, 6],
  ['SKU-029', 'Sugar Sachets (500)', 4, 'box', 180, 265, 5, 6, 3, 2],
  ['SKU-030', 'Packing Tape (6 rolls)', 5, 'pack', 150, 240, 38, 10, 0, 3],
  ['SKU-031', 'Corrugated Boxes (Medium, 10)', 5, 'bundle', 280, 420, 12, 8, 0, 2],
  ['SKU-032', 'Bubble Wrap Roll 1m x 10m', 5, 'roll', 210, 330, 0, 4, 0, 1],
];

// [name, phone, email, address, business?, loyalty weight]
const CUSTOMERS = [
  ['Priya Sharma', '+91 99300 12345', 'priya@example.com', '14 Nehru Park, Indore', false, 6],
  ['Arun Desai', '+91 99300 67890', 'arun@example.com', '2B Lake Road, Bhopal', false, 4],
  ['Meera Iyer', '+91 98450 22110', 'meera@example.com', '88 Residency Road', false, 3],
  ['Sunrise Dental Clinic', '+91 97300 55221', 'admin@sunrisedental.example', '5 Clinic Lane', true, 7],
  ['Vikram Nair', '+91 90010 77553', 'vikram@example.com', null, false, 2],
  ['Greenfield Academy', '+91 93110 66442', 'office@greenfield.example', '12 School Road', true, 8],
  ['Rohit Malhotra', '+91 99887 12009', null, null, false, 2],
  ['Anita Bose', '+91 98330 45670', 'anita@example.com', '31 Park Street', false, 3],
  ['Kavya Reddy', '+91 99001 23456', 'kavya.reddy@example.com', '7 Jubilee Hills', false, 3],
  ['Farhan Qureshi', '+91 98765 11002', null, '19 Station Road', false, 2],
  ['Lotus Yoga Studio', '+91 90909 33221', 'hello@lotusyoga.example', '3rd Floor, Orbit Mall', true, 4],
  ['Neha Kulkarni', '+91 97654 88990', 'neha.k@example.com', null, false, 2],
  ['Sameer Joshi', '+91 99220 44117', null, null, false, 1],
  ['Harbor Logistics', '+91 93220 99001', 'accounts@harborlogistics.example', 'Plot 44, MIDC', true, 6],
  ['Ishaan Gupta', '+91 98110 20304', 'ishaan@example.com', null, false, 2],
  ['Deepa Menon', '+91 94470 55662', 'deepa.menon@example.com', '22 Marine Drive', false, 3],
  ['BrightPath Tutors', '+91 91234 67890', 'contact@brightpath.example', '9 College Square', true, 5],
  ['Aditya Rao', '+91 99887 76655', null, null, false, 1],
  ['Zoya Khan', '+91 98201 33445', 'zoya@example.com', '5 Hill View', false, 2],
  ['City Care Pharmacy', '+91 90000 12121', 'orders@citycare.example', 'Shop 2, Main Market', true, 5],
];

const METHODS = [['upi', 42], ['cash', 28], ['card', 22], ['bank', 8]];
const HOURS = [[9, 3], [10, 6], [11, 9], [12, 10], [13, 8], [14, 5], [15, 5], [16, 6], [17, 9], [18, 10], [19, 7], [20, 3]];
const WEEKDAY = [0.45, 1.0, 0.95, 1.05, 1.0, 1.2, 1.35]; // Sun..Sat

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(random, entries) {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = random() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

function poisson(random, lambda) {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= random();
  } while (p > limit);
  return k - 1;
}

/** The shop's local wall-clock time `daysAgo` days back, as a real instant. */
function shopTime(daysAgo, hour, minute) {
  const nowShop = new Date(Date.now() + TZ_OFFSET_MINUTES * 60_000);
  const local = Date.UTC(nowShop.getUTCFullYear(), nowShop.getUTCMonth(), nowShop.getUTCDate() - daysAgo, hour, minute);
  return new Date(local - TZ_OFFSET_MINUTES * 60_000);
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3_600_000);
}

// ---------------------------------------------------------------------------
// 1. Write the story in memory.
// ---------------------------------------------------------------------------
function plan() {
  const random = mulberry32(20260915);
  const nowShopHour = new Date(Date.now() + TZ_OFFSET_MINUTES * 60_000).getUTCHours();
  const productWeights = PRODUCTS.map((p, i) => [i, p[9]]);
  const customerWeights = CUSTOMERS.map((c, i) => [i, c[5]]);

  const events = [];
  const sold = PRODUCTS.map(() => 0);
  const soldByDay = PRODUCTS.map(() => new Array(DAYS + 1).fill(0));

  // Sales, newest-day last.
  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo--) {
    const day = shopTime(daysAgo, 12, 0);
    const weekday = new Date(day.getTime() + TZ_OFFSET_MINUTES * 60_000).getUTCDay();
    const dayOfMonth = new Date(day.getTime() + TZ_OFFSET_MINUTES * 60_000).getUTCDate();
    const growth = 0.75 + (1 - daysAgo / DAYS) * 0.45;
    const monthStart = dayOfMonth <= 5 ? 1.2 : 1;
    const count = poisson(random, 4.2 * WEEKDAY[weekday] * growth * monthStart);

    for (let n = 0; n < count; n++) {
      const hour = pickWeighted(random, HOURS);
      // No sales in the future: today only has what has already happened.
      if (daysAgo === 0 && hour >= nowShopHour) continue;
      const at = shopTime(daysAgo, hour, Math.floor(random() * 60));

      const customerIndex = random() < 0.62 ? pickWeighted(random, customerWeights) : null;
      const business = customerIndex !== null && CUSTOMERS[customerIndex][4];
      const lineCount = pickWeighted(random, [[1, 45], [2, 30], [3, 17], [4, 8]]) + (business ? 1 : 0);

      const lines = [];
      for (let l = 0; l < lineCount; l++) {
        const index = pickWeighted(random, productWeights);
        if (lines.some((line) => line.index === index)) continue;
        const [, , , , , price] = PRODUCTS[index];
        const maxQty = price < 100 ? 5 : price < 500 ? 3 : 1;
        const quantity = (1 + Math.floor(random() * maxQty)) * (business ? 2 : 1);
        lines.push({ index, quantity });
        sold[index] += quantity;
        soldByDay[index][DAYS - daysAgo] += quantity;
      }
      if (!lines.length) continue;

      const roll = random();
      const payment =
        roll < 0.84 ? 'paid' : roll < 0.93 ? 'partial' : roll < 0.99 ? 'unpaid' : 'refund';
      events.push({
        type: 'sale',
        at,
        daysAgo,
        customerIndex,
        lines,
        discountRate: random() < 0.08 ? (random() < 0.6 ? 5 : 10) : 0,
        payment,
        method: pickWeighted(random, METHODS),
        settleAfterDays: 3 + Math.floor(random() * 15),
        partialShare: 0.35 + random() * 0.3,
      });
    }
  }

  // Deliveries: each supplier restocks roughly every three weeks, ordering about
  // what sold since the last order. Received a few days after ordering.
  const received = PRODUCTS.map(() => 0);
  const orders = [];
  SUPPLIERS.forEach((_, supplierIndex) => {
    const products = PRODUCTS.map((p, i) => ({ p, i })).filter(({ p }) => p[8] === supplierIndex);
    let cursor = DAYS - 8 - supplierIndex * 3;
    let windowStart = 0;
    while (cursor > 14) {
      const dayIndex = DAYS - cursor;
      const items = products
        .map(({ i }) => {
          const recent = soldByDay[i].slice(windowStart, dayIndex).reduce((a, b) => a + b, 0);
          return { index: i, quantity: Math.round(recent * 0.9) };
        })
        .filter((item) => item.quantity > 0);
      if (items.length) {
        const cancelled = supplierIndex === 3 && cursor < 70 && cursor > 50;
        const orderedAt = shopTime(cursor, 10, 15 + supplierIndex * 7);
        const leadDays = 3 + Math.floor(random() * 4);
        orders.push({ supplierIndex, orderedAt, receivedAt: cancelled ? null : shopTime(cursor - leadDays, 16, 20), items, cancelled, leadDays });
        if (!cancelled) for (const item of items) received[item.index] += item.quantity;
      }
      windowStart = dayIndex;
      cursor -= 18 + Math.floor(random() * 7);
    }
  });

  // Orders still open today, so every status has a real example.
  const open = [
    { supplierIndex: 1, daysAgo: 2, status: 'ordered', items: [[1, 30], [6, 20], [19, 24]] },
    { supplierIndex: 2, daysAgo: 4, status: 'partial', items: [[7, 24, 24], [2, 40, 0]] },
    { supplierIndex: 4, daysAgo: 0, status: 'draft', items: [[23, 40], [8, 4]] },
  ];
  for (const order of open) {
    for (const [index, , receivedQty = 0] of order.items) received[index] += receivedQty;
  }

  // A few ordinary corrections: breakage, a stock count, shop use.
  const adjustments = [
    { index: 10, daysAgo: 95, change: -1, note: 'Damaged in transit' },
    { index: 27, daysAgo: 61, change: -2, note: 'Used in the shop' },
    { index: 15, daysAgo: 40, change: 3, note: 'Stock count correction' },
    { index: 21, daysAgo: 18, change: -1, note: 'Leaking container, written off' },
  ];
  const adjusted = PRODUCTS.map(() => 0);
  for (const a of adjustments) adjusted[a.index] += a.change;

  // Opening stock is whatever makes today's stock come out right.
  const opening = PRODUCTS.map((p, i) => p[6] + sold[i] - received[i] - adjusted[i]);

  return { events, orders, open, adjustments, opening };
}

// ---------------------------------------------------------------------------
// 2. Replay it through the database, in time order.
// ---------------------------------------------------------------------------
async function seed() {
  // Refuse before touching anything rather than failing partway through, and
  // never silently overwrite records the person may have entered themselves.
  const { rows } = await db.query('SELECT (SELECT count(*) FROM products) + (SELECT count(*) FROM sales) + (SELECT count(*) FROM customers) AS count');
  if (Number(rows[0].count) > 0) {
    const err = new Error('There are already records in the database. Use "Clear all" first if you want to reload the sample data.');
    err.status = 409;
    throw err;
  }

  const story = plan();

  // Stock must never dip below zero part-way through (the database would refuse
  // the sale). Where a delivery arrives after the sales it replaces, lift the
  // opening stock and take the excess back out near the end as a stock count.
  const deficits = simulateDeficits(story);
  deficits.forEach((deficit, i) => {
    if (deficit > 0) {
      story.opening[i] += deficit;
      story.adjustments.push({ index: i, daysAgo: 6, change: -deficit, note: 'Stock count correction' });
    }
  });

  const started = Date.now();
  return db.transaction(
    async (tx) => {
      const setClock = (date) => tx.query("SELECT set_config('docdesk.clock', $1, true)", [date.toISOString()]);
      const origin = shopTime(DAYS + 1, 9, 0);

      await tx.query(
        `INSERT INTO settings (key, value) VALUES
           ('business_name', 'DocDesk Demo Store'), ('business_address', '24 MG Road, Indore 452001'),
           ('business_phone', '+91 731 400 1200'), ('business_email', 'hello@docdesk-demo.example'),
           ('currency_symbol', '₹'), ('default_tax_rate', '5'), ('timezone', $1),
           ('receipt_footer', 'Thank you for shopping with us. Exchanges within 7 days with this receipt.')
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [TIMEZONE]
      );

      await setClock(origin);
      const categoryIds = [];
      for (const name of CATEGORIES) {
        const { rows: r } = await tx.query('INSERT INTO categories (name, created_at) VALUES ($1, $2) RETURNING id', [name, origin]);
        categoryIds.push(r[0].id);
      }

      const supplierIds = [];
      for (const [name, contact, phone, email, notes] of SUPPLIERS) {
        const { rows: r } = await tx.query(
          'INSERT INTO suppliers (name, contact_name, phone, email, notes, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
          [name, contact, phone, email, notes, origin]
        );
        supplierIds.push(r[0].id);
      }

      await tx.query("SELECT set_config('docdesk.stock_note', 'Opening stock', true)");
      const productIds = [];
      for (const [i, p] of PRODUCTS.entries()) {
        const [sku, name, category, unit, cost, price, , reorder, supplier] = p;
        const { rows: r } = await tx.query(
          `INSERT INTO products (sku, name, category_id, unit, cost_price, sale_price, stock_quantity, reorder_level, supplier_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [sku, name, categoryIds[category], unit, cost, price, story.opening[i], reorder, supplierIds[supplier], origin]
        );
        productIds.push(r[0].id);
      }
      await tx.query("SELECT set_config('docdesk.stock_note', '', true)");

      const customerIds = [];
      for (const [i, [name, phone, email, address]] of CUSTOMERS.entries()) {
        const joined = new Date(origin.getTime() + i * 60_000);
        const { rows: r } = await tx.query(
          'INSERT INTO customers (name, phone, email, address, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5) RETURNING id',
          [name, phone, email, address, joined]
        );
        customerIds.push(r[0].id);
      }

      // Everything that happens after opening, in order.
      const timeline = [];
      for (const sale of story.events) timeline.push({ at: sale.at, kind: 'sale', sale });
      for (const order of story.orders) {
        timeline.push({ at: order.orderedAt, kind: 'order', order });
        if (order.receivedAt) timeline.push({ at: order.receivedAt, kind: 'receive', order });
      }
      const justNow = new Date(Date.now() - 10 * 60_000);
      for (const order of story.open) {
        const at = shopTime(order.daysAgo, 10, 30);
        timeline.push({ at: at > justNow ? justNow : at, kind: 'open-order', order });
      }
      for (const a of story.adjustments) timeline.push({ at: shopTime(a.daysAgo, 19, 45), kind: 'adjust', adjustment: a });
      timeline.sort((a, b) => a.at - b.at);

      const later = []; // payments that happen after the sale day
      const counts = { sales: 0, payments: 0, orders: 0, movements: 0 };

      const flushPayments = async (until) => {
        later.sort((a, b) => a.at - b.at);
        while (later.length && later[0].at <= until) {
          const p = later.shift();
          await setClock(p.at);
          await tx.query('INSERT INTO payments (sale_id, amount, method, note, paid_at, created_at) VALUES ($1, $2, $3, $4, $5, $5)', [p.saleId, p.amount, p.method, p.note, p.at]);
          counts.payments++;
        }
      };

      for (const entry of timeline) {
        await flushPayments(entry.at);
        await setClock(entry.at);

        if (entry.kind === 'sale') {
          const { sale } = entry;
          const lines = sale.lines.map(({ index, quantity }) => ({
            productId: productIds[index],
            description: PRODUCTS[index][1],
            quantity,
            price: PRODUCTS[index][5],
            cost: PRODUCTS[index][4],
            cents: lineTotalCents(quantity, PRODUCTS[index][5]),
          }));
          const subtotal = lines.reduce((s, l) => s + l.cents, 0n);
          const discount = sale.discountRate ? (subtotal * BigInt(sale.discountRate)) / 10000n * 100n : 0n; // whole currency units
          const taxable = subtotal - discount;
          const tax = taxCents(taxable, 5);
          const total = taxable + tax;
          const totalNumber = fromCents(total);

          const { rows: saleRows } = await tx.query(
            `INSERT INTO sales (customer_id, subtotal, discount, tax_rate, tax, total, payment_method, created_at, updated_at)
             VALUES ($1, $2, $3, 5, $4, $5, $6, $7, $7) RETURNING id`,
            [sale.customerIndex === null ? null : customerIds[sale.customerIndex], fromCents(subtotal), fromCents(discount), fromCents(tax), totalNumber, sale.method, sale.at]
          );
          const saleId = saleRows[0].id;

          const values = [];
          const params = [];
          for (const line of lines) {
            params.push(saleId, line.productId, line.description, line.quantity, line.price, line.cost);
            const n = params.length;
            values.push(`($${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`);
          }
          await tx.query(`INSERT INTO sale_items (sale_id, product_id, description, quantity, unit_price, unit_cost) VALUES ${values.join(', ')}`, params);
          counts.sales++;

          const pay = async (amount, method, at, note = null) => {
            await tx.query('INSERT INTO payments (sale_id, amount, method, note, paid_at, created_at) VALUES ($1, $2, $3, $4, $5, $5)', [saleId, amount, method, note, at]);
            counts.payments++;
          };
          const settleAt = addHours(sale.at, 24 * sale.settleAfterDays + 3);
          const settled = settleAt < new Date();

          if (sale.payment === 'paid' || sale.payment === 'refund') {
            await pay(totalNumber, sale.method, sale.at);
            if (sale.payment === 'refund' && addHours(sale.at, 30) < new Date()) {
              later.push({ saleId, amount: -totalNumber, method: sale.method, note: 'Refund - returned unopened', at: addHours(sale.at, 30) });
            }
          } else if (sale.payment === 'partial') {
            const first = Math.max(Math.round((totalNumber * sale.partialShare) / 10) * 10, 10);
            if (first < totalNumber) {
              await pay(first, sale.method, sale.at, 'Part payment');
              if (settled) later.push({ saleId, amount: Math.round((totalNumber - first) * 100) / 100, method: 'upi', note: 'Balance settled', at: settleAt });
            } else {
              await pay(totalNumber, sale.method, sale.at);
            }
          } else if (settled && sale.daysAgo > 20) {
            later.push({ saleId, amount: totalNumber, method: 'bank', note: 'Paid on account', at: settleAt });
          }
        } else if (entry.kind === 'order' || entry.kind === 'open-order') {
          const order = entry.order;
          const status = entry.kind === 'open-order' ? (order.status === 'partial' ? 'ordered' : order.status) : order.cancelled ? 'cancelled' : 'ordered';
          const items = entry.kind === 'open-order'
            ? order.items.map(([index, quantity, got = 0]) => ({ index, quantity, got }))
            : order.items.map((item) => ({ ...item, got: 0 }));
          const total = fromCents(items.reduce((s, item) => s + lineTotalCents(item.quantity, PRODUCTS[item.index][4]), 0n));
          const expected = new Date(entry.at.getTime() + 5 * 86_400_000).toISOString().slice(0, 10);
          const { rows: po } = await tx.query(
            `INSERT INTO purchase_orders (supplier_id, status, expected_date, total, notes, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
            [supplierIds[order.supplierIndex], status, expected, total, order.cancelled ? 'Supplier out of stock - cancelled' : null, entry.at]
          );
          order.id = po[0].id;
          order.itemIds = [];
          for (const item of items) {
            const { rows: r } = await tx.query(
              'INSERT INTO purchase_order_items (purchase_order_id, product_id, description, quantity, unit_cost) VALUES ($1, $2, $3, $4, $5) RETURNING id',
              [order.id, productIds[item.index], PRODUCTS[item.index][1], item.quantity, PRODUCTS[item.index][4]]
            );
            order.itemIds.push(r[0].id);
          }
          // Deliveries only after every line exists, so the order's status is
          // worked out against the whole order.
          for (const [i, item] of items.entries()) {
            if (item.got > 0) {
              await tx.query('UPDATE purchase_order_items SET quantity_received = $1 WHERE id = $2', [item.got, order.itemIds[i]]);
            }
          }
          counts.orders++;
        } else if (entry.kind === 'receive') {
          for (const itemId of entry.order.itemIds) {
            await tx.query('UPDATE purchase_order_items SET quantity_received = quantity WHERE id = $1', [itemId]);
          }
        } else if (entry.kind === 'adjust') {
          const a = entry.adjustment;
          await tx.query("SELECT apply_stock_change($1, $2, 'adjustment', 'manual', NULL, $3)", [productIds[a.index], a.change, a.note]);
        }
      }
      await flushPayments(new Date());

      // Customers were told about their recent purchases.
      await tx.query(
        `INSERT INTO message_log (channel, recipient, subject, body, trigger_type, status, related_type, related_id, created_at, sent_at)
         SELECT CASE WHEN c.email IS NOT NULL THEN 'email' ELSE 'sms' END,
                COALESCE(c.email, c.phone),
                'Receipt ' || s.reference,
                'Thanks ' || c.name || '. Your total was ' || to_char(s.total, 'FM999999990.00') || '.',
                'sale_confirmation',
                CASE WHEN s.created_at > now() - interval '1 day' THEN 'queued' ELSE 'sent' END,
                'sale', s.id, s.created_at,
                CASE WHEN s.created_at > now() - interval '1 day' THEN NULL ELSE s.created_at + interval '2 minutes' END
           FROM sales s JOIN customers c ON c.id = s.customer_id
          WHERE s.created_at > now() - interval '7 days'`
      );

      await tx.query("SELECT set_config('docdesk.clock', '', true)");
      const { rows: moves } = await tx.query('SELECT count(*) AS n FROM stock_movements');
      counts.movements = Number(moves[0].n);

      return {
        categories: categoryIds.length,
        suppliers: supplierIds.length,
        products: productIds.length,
        customers: customerIds.length,
        sales: counts.sales,
        payments: counts.payments,
        purchaseOrders: counts.orders,
        stockMovements: counts.movements,
        seconds: Math.round((Date.now() - started) / 100) / 10,
      };
    },
    { actor: 'sample-data', settings: { 'docdesk.skip_audit': 'on' } }
  );
}

/** Walks the story's stock balances in time order and reports the worst shortfall per product. */
function simulateDeficits(story) {
  const balance = [...story.opening];
  const worst = PRODUCTS.map(() => 0);
  const moves = [];
  for (const sale of story.events) for (const line of sale.lines) moves.push({ at: sale.at, index: line.index, change: -line.quantity });
  for (const order of story.orders) {
    if (order.receivedAt) for (const item of order.items) moves.push({ at: order.receivedAt, index: item.index, change: item.quantity });
  }
  for (const order of story.open) {
    for (const [index, , got = 0] of order.items) if (got) moves.push({ at: shopTime(order.daysAgo, 10, 30), index, change: got });
  }
  for (const a of story.adjustments) moves.push({ at: shopTime(a.daysAgo, 19, 45), index: a.index, change: a.change });
  moves.sort((a, b) => a.at - b.at || b.change - a.change);
  for (const move of moves) {
    balance[move.index] += move.change;
    worst[move.index] = Math.min(worst[move.index], balance[move.index]);
  }
  return worst.map((w) => (w < 0 ? -w : 0));
}

const BUSINESS_TABLES = [
  'payments', 'sale_items', 'sales', 'purchase_order_items', 'purchase_orders', 'stock_movements',
  'message_log', 'products', 'categories', 'customers', 'suppliers', 'settings',
];

/** Removes every business record (files and the audit trail are kept) and restarts numbering. */
async function clear() {
  return db.transaction(
    async (tx) => {
      await tx.query(`TRUNCATE ${BUSINESS_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
      await tx.query('ALTER SEQUENCE sale_number_seq RESTART WITH 1001');
      await tx.query('ALTER SEQUENCE purchase_order_number_seq RESTART WITH 1001');
      return { cleared: BUSINESS_TABLES.length };
    },
    { actor: 'sample-data' }
  );
}

module.exports = { seed, clear, plan };

if (require.main === module) {
  (async () => {
    const port = Number(process.env.PORT) || 5000;
    if (db.mode === 'embedded') {
      const running = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
      if (running) {
        console.log('DocDesk is running - use "Use sample data" / "Clear all" in the app, or stop it first.');
        process.exit(1);
      }
    }
    const { migrate } = require('./migrate');
    try {
      await migrate();
      const action = process.argv[2] === 'clear' ? clear : seed;
      const result = await action();
      console.log(process.argv[2] === 'clear' ? 'cleared' : 'seeded', result);
      await db.close();
      process.exit(0);
    } catch (err) {
      console.error('failed:', err.message);
      await db.close().catch(() => {});
      process.exit(1);
    }
  })();
}
