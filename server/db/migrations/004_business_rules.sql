-- 004 Business rules, enforced inside the database.
--
-- Anything that must stay true regardless of who writes - stock never going
-- negative, the ledger matching the balance, a sale adding up, payment status
-- matching the money actually received - lives here as functions and triggers.
-- The API stays thin: it records what happened and the database does the rest.
--
-- Error messages raised here are written for the person at the counter and are
-- marked with HINT 'docdesk' so the API passes them through unchanged.

-- updated_at, and row_version for optimistic locking --------------------------
CREATE OR REPLACE FUNCTION touch_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := app_clock();
  IF TG_NARGS > 0 AND TG_ARGV[0] = 'versioned' THEN
    NEW.row_version := OLD.row_version + 1;
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER categories_touch BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE OR REPLACE TRIGGER suppliers_touch BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION touch_row('versioned');
CREATE OR REPLACE TRIGGER customers_touch BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION touch_row('versioned');
CREATE OR REPLACE TRIGGER products_touch BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION touch_row('versioned');
CREATE OR REPLACE TRIGGER sales_touch BEFORE UPDATE ON sales FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE OR REPLACE TRIGGER purchase_orders_touch BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE OR REPLACE TRIGGER settings_touch BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION touch_row();

-- Document numbers ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reference IS NULL OR btrim(NEW.reference) = '' THEN
    NEW.reference := TG_ARGV[0] || nextval(TG_ARGV[1]::regclass);
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE TRIGGER sales_reference BEFORE INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION assign_reference('S-', 'sale_number_seq');
CREATE OR REPLACE TRIGGER purchase_orders_reference BEFORE INSERT ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION assign_reference('PO-', 'purchase_order_number_seq');

-- The stock ledger ---------------------------------------------------------------
-- The only sanctioned way to move stock. Locks the product row, refuses to go
-- below zero with a readable message, updates the balance and writes the ledger
-- line - all in one step, so the two can never disagree.
CREATE OR REPLACE FUNCTION apply_stock_change(
  p_product_id     bigint,
  p_change         numeric,
  p_kind           text,
  p_reference_type text DEFAULT NULL,
  p_reference_id   bigint DEFAULT NULL,
  p_note           text DEFAULT NULL
) RETURNS numeric
LANGUAGE plpgsql AS $$
DECLARE
  v_current numeric;
  v_name    text;
  v_balance numeric;
BEGIN
  SELECT stock_quantity, name INTO v_current, v_name
    FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL; -- the product was deleted; there is nothing left to move
  END IF;
  IF p_change = 0 THEN
    RETURN v_current;
  END IF;
  IF v_current + p_change < 0 THEN
    RAISE EXCEPTION 'Not enough % in stock: % left, % needed.', v_name, trim_scale(v_current), trim_scale(-p_change)
      USING ERRCODE = 'check_violation', CONSTRAINT = 'products_stock_quantity_check', HINT = 'docdesk';
  END IF;

  PERFORM set_config('docdesk.ledger', 'on', true);
  UPDATE products SET stock_quantity = stock_quantity + p_change
   WHERE id = p_product_id
   RETURNING stock_quantity INTO v_balance;
  PERFORM set_config('docdesk.ledger', 'off', true);

  INSERT INTO stock_movements (product_id, change, balance_after, kind, reference_type, reference_id, note, actor, created_at)
  VALUES (p_product_id, p_change, v_balance, p_kind, p_reference_type, p_reference_id, p_note, app_actor(), app_clock());
  RETURN v_balance;
END
$$;
COMMENT ON FUNCTION apply_stock_change(bigint, numeric, text, text, bigint, text) IS
  'Moves stock for one product and records why, atomically. Rejects changes that would leave stock below zero.';

-- Stock changed any other way (the edit form, a bulk change, the SQL console)
-- still lands in the ledger, marked as a correction.
CREATE OR REPLACE FUNCTION products_stock_ledger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_restoring() THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.stock_quantity <> 0 THEN
      INSERT INTO stock_movements (product_id, change, balance_after, kind, note, actor, created_at)
      VALUES (NEW.id, NEW.stock_quantity, NEW.stock_quantity,
              COALESCE(app_setting('docdesk.stock_kind'), 'opening'),
              COALESCE(app_setting('docdesk.stock_note'), 'Opening stock'),
              app_actor(), app_clock());
    END IF;
  ELSIF NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity
        AND COALESCE(app_setting('docdesk.ledger'), 'off') <> 'on' THEN
    INSERT INTO stock_movements (product_id, change, balance_after, kind, note, actor, created_at)
    VALUES (NEW.id, NEW.stock_quantity - OLD.stock_quantity, NEW.stock_quantity,
            COALESCE(app_setting('docdesk.stock_kind'), 'correction'),
            COALESCE(app_setting('docdesk.stock_note'), 'Stock level edited directly'),
            app_actor(), app_clock());
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE TRIGGER products_stock_ledger AFTER INSERT OR UPDATE OF stock_quantity ON products
  FOR EACH ROW EXECUTE FUNCTION products_stock_ledger();

-- Low-stock alerts: queued when a product reaches its reorder level, withdrawn
-- when it is restocked above it. One waiting alert per product (unique index).
CREATE OR REPLACE FUNCTION products_low_stock_alert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_subject text;
  v_body    text;
BEGIN
  IF app_restoring() THEN
    RETURN NULL;
  END IF;
  IF NEW.reorder_level > 0 AND NEW.stock_quantity <= NEW.reorder_level THEN
    IF NEW.stock_quantity <= 0 THEN
      v_subject := 'Out of stock: ' || NEW.name;
      v_body := format('%s (%s) has sold out. Reorder level is %s.', NEW.name, COALESCE(NEW.sku, 'no SKU'), trim_scale(NEW.reorder_level));
    ELSE
      v_subject := 'Running low: ' || NEW.name;
      v_body := format('%s (%s) is down to %s, at or below its reorder level of %s.', NEW.name, COALESCE(NEW.sku, 'no SKU'),
                       trim_scale(NEW.stock_quantity), trim_scale(NEW.reorder_level));
    END IF;
    INSERT INTO message_log (channel, subject, body, trigger_type, status, related_type, related_id, created_at)
    VALUES ('email', v_subject, v_body, 'low_stock', 'queued', 'product', NEW.id, app_clock())
    ON CONFLICT (related_type, related_id) WHERE trigger_type = 'low_stock' AND status = 'queued'
    DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body;
  ELSE
    DELETE FROM message_log
     WHERE trigger_type = 'low_stock' AND status = 'queued' AND related_type = 'product' AND related_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE TRIGGER products_low_stock_alert AFTER INSERT OR UPDATE OF stock_quantity, reorder_level ON products
  FOR EACH ROW EXECUTE FUNCTION products_low_stock_alert();

-- Selling moves stock -------------------------------------------------------------
CREATE OR REPLACE FUNCTION sale_items_move_stock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_reference text;
BEGIN
  IF app_restoring() THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.product_id IS NOT NULL THEN
      SELECT reference INTO v_reference FROM sales WHERE id = NEW.sale_id;
      PERFORM apply_stock_change(NEW.product_id, -NEW.quantity, 'sale', 'sale', NEW.sale_id, 'Sold on ' || v_reference);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.product_id IS NOT NULL THEN
      SELECT reference INTO v_reference FROM sales WHERE id = OLD.sale_id;
      PERFORM apply_stock_change(OLD.product_id, OLD.quantity, 'sale_void', 'sale', OLD.sale_id,
                                 'Back in stock: ' || COALESCE(v_reference, 'deleted sale'));
    END IF;
  ELSIF OLD.product_id IS NOT DISTINCT FROM NEW.product_id THEN
    IF NEW.product_id IS NOT NULL AND NEW.quantity <> OLD.quantity THEN
      PERFORM apply_stock_change(NEW.product_id, OLD.quantity - NEW.quantity, 'correction', 'sale', NEW.sale_id, 'Sale quantity changed');
    END IF;
  ELSIF NEW.product_id IS NOT NULL THEN
    -- A line moved to a different product (a product being deleted sets this to
    -- NULL instead, and needs nothing: the stock went with the product).
    IF OLD.product_id IS NOT NULL THEN
      PERFORM apply_stock_change(OLD.product_id, OLD.quantity, 'correction', 'sale', OLD.sale_id, 'Sale line changed');
    END IF;
    PERFORM apply_stock_change(NEW.product_id, -NEW.quantity, 'correction', 'sale', NEW.sale_id, 'Sale line changed');
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE TRIGGER sale_items_move_stock AFTER INSERT OR DELETE OR UPDATE OF product_id, quantity ON sale_items
  FOR EACH ROW EXECUTE FUNCTION sale_items_move_stock();

-- A sale must add up. Checked at COMMIT (deferred), because the sale row is
-- written before its lines - the SQL-standard ASSERTION, emulated.
CREATE OR REPLACE FUNCTION sales_check_totals() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_sale_id   bigint;
  v_subtotal  numeric;
  v_reference text;
  v_lines     numeric;
BEGIN
  IF app_restoring() THEN
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'sales' THEN
    v_sale_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_sale_id := OLD.sale_id;
  ELSE
    v_sale_id := NEW.sale_id;
  END IF;

  SELECT subtotal, reference INTO v_subtotal, v_reference FROM sales WHERE id = v_sale_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(sum(line_total), 0) INTO v_lines FROM sale_items WHERE sale_id = v_sale_id;
  IF v_lines <> v_subtotal THEN
    RAISE EXCEPTION 'Sale % does not add up: its lines come to %, but its subtotal says %.', v_reference, v_lines, v_subtotal
      USING ERRCODE = 'check_violation', HINT = 'docdesk';
  END IF;
  RETURN NULL;
END
$$;

-- OR REPLACE is not supported for constraint triggers, hence drop-then-create.
DROP TRIGGER IF EXISTS sale_items_totals_check ON sale_items;
CREATE CONSTRAINT TRIGGER sale_items_totals_check AFTER INSERT OR UPDATE OR DELETE ON sale_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sales_check_totals();

DROP TRIGGER IF EXISTS sales_totals_check ON sales;
CREATE CONSTRAINT TRIGGER sales_totals_check AFTER INSERT OR UPDATE OF subtotal ON sales
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sales_check_totals();

-- Payments drive payment status -----------------------------------------------------
CREATE OR REPLACE FUNCTION payments_sync_sale() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_sale_id   bigint;
  v_total     numeric;
  v_reference text;
  v_paid      numeric;
  v_refunds   integer;
  v_method    text;
BEGIN
  IF app_restoring() THEN
    RETURN NULL;
  END IF;
  v_sale_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.sale_id ELSE NEW.sale_id END;

  SELECT total, reference INTO v_total, v_reference FROM sales WHERE id = v_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(sum(amount), 0), count(*) FILTER (WHERE amount < 0)
    INTO v_paid, v_refunds
    FROM payments WHERE sale_id = v_sale_id;

  IF v_paid > v_total THEN
    RAISE EXCEPTION 'That is more than % owes: % of % would be paid.', v_reference, v_paid, v_total
      USING ERRCODE = 'check_violation', HINT = 'docdesk';
  END IF;
  IF v_paid < 0 THEN
    RAISE EXCEPTION 'A refund cannot be more than was paid on %.', v_reference
      USING ERRCODE = 'check_violation', HINT = 'docdesk';
  END IF;

  SELECT method INTO v_method FROM payments WHERE sale_id = v_sale_id ORDER BY paid_at DESC, id DESC LIMIT 1;

  PERFORM set_config('docdesk.payment_sync', 'on', true);
  UPDATE sales
     SET amount_paid = v_paid,
         payment_status = CASE
           WHEN v_refunds > 0 AND v_paid = 0 THEN 'refunded'
           WHEN v_paid = 0 THEN 'unpaid'
           WHEN v_paid < v_total THEN 'partial'
           ELSE 'paid'
         END,
         payment_method = COALESCE(v_method, payment_method)
   WHERE id = v_sale_id;
  PERFORM set_config('docdesk.payment_sync', 'off', true);
  RETURN NULL;
END
$$;

CREATE OR REPLACE TRIGGER payments_sync_sale AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_sync_sale();

-- The shop's own timezone (Settings), for turning an instant into a calendar
-- date. Falls back to UTC if unset or not a real zone name.
CREATE OR REPLACE FUNCTION business_timezone() RETURNS text
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_zone text;
BEGIN
  SELECT NULLIF(btrim(value), '') INTO v_zone FROM settings WHERE key = 'timezone';
  IF v_zone IS NULL THEN
    RETURN 'UTC';
  END IF;
  BEGIN
    PERFORM now() AT TIME ZONE v_zone;
    RETURN v_zone;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'UTC';
  END;
END
$$;

-- Receiving stock ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION purchase_order_items_receive() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_reference text;
  v_all       boolean;
  v_any       boolean;
BEGIN
  IF app_restoring() OR NEW.quantity_received IS NOT DISTINCT FROM OLD.quantity_received THEN
    RETURN NULL;
  END IF;

  SELECT reference INTO v_reference FROM purchase_orders WHERE id = NEW.purchase_order_id;
  IF NEW.product_id IS NOT NULL THEN
    PERFORM apply_stock_change(NEW.product_id, NEW.quantity_received - OLD.quantity_received,
                               'purchase_receipt', 'purchase_order', NEW.purchase_order_id, 'Received on ' || v_reference);
  END IF;

  SELECT bool_and(quantity_received >= quantity), bool_or(quantity_received > 0)
    INTO v_all, v_any
    FROM purchase_order_items WHERE purchase_order_id = NEW.purchase_order_id;

  UPDATE purchase_orders
     SET status = CASE WHEN v_all THEN 'received' WHEN v_any THEN 'partial' ELSE 'ordered' END,
         received_date = CASE WHEN v_all THEN (app_clock() AT TIME ZONE business_timezone())::date ELSE NULL END
   WHERE id = NEW.purchase_order_id AND status <> 'cancelled';
  RETURN NULL;
END
$$;

CREATE OR REPLACE TRIGGER purchase_order_items_receive AFTER UPDATE OF quantity_received ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION purchase_order_items_receive();
