-- DocDesk core schema (PostgreSQL)
-- Universal small-business front desk: products, customers, sales, restocking.
-- Keep this structurally identical to schema.sqlite.sql.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'staff',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suppliers (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(150) NOT NULL,
  contact_name VARCHAR(150),
  phone        VARCHAR(40),
  email        VARCHAR(150),
  address      TEXT,
  notes        TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(150) NOT NULL,
  phone      VARCHAR(40),
  email      VARCHAR(150),
  address    TEXT,
  notes      TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id             SERIAL PRIMARY KEY,
  sku            VARCHAR(80) UNIQUE,
  name           VARCHAR(200) NOT NULL,
  description    TEXT,
  category       VARCHAR(100),
  unit           VARCHAR(40) NOT NULL DEFAULT 'unit',
  cost_price     NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price     NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  reorder_level  INTEGER NOT NULL DEFAULT 0,
  supplier_id    INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales (
  id             SERIAL PRIMARY KEY,
  reference      VARCHAR(40) UNIQUE,
  customer_id    INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  subtotal       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax            NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total          NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid'
                 CHECK (payment_status IN ('unpaid','partial','paid','refunded')),
  payment_method VARCHAR(40),
  notes          TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- description is denormalised on purpose so a receipt still reads correctly
-- after the underlying product is renamed or deleted.
CREATE TABLE IF NOT EXISTS sale_items (
  id          SERIAL PRIMARY KEY,
  sale_id     INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description VARCHAR(250) NOT NULL,
  quantity    NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_total  NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id            SERIAL PRIMARY KEY,
  reference     VARCHAR(40) UNIQUE,
  supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','ordered','partial','received','cancelled')),
  expected_date DATE,
  received_date DATE,
  total         NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                SERIAL PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id        INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description       VARCHAR(250) NOT NULL,
  quantity          NUMERIC(12,3) NOT NULL DEFAULT 1,
  quantity_received NUMERIC(12,3) NOT NULL DEFAULT 0,
  unit_cost         NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- Automated messaging is stubbed until Phase 6; rows land here as 'queued'
-- and the mock sender marks them 'sent' so the trigger logic is observable.
CREATE TABLE IF NOT EXISTS message_log (
  id           SERIAL PRIMARY KEY,
  channel      VARCHAR(20) NOT NULL DEFAULT 'email',
  recipient    VARCHAR(200),
  subject      VARCHAR(250),
  body         TEXT,
  trigger_type VARCHAR(50),
  status       VARCHAR(20) NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','sent','failed')),
  related_type VARCHAR(40),
  related_id   INTEGER,
  error        TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at      TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_name       ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_category   ON products(category);
CREATE INDEX IF NOT EXISTS idx_sales_customer      ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_created       ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale     ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_po_supplier         ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_items_po         ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_message_log_status  ON message_log(status);

-- Files people upload: invoices, photos, delivery notes, anything. Stored on
-- disk under uploads/ with a generated name; this table keeps the real name and
-- what it belongs to. related_type/related_id is a soft link so a file can hang
-- off a product, sale or customer, or off nothing at all.
CREATE TABLE IF NOT EXISTS files (
  id            SERIAL PRIMARY KEY,
  stored_name   VARCHAR(200) NOT NULL UNIQUE,
  original_name VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(150) NOT NULL,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  description   TEXT,
  related_type  VARCHAR(40),
  related_id    INTEGER,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Key/value so new settings don't need a migration each time.
CREATE TABLE IF NOT EXISTS settings (
  key        VARCHAR(80) PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_files_related     ON files(related_type, related_id);
CREATE INDEX IF NOT EXISTS idx_files_created     ON files(created_at);
CREATE INDEX IF NOT EXISTS idx_products_sku      ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_stock    ON products(stock_quantity);
CREATE INDEX IF NOT EXISTS idx_customers_name    ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_phone   ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_sales_reference   ON sales(reference);
CREATE INDEX IF NOT EXISTS idx_sales_status      ON sales(payment_status);
CREATE INDEX IF NOT EXISTS idx_po_status         ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_message_created   ON message_log(created_at);
