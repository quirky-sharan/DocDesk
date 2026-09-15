-- 003 Indexes: shaped by the queries the app actually runs.
--
-- PostgreSQL does not index foreign keys on its own, so every FK used in a join
-- or a cascade gets one. Lists sort newest-first, so dates are indexed DESC.
-- Partial indexes cover the questions asked constantly about a small slice:
-- "what is low?", "what is unpaid?", "what is waiting to send?".

-- Foreign keys
CREATE INDEX IF NOT EXISTS products_category_id_idx ON products (category_id);
CREATE INDEX IF NOT EXISTS products_supplier_id_idx ON products (supplier_id);
CREATE INDEX IF NOT EXISTS sales_customer_created_idx ON sales (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sale_items_sale_id_idx ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS sale_items_product_id_idx ON sale_items (product_id);
CREATE INDEX IF NOT EXISTS payments_sale_id_idx ON payments (sale_id, paid_at);
CREATE INDEX IF NOT EXISTS purchase_orders_supplier_id_idx ON purchase_orders (supplier_id);
CREATE INDEX IF NOT EXISTS purchase_order_items_order_idx ON purchase_order_items (purchase_order_id);
CREATE INDEX IF NOT EXISTS purchase_order_items_product_idx ON purchase_order_items (product_id);
CREATE INDEX IF NOT EXISTS stock_movements_product_created_idx ON stock_movements (product_id, created_at DESC);

-- Sorting and date windows
CREATE INDEX IF NOT EXISTS sales_created_at_idx ON sales (created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_orders_status_created_idx ON purchase_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS message_log_status_created_idx ON message_log (status, created_at DESC);
CREATE INDEX IF NOT EXISTS files_created_at_idx ON files (created_at DESC);
CREATE INDEX IF NOT EXISTS files_related_idx ON files (related_type, related_id);
CREATE INDEX IF NOT EXISTS stock_movements_created_idx ON stock_movements (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_record_idx ON audit_log (table_name, record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS products_name_idx ON products (lower(name));
CREATE INDEX IF NOT EXISTS customers_name_idx ON customers (lower(name));
CREATE INDEX IF NOT EXISTS suppliers_name_idx ON suppliers (lower(name));
CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers (phone);

-- Partial indexes for the constant questions
CREATE INDEX IF NOT EXISTS products_needs_restock_idx ON products (stock_quantity)
  WHERE reorder_level > 0 AND stock_quantity <= reorder_level;
CREATE INDEX IF NOT EXISTS sales_outstanding_idx ON sales (created_at DESC)
  WHERE payment_status IN ('unpaid', 'partial');
CREATE INDEX IF NOT EXISTS message_log_queued_idx ON message_log (created_at)
  WHERE status = 'queued';

-- At most one waiting low-stock alert per product, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS message_log_one_queued_low_stock ON message_log (related_type, related_id)
  WHERE trigger_type = 'low_stock' AND status = 'queued';

-- Fuzzy search: trigram GIN indexes make "contains" and misspelt searches fast.
-- Only created when pg_trgm is installed (see 001).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS products_name_trgm_idx ON products USING gin (name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS products_sku_trgm_idx ON products USING gin (sku gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS customers_name_trgm_idx ON customers USING gin (name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS customers_email_trgm_idx ON customers USING gin (email gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS suppliers_name_trgm_idx ON suppliers USING gin (name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS sale_items_description_trgm_idx ON sale_items USING gin (description gin_trgm_ops);
  END IF;
END
$$;
