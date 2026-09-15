-- DocDesk core schema (SQLite)
-- Universal small-business front desk: products, customers, sales, restocking.
-- Keep this structurally identical to schema.postgres.sql.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  contact_name TEXT,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sku            TEXT UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT,
  category       TEXT,
  unit           TEXT NOT NULL DEFAULT 'unit',
  cost_price     REAL NOT NULL DEFAULT 0,
  sale_price     REAL NOT NULL DEFAULT 0,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  reorder_level  INTEGER NOT NULL DEFAULT 0,
  supplier_id    INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reference      TEXT UNIQUE,
  customer_id    INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  subtotal       REAL NOT NULL DEFAULT 0,
  tax            REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
                 CHECK (payment_status IN ('unpaid','partial','paid','refunded')),
  payment_method TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- description is denormalised on purpose so a receipt still reads correctly
-- after the underlying product is renamed or deleted.
CREATE TABLE IF NOT EXISTS sale_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id     INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity    REAL NOT NULL DEFAULT 1,
  unit_price  REAL NOT NULL DEFAULT 0,
  line_total  REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reference     TEXT UNIQUE,
  supplier_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','ordered','partial','received','cancelled')),
  expected_date TEXT,
  received_date TEXT,
  total         REAL NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id        INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description       TEXT NOT NULL,
  quantity          REAL NOT NULL DEFAULT 1,
  quantity_received REAL NOT NULL DEFAULT 0,
  unit_cost         REAL NOT NULL DEFAULT 0
);

-- Automated messaging is stubbed until Phase 6; rows land here as 'queued'
-- and the mock sender marks them 'sent' so the trigger logic is observable.
CREATE TABLE IF NOT EXISTS message_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  channel      TEXT NOT NULL DEFAULT 'email',
  recipient    TEXT,
  subject      TEXT,
  body         TEXT,
  trigger_type TEXT,
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','sent','failed')),
  related_type TEXT,
  related_id   INTEGER,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_name       ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_category   ON products(category);
CREATE INDEX IF NOT EXISTS idx_sales_customer      ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_created       ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale     ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_po_supplier         ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_items_po         ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_message_log_status  ON message_log(status);
