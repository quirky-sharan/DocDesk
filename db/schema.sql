-- DocDesk Clinic Management System
-- PostgreSQL schema — run this in your Supabase SQL editor

-- ─────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('admin', 'doctor', 'receptionist');
CREATE TYPE appt_status AS ENUM ('scheduled', 'completed', 'cancelled');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'cancelled');

-- ─────────────────────────────────────────────────────────────
-- USERS  (staff accounts)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  role          user_role   NOT NULL DEFAULT 'receptionist',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- PATIENTS  (pet + owner info)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS patients (
  id          SERIAL PRIMARY KEY,
  owner_name  VARCHAR(150) NOT NULL,
  pet_name    VARCHAR(100) NOT NULL,
  species     VARCHAR(80),
  breed       VARCHAR(100),
  age         NUMERIC(5,2),           -- in years, fractions OK
  gender      VARCHAR(20),
  phone       VARCHAR(20),
  email       VARCHAR(255),
  address     TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- auto-update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER patients_updated_at
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- APPOINTMENTS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS appointments (
  id                SERIAL PRIMARY KEY,
  patient_id        INTEGER     NOT NULL REFERENCES patients(id)  ON DELETE CASCADE,
  doctor_id         INTEGER               REFERENCES users(id)    ON DELETE SET NULL,
  appointment_date  DATE        NOT NULL,
  appointment_time  TIME        NOT NULL,
  reason            VARCHAR(255),
  status            appt_status NOT NULL DEFAULT 'scheduled',
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- MEDICATIONS  (inventory)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS medications (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(200) NOT NULL,
  dosage_form    VARCHAR(80),           -- e.g. tablet, syrup, injection
  unit           VARCHAR(40),           -- e.g. mg, ml, piece
  stock_quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_per_unit NUMERIC(10,2) NOT NULL DEFAULT 0,
  description    TEXT,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- PRESCRIPTIONS  (medications issued in an appointment)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prescriptions (
  id             SERIAL PRIMARY KEY,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  medication_id  INTEGER NOT NULL REFERENCES medications(id)  ON DELETE RESTRICT,
  dosage         VARCHAR(100),
  frequency      VARCHAR(100),   -- e.g. "twice daily"
  duration_days  INTEGER,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- BILLS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bills (
  id              SERIAL PRIMARY KEY,
  patient_id      INTEGER        NOT NULL REFERENCES patients(id)     ON DELETE CASCADE,
  appointment_id  INTEGER                 REFERENCES appointments(id) ON DELETE SET NULL,
  subtotal        NUMERIC(10,2)  NOT NULL DEFAULT 0,
  tax             NUMERIC(10,2)  NOT NULL DEFAULT 0,
  discount        NUMERIC(10,2)  NOT NULL DEFAULT 0,
  total           NUMERIC(10,2)  NOT NULL DEFAULT 0,
  payment_status  payment_status NOT NULL DEFAULT 'pending',
  payment_method  VARCHAR(80),           -- e.g. cash, card, UPI
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- BILL ITEMS  (line items on a bill)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bill_items (
  id           SERIAL PRIMARY KEY,
  bill_id      INTEGER       NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  description  VARCHAR(255)  NOT NULL,
  quantity     NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price   NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_price  NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED
);
