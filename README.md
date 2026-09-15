# DocDesk

A front desk that runs itself — inventory, receipts and customer records for
small businesses currently getting by on a spreadsheet.

Built for people who are not technical. Every screen should be obvious, forgiving,
and hard to break — and underneath, a real PostgreSQL database that does the
bookkeeping itself.

> **Status: design and database rebuilt.** Every page is redesigned, the data
> lives in PostgreSQL with its rules enforced by the database, and there is a
> full database console built in.

---

## Running it

You need [Node.js](https://nodejs.org) 18 or newer. Nothing else — no database to
install, no accounts to create, no keys.

**Windows:** double-click **`start_all.bat`**. That's the only thing you need to run.

It checks Node, installs packages the first time (and again whenever they
change), starts the API — which prepares the database on its own — starts the
web app, confirms the AI assistant is connected, and opens the browser. Run it
again while DocDesk is already up and it just reuses what's running.

To stop everything, double-click **`stop_all.bat`**. It asks the API to close the
database cleanly first.

**Anything else:**

```bash
cd server && npm install && npm run dev
```

```bash
cd client && npm install && npm run dev
```

Then open **http://localhost:5173**.

On first run the dashboard offers to load sample data — five months of trading
for a small stationery shop — so there is something to look at.

---

## How it fits together

```
client/   React 19 + Vite + Tailwind, motion, three.js   → localhost:5173
server/   Express REST API                               → localhost:5000
          └ db/  PostgreSQL: embedded locally, hosted via DATABASE_URL
```

In development Vite proxies `/api` to the Express server, so there is no CORS
setup and no `.env` file needed to get started.

### One database engine, two ways to run it

DocDesk is PostgreSQL everywhere. What changes is where PostgreSQL runs:

| `DATABASE_URL` | Engine | When |
|---|---|---|
| not set | **Embedded PostgreSQL 18** (PGlite, compiled to WebAssembly), data in `server/db/pgdata/` | on your computer — nothing to install |
| set | Any PostgreSQL server (Neon, Supabase, Render, your own) through a connection pool | deployment |

Same SQL, same migrations, same triggers in both — so what you test locally is
exactly what runs in production. The embedded engine runs in a worker thread so
a slow query can never freeze the API, and a lock file stops two servers opening
the same data folder.

### The database keeps itself correct

The rules live in the database, not just the app, so they hold no matter what
writes to it — a page, the assistant, or someone typing SQL.

- **Versioned migrations** (`server/db/migrations/001…006`), checksummed and applied in order on start.
- **Foreign keys and CHECK constraints** — stock can't go negative, a payment can't exceed what's owed, a sale's total must equal its lines.
- **A stock ledger.** Every stock change is a row in `stock_movements`; a trigger keeps each product's balance in step, inside the same transaction.
- **Payments drive status.** A sale is paid, part paid or unpaid because of the payments recorded against it, worked out by a trigger.
- **Low-stock alerts** are raised by a trigger the moment stock crosses the reorder level.
- **Audit trail.** A generic trigger records the before and after of every insert, update and delete, with who made it (you, the assistant, the SQL console).
- **Optimistic locking.** Each edit checks a row version, so two people can't silently overwrite each other.
- **Reporting views and functions** (`v_sales`, `report_sales_by_day`, …) and trigram indexes for typo-tolerant search.
- **Backups.** One compressed file with every record; made daily automatically on the embedded engine and restorable in one transaction.

`server/db/ER_diagram.md` has the full schema, generated from the live catalog.

---

## What it does

**Dashboard** — a greeting that tells you how the week is going in a sentence, a
3D skyline of daily takings, today against a usual day, what's selling, what
needs restocking and the latest changes.

**Inventory** — products with a stock meter each, categories, a 3D "stock city"
view, CSV import that works out your columns, and a per-product history: sales,
the stock ledger and every change.

**Sales** — a two-pane till with a live receipt that prints itself, part
payments and refunds recorded as payments, and receipts on screen or as PDF.

**Incoming stock** — orders against suppliers, partial deliveries, and a restock
helper that suggests what to order from recent sales.

**Customers and suppliers** — lifetime value, visits, what's owed and buying
habits per customer; what each supplier supplies and has on order.

**Reports** — any period: revenue, profit and margin against the period before,
plain-language findings, busy hours (2D heatmap or 3D terrain), a typical week,
where the money goes, how people paid, categories, best sellers, top customers
and stock value.

**Files** — drag in invoices and photos, grid or list, previews without
downloading.

**Messages** — an outbox of alerts and receipts DocDesk decided to send.
*Delivery is simulated* until an email or SMS provider is connected.

**Database** — the engine, open for inspection:

| Tab | |
|---|---|
| Overview | engine, size, object counts, a live query pulse and a 3D core that glows as queries run |
| Tables | browse rows, columns, indexes, constraints, triggers and the `CREATE TABLE` for any table |
| Diagram | an interactive ER diagram — drag tables, trace relationships, crow's-foot ends |
| SQL | a SQL workbench: highlighting, autocomplete, examples, history, results grid, charts, CSV, and a visual **EXPLAIN** plan |
| Activity | the audit trail, filterable by table, action and who did it, with before/after diffs |
| Performance | throughput, p50/p95, slowest query shapes, cache hit rate and index usage |
| Health | integrity checks that cross-check every derived total, with one-click repairs, plus maintenance |
| Backups | back up now, download, restore from a file or a saved backup, export as SQL |

Reads in the console run in a read-only transaction that is always rolled back.
Changes need **Allow changes** switched on, and on a hosted database that switch
is off unless `DB_ADMIN=on`.

**Settings** — business details with a live receipt preview, currency and tax,
the business timezone (reports count days in it), appearance, assistant status,
and sample data.

**The assistant** — a receptionist on every page. Press **Ctrl+J** or click the
orb, and ask or tell it anything:

- *"How are we doing today?"* · *"What needs reordering?"*
- *"Show me unpaid sales"* — it opens Sales and sets the filter for you
- *"Sell 3 sticky notes to Priya, paid by UPI"* — and hands you the receipt
- *"Order everything that's running low"* · *"Back up the database now"*

**It never changes anything without asking.** Anything that adds, edits,
deletes or orders shows a card with exactly what will happen and waits for you
to confirm. It needs a free Groq key — see `REQUIREMENTS.md`.

### Keyboard

| Keys | |
|---|---|
| **Ctrl+K** or **/** | search everything — typo-tolerant — and jump anywhere; type a sentence to hand it to the assistant |
| **Ctrl+J** | open the assistant |
| **Ctrl+Enter** | run the query in the SQL console |
| **Esc** | close the top dialog or panel |

**Light or dark** — follows your computer, or pin either from the sidebar. The
switch spreads out from where you clicked.

---

## Server commands

Run these from `server/`.

| Command | What it does |
|---|---|
| `npm run dev` | start with auto-reload (runs migrations on start) |
| `npm start` | start once |
| `npm run migrate` | apply pending migrations — refuses while the API has the database open |
| `npm run seed` | load the sample data into an empty database |
| `npm run seed:clear` | delete all business records |
| `npm run bench:ai` | score the assistant against real requests |

## API

| Route | Purpose |
|---|---|
| `GET /api/health` | liveness plus a real database round trip, engine and version |
| `GET /api/stats` | exact row counts |
| `GET /api/search?q=` | ranked, typo-tolerant search across products, customers, suppliers and sales |
| `GET/POST /api/products`, `/customers`, `/suppliers` | list and create |
| `GET/PUT/DELETE /api/products/:id` | single record (PUT checks `row_version`) |
| `POST /api/products/:id/stock` · `GET …/movements` | adjust stock · the ledger |
| `GET/POST /api/sales` · `GET …/:id/receipt(.pdf)` | sales and receipts |
| `POST /api/sales/:id/payments` · `DELETE …/payments/:paymentId` | record or remove a payment or refund |
| `GET/POST /api/purchase-orders` · `POST …/:id/receive` | orders and deliveries |
| `GET /api/reports/summary`, `/sales-by-day`, `/heatmap`, `/by-weekday`, `/top-products`, `/top-customers`, `/by-category`, `/by-payment-method`, `/stock-by-category`, `/pulse` | reports, bucketed in the business timezone |
| `GET /api/db/overview`, `/tables`, `/tables/:name`, `/tables/:name/rows`, `/relationships`, `/routines` | catalog |
| `POST /api/db/query` · `POST /api/db/explain` | SQL console and query plans |
| `GET /api/db/activity`, `/history/:table/:id`, `/performance` | audit trail and monitoring |
| `GET /api/db/integrity` · `POST …/:id/fix` | integrity checks and repairs |
| `GET/POST /api/db/backups` · `POST /api/db/restore` · `GET /api/db/export.sql` | backups |
| `POST /api/assistant/message` · `/confirm` · `/cancel` | the assistant |
| `GET /api/export/:table?format=` | csv, xlsx, json or pdf |
| `GET/POST /api/files` · `GET /api/messages` · `GET/PUT /api/settings` | the rest |

All list endpoints accept `search`, `sort`, `dir`, `page` and `pageSize`, and
return `{ rows, total, page, pageCount }`.

---

## Where things are written down

- **`memory.md`** — what was built, why, and what is still open. Read it first.
- **`REQUIREMENTS.md`** — keys, services and every setting, including deploying with a hosted PostgreSQL.
- **`server/db/ER_diagram.md`** — the schema.
