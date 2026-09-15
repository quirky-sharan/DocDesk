const db = require('../db');
const { money } = require('../lib/validate');
const { resolveTimezone, todayIn } = require('../lib/timezone');

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The reporting window, as calendar dates in the shop's timezone. `days` counts
 * back from today inclusive; explicit from/to win when given.
 */
async function windowFrom(req) {
  const tz = await resolveTimezone(req);
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 3650);
  const to = DATE.test(req.query.to || '') ? req.query.to : todayIn(tz);
  const from = DATE.test(req.query.from || '') ? req.query.from : todayIn(tz, -(days - 1));
  return { from, to, days, tz };
}

// Rows between two calendar dates (inclusive) in a timezone.
const IN_WINDOW = (column) =>
  `${column} >= ($1::date::timestamp AT TIME ZONE $3) AND ${column} < (($2::date + 1)::timestamp AT TIME ZONE $3)`;

exports.summary = async (req, res, next) => {
  try {
    const { from, to, tz } = await windowFrom(req);
    const bounds = [from, to, tz];

    const [{ rows: totals }, { rows: unpaid }, { rows: previous }] = await Promise.all([
      db.query(
        `SELECT count(*) AS sale_count,
                COALESCE(sum(total), 0) AS revenue,
                COALESCE(sum(tax), 0) AS tax,
                COALESCE(sum(discount), 0) AS discount,
                COALESCE(sum(cost_of_goods), 0) AS cost,
                COALESCE(sum(gross_profit), 0) AS profit,
                COALESCE(sum(amount_paid), 0) AS collected
           FROM v_sales WHERE ${IN_WINDOW('created_at')}`,
        bounds
      ),
      db.query(
        `SELECT count(*) AS count, COALESCE(sum(total - amount_paid), 0) AS amount
           FROM sales WHERE payment_status IN ('unpaid', 'partial')`
      ),
      // The same length of time immediately before, for "vs previous period".
      db.query(
        `SELECT COALESCE(sum(total), 0) AS revenue, count(*) AS sale_count
           FROM sales
          WHERE created_at >= (($1::date - ($2::date - $1::date + 1))::timestamp AT TIME ZONE $3)
            AND created_at < ($1::date::timestamp AT TIME ZONE $3)`,
        bounds
      ),
    ]);

    const t = totals[0];
    const revenue = Number(t.revenue);
    const prevRevenue = Number(previous[0].revenue);
    res.json({
      from,
      to,
      timezone: tz,
      saleCount: Number(t.sale_count),
      revenue: money(revenue),
      tax: money(t.tax),
      discount: money(t.discount),
      estimatedCost: money(t.cost),
      estimatedProfit: money(t.profit),
      collected: money(t.collected),
      marginPercent: revenue > 0 ? Math.round((Number(t.profit) / (revenue - Number(t.tax))) * 1000) / 10 : 0,
      averageSale: Number(t.sale_count) ? money(revenue / Number(t.sale_count)) : 0,
      previous: { revenue: money(prevRevenue), saleCount: Number(previous[0].sale_count) },
      revenueChangePercent: prevRevenue === 0 ? (revenue > 0 ? 100 : 0) : Math.round(((revenue - prevRevenue) / prevRevenue) * 100),
      outstanding: { count: Number(unpaid[0].count), amount: money(unpaid[0].amount) },
    });
  } catch (err) {
    next(err);
  }
};

exports.salesByDay = async (req, res, next) => {
  try {
    const { from, to, tz } = await windowFrom(req);
    const { rows } = await db.query('SELECT * FROM report_sales_by_day($1, $2, $3)', [from, to, tz]);
    res.json({
      from,
      to,
      timezone: tz,
      series: rows.map((r) => ({
        day: r.day,
        saleCount: Number(r.sale_count),
        revenue: money(r.revenue),
        profit: money(r.profit),
      })),
    });
  } catch (err) {
    next(err);
  }
};

// When the shop is busy: every weekday x hour cell, in the shop's timezone.
exports.heatmap = async (req, res, next) => {
  try {
    const { from, to, tz } = await windowFrom({ ...req, query: { days: 90, ...req.query } });
    const { rows } = await db.query('SELECT * FROM report_sales_heatmap($1, $2, $3)', [from, to, tz]);
    res.json({
      from,
      to,
      timezone: tz,
      cells: rows.map((r) => ({ dow: r.dow, hour: r.hour, count: Number(r.sale_count), revenue: money(r.revenue) })),
    });
  } catch (err) {
    next(err);
  }
};

// Average takings per weekday across the window.
exports.byWeekday = async (req, res, next) => {
  try {
    const { from, to, tz } = await windowFrom(req);
    const { rows } = await db.query(
      `SELECT extract(isodow FROM day)::int AS isodow,
              round(avg(revenue), 2) AS avg_revenue,
              round(avg(sale_count), 1) AS avg_sales,
              sum(revenue) AS revenue
         FROM report_sales_by_day($1, $2, $3)
        GROUP BY 1 ORDER BY 1`,
      [from, to, tz]
    );
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    res.json(rows.map((r) => ({ day: names[r.isodow - 1], isodow: r.isodow, averageRevenue: money(r.avg_revenue), averageSales: Number(r.avg_sales), revenue: money(r.revenue) })));
  } catch (err) {
    next(err);
  }
};

exports.topProducts = async (req, res, next) => {
  try {
    const { from, to, tz } = await windowFrom(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const { rows } = await db.query(
      `SELECT si.description AS name,
              si.product_id,
              sum(si.quantity) AS quantity,
              sum(si.line_total) AS revenue,
              sum(si.line_total - si.quantity * si.unit_cost) AS profit
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
        WHERE ${IN_WINDOW('s.created_at')}
        GROUP BY si.description, si.product_id
        ORDER BY revenue DESC
        LIMIT $4`,
      [from, to, tz, limit]
    );
    res.json(rows.map((r) => ({
      name: r.name,
      productId: r.product_id,
      quantity: Number(r.quantity),
      revenue: money(r.revenue),
      profit: money(r.profit),
    })));
  } catch (err) {
    next(err);
  }
};

exports.topCustomers = async (req, res, next) => {
  try {
    const { from, to, tz } = await windowFrom(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const { rows } = await db.query(
      `SELECT c.id, c.name, count(s.id) AS sale_count, COALESCE(sum(s.total), 0) AS revenue
         FROM sales s JOIN customers c ON c.id = s.customer_id
        WHERE ${IN_WINDOW('s.created_at')}
        GROUP BY c.id, c.name ORDER BY revenue DESC LIMIT $4`,
      [from, to, tz, limit]
    );
    res.json(rows.map((r) => ({ id: r.id, name: r.name, saleCount: Number(r.sale_count), revenue: money(r.revenue) })));
  } catch (err) {
    next(err);
  }
};

// Everything one customer has ever bought - the question a front desk actually
// gets asked ("what did I buy last time?").
exports.customerHistory = async (req, res, next) => {
  try {
    const { rows: stats } = await db.query('SELECT * FROM v_customer_stats WHERE id = $1', [req.params.id]);
    if (!stats.length) {
      const err = new Error('Customer not found');
      err.status = 404;
      throw err;
    }
    const tz = await resolveTimezone(req);

    const [{ rows: customer }, { rows: sales }, { rows: favourites }, { rows: monthly }] = await Promise.all([
      db.query('SELECT * FROM customers WHERE id = $1', [req.params.id]),
      db.query(
        `SELECT id, reference, total, amount_paid, total - amount_paid AS balance_due, payment_status, created_at
           FROM sales WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [req.params.id]
      ),
      db.query(
        `SELECT si.description AS name, sum(si.quantity) AS quantity, sum(si.line_total) AS spent
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE s.customer_id = $1
          GROUP BY si.description ORDER BY quantity DESC LIMIT 5`,
        [req.params.id]
      ),
      db.query(
        `SELECT to_char(date_trunc('month', created_at AT TIME ZONE $2), 'YYYY-MM') AS month, sum(total) AS spent
           FROM sales WHERE customer_id = $1
          GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
        [req.params.id, tz]
      ),
    ]);

    const s = stats[0];
    res.json({
      customer: customer[0],
      saleCount: Number(s.visits),
      totalSpent: money(s.lifetime_value),
      averageSale: money(s.average_sale),
      outstanding: money(s.outstanding),
      lastPurchaseAt: s.last_purchase_at,
      sales,
      favourites: favourites.map((f) => ({ name: f.name, quantity: Number(f.quantity), spent: money(f.spent) })),
      monthly: monthly.reverse().map((m) => ({ month: m.month, spent: money(m.spent) })),
    });
  } catch (err) {
    next(err);
  }
};

// Revenue split by product category. Lines whose product was deleted fall into
// "Uncategorised" rather than vanishing from the total.
exports.byCategory = async (req, res, next) => {
  try {
    const { from, to, tz } = await windowFrom(req);
    const { rows } = await db.query(
      `SELECT COALESCE(c.name, 'Uncategorised') AS category,
              sum(si.line_total) AS revenue,
              sum(si.quantity) AS quantity,
              sum(si.line_total - si.quantity * si.unit_cost) AS profit
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         LEFT JOIN products p ON p.id = si.product_id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${IN_WINDOW('s.created_at')}
        GROUP BY 1
        ORDER BY revenue DESC`,
      [from, to, tz]
    );
    res.json(rows.map((r) => ({
      category: r.category,
      revenue: money(r.revenue),
      quantity: Number(r.quantity),
      profit: money(r.profit),
    })));
  } catch (err) {
    next(err);
  }
};

// How money came in, from the payments themselves (net of refunds).
exports.byPaymentMethod = async (req, res, next) => {
  try {
    const { from, to, tz } = await windowFrom(req);
    const { rows } = await db.query(
      `SELECT p.method, count(DISTINCT p.sale_id) AS sale_count, sum(p.amount) AS revenue
         FROM payments p
        WHERE ${IN_WINDOW('p.paid_at')}
        GROUP BY p.method
       HAVING sum(p.amount) > 0
        ORDER BY revenue DESC`,
      [from, to, tz]
    );
    res.json(rows.map((r) => ({ method: r.method, saleCount: Number(r.sale_count), revenue: money(r.revenue) })));
  } catch (err) {
    next(err);
  }
};

// What the stock on the shelves is worth, split by category.
exports.stockByCategory = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT COALESCE(category, 'Uncategorised') AS category,
              count(*) AS products,
              sum(stock_quantity) AS units,
              sum(stock_value_cost) AS value,
              sum(stock_value_retail) AS retail_value,
              count(*) FILTER (WHERE stock_status = 'low') AS low,
              count(*) FILTER (WHERE stock_status = 'out') AS out
         FROM v_product_stock
        GROUP BY 1
        ORDER BY value DESC`
    );
    res.json(rows.map((r) => ({
      category: r.category,
      products: Number(r.products),
      units: Number(r.units || 0),
      value: money(r.value),
      retailValue: money(r.retail_value),
      low: Number(r.low),
      out: Number(r.out),
    })));
  } catch (err) {
    next(err);
  }
};

/**
 * Today and this week against the equivalent earlier period, so the dashboard
 * can say whether things are up or down rather than just showing a number.
 * "Today" is the shop's today, in its own timezone.
 */
exports.pulse = async (req, res, next) => {
  try {
    const tz = await resolveTimezone(req);
    const today = todayIn(tz);
    const { rows } = await db.query(
      `WITH bounds AS (
         SELECT ($1::date::timestamp AT TIME ZONE $2) AS today_start,
                (($1::date - 1)::timestamp AT TIME ZONE $2) AS yesterday_start,
                (($1::date - 6)::timestamp AT TIME ZONE $2) AS week_start,
                (($1::date - 13)::timestamp AT TIME ZONE $2) AS last_week_start,
                (($1::date + 1)::timestamp AT TIME ZONE $2) AS tomorrow_start
       )
       SELECT
         count(*) FILTER (WHERE s.created_at >= b.today_start AND s.created_at < b.tomorrow_start) AS today_count,
         COALESCE(sum(s.total) FILTER (WHERE s.created_at >= b.today_start AND s.created_at < b.tomorrow_start), 0) AS today_revenue,
         count(*) FILTER (WHERE s.created_at >= b.yesterday_start AND s.created_at < b.today_start) AS yesterday_count,
         COALESCE(sum(s.total) FILTER (WHERE s.created_at >= b.yesterday_start AND s.created_at < b.today_start), 0) AS yesterday_revenue,
         count(*) FILTER (WHERE s.created_at >= b.week_start AND s.created_at < b.tomorrow_start) AS week_count,
         COALESCE(sum(s.total) FILTER (WHERE s.created_at >= b.week_start AND s.created_at < b.tomorrow_start), 0) AS week_revenue,
         count(*) FILTER (WHERE s.created_at >= b.last_week_start AND s.created_at < b.week_start) AS last_week_count,
         COALESCE(sum(s.total) FILTER (WHERE s.created_at >= b.last_week_start AND s.created_at < b.week_start), 0) AS last_week_revenue,
         COALESCE(sum(s.total) FILTER (WHERE s.created_at >= (b.today_start - interval '28 days') AND s.created_at < b.today_start), 0) / 28.0 AS avg_day_revenue,
         count(*) FILTER (WHERE s.created_at >= (b.today_start - interval '28 days') AND s.created_at < b.today_start) / 28.0 AS avg_day_count
       FROM bounds b
       LEFT JOIN sales s ON s.created_at >= b.last_week_start - interval '28 days'
       GROUP BY b.today_start, b.yesterday_start, b.week_start, b.last_week_start, b.tomorrow_start`,
      [today, tz]
    );
    const r = rows[0];
    const shape = (count, revenue) => ({ saleCount: Number(count), revenue: money(revenue) });
    const todayTotals = shape(r.today_count, r.today_revenue);
    const yesterday = shape(r.yesterday_count, r.yesterday_revenue);
    const thisWeek = shape(r.week_count, r.week_revenue);
    const lastWeek = shape(r.last_week_count, r.last_week_revenue);
    const change = (current, previous) =>
      previous === 0 ? (current > 0 ? 100 : 0) : Math.round(((current - previous) / previous) * 100);

    res.json({
      timezone: tz,
      date: today,
      today: todayTotals,
      yesterday,
      thisWeek,
      lastWeek,
      averageDay: { revenue: money(r.avg_day_revenue), saleCount: Math.round(Number(r.avg_day_count) * 10) / 10 },
      dayChangePercent: change(todayTotals.revenue, yesterday.revenue),
      weekChangePercent: change(thisWeek.revenue, lastWeek.revenue),
    });
  } catch (err) {
    next(err);
  }
};
