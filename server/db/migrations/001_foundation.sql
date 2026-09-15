-- 001 Foundation: extensions, session helpers and document number sequences.
--
-- DocDesk runs on PostgreSQL everywhere: embedded (PGlite) on a shop computer,
-- hosted (Neon, Supabase, Render...) when deployed. Everything here must work
-- on both, which is why optional extensions are wrapped so their absence only
-- disables what depends on them.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm is unavailable (%). Fuzzy search indexes will be skipped.', SQLERRM;
END
$$;

-- Session context. The API sets these per transaction with set_config(..., true):
--   docdesk.actor      who is making the change: web, assistant, sql-console, system
--   docdesk.clock      a timestamp to record instead of now() (sample data, imports)
--   docdesk.restoring  'on' while a backup or import is loaded: side effects off
--   docdesk.ledger     'on' while apply_stock_change() is moving stock
CREATE OR REPLACE FUNCTION app_setting(p_name text) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting(p_name, true), '')
$$;

CREATE OR REPLACE FUNCTION app_actor() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(app_setting('docdesk.actor'), 'system')
$$;

CREATE OR REPLACE FUNCTION app_clock() RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(app_setting('docdesk.clock')::timestamptz, now())
$$;

CREATE OR REPLACE FUNCTION app_restoring() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(app_setting('docdesk.restoring') = 'on', false)
$$;

COMMENT ON FUNCTION app_actor() IS 'Who is making the current change, as set by the API for the transaction.';
COMMENT ON FUNCTION app_clock() IS 'The time to record: now(), unless a backdated import or sample-data load overrides it.';

-- Human-readable document numbers (S-1001, PO-1001). Sequences rather than
-- max()+1 so two sales recorded at the same instant can never collide.
CREATE SEQUENCE IF NOT EXISTS sale_number_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS purchase_order_number_seq START 1001;
