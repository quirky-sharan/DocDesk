const db = require('../db');
const { money } = require('../lib/validate');

// Both drivers understand these, and the created_at format is the same
// 'YYYY-MM-DD HH:MM:SS' in each, so a plain string prefix is enough to group
// by day without dialect-specific date functions.
function dayExpression(column) {
  return db.name === 'postgres' ? `TO_CHAR(${column}, 'YYYY-MM-DD')` : `SUBSTR(${column}, 1, 10)`;
}

function windowFrom(query) {
  const days = Math.min(Math.max(Number(query.days) || 30, 1), 365);
  const to = query.to || new Date().toISOString().slice(0, 10);
  const from =
    query.from ||
    new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  return { from, to, days };
}

exports.summary = async (req, res, next) => {
  try {
    const { from, to } = windowFrom(req.query);
    const bounds = [from, `${to} 23:59:59`];

    const { rows: totals } = await db.query(
      `SELECT COUNT(*) AS sale_count,
              COALESCE(SUM(total), 0) AS revenue,
              COALESCE(SUM(tax), 0) AS tax,
              COALESCE(SUM(discount), 0) AS discount
       FROM sales WHERE created_at >= $1 AND created_at <= $2`,
      bounds
    );

    // Cost is taken from the product's current cost price. It is an estimate:
    // if a product's cost changed after a sale, history shifts with it. Storing
    // cost per line at sale time would fix that, and is worth doing if margin
    // reporting ever becomes load-bearing.
    const { rows: margin } = await db.query(
      `SELECT COALESCE(SUM(si.line_total), 0) AS revenue,
              COALESCE(SUM(si.quantity * COALESCE(p.cost_price, 0)), 0) AS cost
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       LEFT JOIN products p ON p.id = si.product_id
       WHERE s.created_at >= $1 AND s.created_at <= $2`,
      bounds
    );

    const { rows: unpaid } = await db.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount
       FROM sales WHERE payment_status IN ('unpaid', 'partial')`
    );

    const t = totals[0];
    const revenue = Number(margin[0].revenue);
    const cost = Number(margin[0].cost);

    res.json({
      from,
      to,
      saleCount: Number(t.sale_count),
      revenue: money(t.revenue),
      tax: money(t.tax),
      discount: money(t.discount),
      estimatedCost: money(cost),
      estimatedProfit: money(revenue - cost),
      averageSale: Number(t.sale_count) ? money(Number(t.revenue) / Number(t.sale_count)) : 0,
      outstanding: { count: Number(unpaid[0].count), amount: money(unpaid[0].amount) },
    });
  } catch (err) {
    next(err);
  }
};

exports.salesByDay = async (req, res, next) => {
  try {
    const { from, to } = windowFrom(req.query);
    const day = dayExpression('created_at');
    const { rows } = await db.query(
      `SELECT ${day} AS day, COUNT(*) AS sale_count, COALESCE(SUM(total), 0) AS revenue
       FROM sales WHERE created_at >= $1 AND created_at <= $2
       GROUP BY ${day} ORDER BY day`,
      [from, `${to} 23:59:59`]
    );

    // Fill gaps so a chart of the period doesn't silently skip quiet days.
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const series = [];
    for (let d = new Date(from); d <= new Date(to); d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const found = byDay.get(key);
      series.push({
        day: key,
        saleCount: found ? Number(found.sale_count) : 0,
        revenue: found ? money(found.revenue) : 0,
      });
    }
    res.json({ from, to, series });
  } catch (err) {
    next(err);
  }
};

exports.topProducts = async (req, res, next) => {
  try {
    const { from, to } = windowFrom(req.query);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const { rows } = await db.query(
      `SELECT si.description AS name,
              si.product_id,
              SUM(si.quantity) AS quantity,
              SUM(si.line_total) AS revenue
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.created_at >= $1 AND s.created_at <= $2
       GROUP BY si.description, si.product_id
       ORDER BY revenue DESC
       LIMIT $3`,
      [from, `${to} 23:59:59`, limit]
    );
    res.json(
      rows.map((r) => ({
        name: r.name,
        productId: r.product_id,
        quantity: Number(r.quantity),
        revenue: money(r.revenue),
      }))
    );
  } catch (err) {
    next(err);
  }
};

exports.topCustomers = async (req, res, next) => {
  try {
    const { from, to } = windowFrom(req.query);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const { rows } = await db.query(
      `SELECT c.id, c.name, COUNT(s.id) AS sale_count, COALESCE(SUM(s.total), 0) AS revenue
       FROM sales s JOIN customers c ON c.id = s.customer_id
       WHERE s.created_at >= $1 AND s.created_at <= $2
       GROUP BY c.id, c.name ORDER BY revenue DESC LIMIT $3`,
      [from, `${to} 23:59:59`, limit]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        saleCount: Number(r.sale_count),
        revenue: money(r.revenue),
      }))
    );
  } catch (err) {
    next(err);
  }
};

// Everything one customer has ever bought - the question a front desk actually
// gets asked ("what did I buy last time?").
exports.customerHistory = async (req, res, next) => {
  try {
    const { rows: customer } = await db.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (!customer.length) {
      const err = new Error('Customer not found');
      err.status = 404;
      throw err;
    }

    const { rows: sales } = await db.query(
      `SELECT id, reference, total, payment_status, created_at
       FROM sales WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.params.id]
    );
    const { rows: totals } = await db.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS spent
       FROM sales WHERE customer_id = $1`,
      [req.params.id]
    );
    const { rows: favourites } = await db.query(
      `SELECT si.description AS name, SUM(si.quantity) AS quantity
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.customer_id = $1
       GROUP BY si.description ORDER BY quantity DESC LIMIT 5`,
      [req.params.id]
    );

    res.json({
      customer: customer[0],
      saleCount: Number(totals[0].count),
      totalSpent: money(totals[0].spent),
      sales,
      favourites: favourites.map((f) => ({ name: f.name, quantity: Number(f.quantity) })),
    });
  } catch (err) {
    next(err);
  }
};
