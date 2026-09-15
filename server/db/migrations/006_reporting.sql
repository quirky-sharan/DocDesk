-- 006 Reporting: views and set-returning functions.
--
-- Reports read from these rather than repeating joins and formulas in the API,
-- so "profit", "stock status" and "balance due" each have one definition. Every
-- date is bucketed in the shop's own timezone (passed in), not the server's -
-- a sale at 11pm in Mumbai belongs to that day, not tomorrow's.

CREATE OR REPLACE VIEW v_product_stock AS
SELECT
  p.id,
  p.sku,
  p.name,
  c.name AS category,
  p.supplier_id,
  s.name AS supplier_name,
  p.unit,
  p.cost_price,
  p.sale_price,
  p.stock_quantity,
  p.reorder_level,
  CASE
    WHEN p.stock_quantity <= 0 THEN 'out'
    WHEN p.reorder_level > 0 AND p.stock_quantity <= p.reorder_level THEN 'low'
    ELSE 'ok'
  END AS stock_status,
  round(p.stock_quantity * p.cost_price, 2) AS stock_value_cost,
  round(p.stock_quantity * p.sale_price, 2) AS stock_value_retail,
  CASE WHEN p.sale_price > 0 THEN round((p.sale_price - p.cost_price) / p.sale_price * 100, 1) END AS margin_percent,
  p.is_active,
  p.updated_at
FROM products p
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN suppliers s ON s.id = p.supplier_id;
COMMENT ON VIEW v_product_stock IS 'Each product with its category, supplier, stock status, stock value and margin.';

CREATE OR REPLACE VIEW v_sales AS
SELECT
  s.id,
  s.reference,
  s.created_at,
  s.customer_id,
  c.name AS customer_name,
  s.subtotal,
  s.discount,
  s.tax,
  s.total,
  s.amount_paid,
  s.total - s.amount_paid AS balance_due,
  s.payment_status,
  s.payment_method,
  li.item_count,
  li.cost_of_goods,
  s.subtotal - s.discount - li.cost_of_goods AS gross_profit
FROM sales s
LEFT JOIN customers c ON c.id = s.customer_id
LEFT JOIN LATERAL (
  SELECT count(*) AS item_count, COALESCE(sum(si.quantity * si.unit_cost), 0) AS cost_of_goods
  FROM sale_items si WHERE si.sale_id = s.id
) li ON true;
COMMENT ON VIEW v_sales IS 'Each sale with customer, balance due, cost of goods and gross profit (excluding tax).';

CREATE OR REPLACE VIEW v_customer_stats AS
SELECT
  c.id,
  c.name,
  c.phone,
  c.email,
  count(s.id) AS visits,
  COALESCE(sum(s.total), 0) AS lifetime_value,
  COALESCE(round(avg(s.total), 2), 0) AS average_sale,
  max(s.created_at) AS last_purchase_at,
  COALESCE(sum(s.total - s.amount_paid) FILTER (WHERE s.payment_status IN ('unpaid', 'partial')), 0) AS outstanding
FROM customers c
LEFT JOIN sales s ON s.customer_id = c.id
GROUP BY c.id;
COMMENT ON VIEW v_customer_stats IS 'Lifetime value, visits, average spend and money owed, per customer.';

CREATE OR REPLACE VIEW v_supplier_stats AS
SELECT
  sp.id,
  sp.name,
  count(DISTINCT p.id) AS products_supplied,
  count(DISTINCT po.id) AS orders,
  COALESCE(sum(po.total) FILTER (WHERE po.status <> 'cancelled'), 0) AS ordered_value,
  count(DISTINCT po.id) FILTER (WHERE po.status IN ('ordered', 'partial')) AS open_orders,
  max(po.created_at) AS last_order_at
FROM suppliers sp
LEFT JOIN products p ON p.supplier_id = sp.id
LEFT JOIN purchase_orders po ON po.supplier_id = sp.id
GROUP BY sp.id;
COMMENT ON VIEW v_supplier_stats IS 'Orders, spend and open orders per supplier.';

-- Revenue, sale count and profit for every day in a range - including days with
-- no sales, generated in SQL so charts never skip a quiet day.
CREATE OR REPLACE FUNCTION report_sales_by_day(p_from date, p_to date, p_tz text)
RETURNS TABLE (day date, sale_count bigint, revenue numeric, profit numeric)
LANGUAGE sql STABLE AS $$
  WITH totals AS (
    SELECT (v.created_at AT TIME ZONE p_tz)::date AS day,
           count(*) AS sale_count,
           sum(v.total) AS revenue,
           sum(v.gross_profit) AS profit
      FROM v_sales v
     WHERE v.created_at >= (p_from::timestamp AT TIME ZONE p_tz)
       AND v.created_at < ((p_to + 1)::timestamp AT TIME ZONE p_tz)
     GROUP BY 1
  )
  SELECT d::date, COALESCE(t.sale_count, 0), COALESCE(t.revenue, 0), COALESCE(t.profit, 0)
    FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') AS d
    LEFT JOIN totals t ON t.day = d::date
   ORDER BY 1
$$;
COMMENT ON FUNCTION report_sales_by_day(date, date, text) IS 'Daily revenue, sale count and gross profit in the given timezone, gaps filled.';

-- When the shop is busy: sales by weekday and hour, in the shop's timezone.
CREATE OR REPLACE FUNCTION report_sales_heatmap(p_from date, p_to date, p_tz text)
RETURNS TABLE (dow integer, hour integer, sale_count bigint, revenue numeric)
LANGUAGE sql STABLE AS $$
  SELECT extract(dow FROM s.created_at AT TIME ZONE p_tz)::integer,
         extract(hour FROM s.created_at AT TIME ZONE p_tz)::integer,
         count(*),
         sum(s.total)
    FROM sales s
   WHERE s.created_at >= (p_from::timestamp AT TIME ZONE p_tz)
     AND s.created_at < ((p_to + 1)::timestamp AT TIME ZONE p_tz)
   GROUP BY 1, 2
$$;
COMMENT ON FUNCTION report_sales_heatmap(date, date, text) IS 'Sale count and revenue by day of week (0 = Sunday) and hour of day.';
