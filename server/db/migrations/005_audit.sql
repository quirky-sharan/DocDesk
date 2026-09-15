-- 005 Audit trail: who changed what, and what it was before.
--
-- One generic trigger function records INSERT, UPDATE and DELETE on every
-- business table into audit_log, with the whole row before and after as JSONB
-- and the list of columns that actually changed. The actor comes from the API
-- (web, assistant, sql-console). Updates that change nothing meaningful, and
-- echoes of changes already recorded elsewhere, are skipped so the log reads as
-- a history rather than noise.

CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_old     jsonb;
  v_new     jsonb;
  v_changed text[];
BEGIN
  IF app_restoring() OR app_setting('docdesk.skip_audit') = 'on' THEN
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := to_jsonb(OLD);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := to_jsonb(NEW);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key ORDER BY n.key) INTO v_changed
      FROM jsonb_each(v_new) AS n
     WHERE n.key NOT IN ('updated_at', 'row_version')
       AND n.value IS DISTINCT FROM (v_old -> n.key);

    IF v_changed IS NULL THEN
      RETURN NULL;
    END IF;
    -- Stock moved by the ledger is already recorded, with its reason, in stock_movements.
    IF TG_TABLE_NAME = 'products' AND v_changed = ARRAY['stock_quantity'] AND app_setting('docdesk.ledger') = 'on' THEN
      RETURN NULL;
    END IF;
    -- Payment status follows the payments table, which is audited itself.
    IF TG_TABLE_NAME = 'sales' AND app_setting('docdesk.payment_sync') = 'on'
       AND v_changed <@ ARRAY['amount_paid', 'payment_status', 'payment_method'] THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO audit_log (table_name, record_id, record_key, action, actor, changed_fields, old_data, new_data, created_at)
  VALUES (
    TG_TABLE_NAME,
    CASE WHEN COALESCE(v_new, v_old) ? 'id' THEN (COALESCE(v_new, v_old) ->> 'id')::bigint END,
    CASE WHEN COALESCE(v_new, v_old) ? 'key' THEN COALESCE(v_new, v_old) ->> 'key' END,
    TG_OP,
    app_actor(),
    v_changed,
    v_old,
    v_new,
    app_clock()
  );
  RETURN NULL;
END
$$;
COMMENT ON FUNCTION audit_row() IS 'Generic audit trigger: records the row before and after every change, and which columns changed.';

CREATE OR REPLACE TRIGGER categories_audit AFTER INSERT OR UPDATE OR DELETE ON categories FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE OR REPLACE TRIGGER customers_audit AFTER INSERT OR UPDATE OR DELETE ON customers FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE OR REPLACE TRIGGER suppliers_audit AFTER INSERT OR UPDATE OR DELETE ON suppliers FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE OR REPLACE TRIGGER products_audit AFTER INSERT OR UPDATE OR DELETE ON products FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE OR REPLACE TRIGGER sales_audit AFTER INSERT OR UPDATE OR DELETE ON sales FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE OR REPLACE TRIGGER payments_audit AFTER INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE OR REPLACE TRIGGER purchase_orders_audit AFTER INSERT OR UPDATE OR DELETE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE OR REPLACE TRIGGER files_audit AFTER INSERT OR UPDATE OR DELETE ON files FOR EACH ROW EXECUTE FUNCTION audit_row();
CREATE OR REPLACE TRIGGER settings_audit AFTER INSERT OR UPDATE OR DELETE ON settings FOR EACH ROW EXECUTE FUNCTION audit_row();
