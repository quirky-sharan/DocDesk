# DocDesk

A front desk that runs itself — inventory, receipts and customer records for
small businesses currently getting by on a spreadsheet.

Built for people who are not technical. Every screen should be obvious, forgiving,
and hard to break.

> **Status: Phase 4 of 6 — the AI layer is in.**
> Everything works, in light or dark, and you can talk to your tables.

---

## Running it

You need [Node.js](https://nodejs.org) 18 or newer. Nothing else — no database to
install, no accounts to create, no keys.

**Windows:** double-click `start_all.bat`.

**Anything else:**

```bash
cd server && npm install && npm run migrate && npm run dev
```

```bash
cd client && npm install && npm run dev
```

Then open **http://localhost:5173**.

On first run the dashboard offers to load sample data so there is something to
look at. Add your own products from the Inventory page whenever you're ready.

---

## How it fits together

```
client/   React + Vite + Tailwind      → localhost:5173
server/   Express REST API             → localhost:5000
          └ db/  SQLite file, or Postgres when DATABASE_URL is set
ml/       reserved for Phase 4, empty on purpose
```

In development Vite proxies `/api` to the Express server, so there is no CORS
setup and no `.env` file needed to get started.

### The database switches itself

`server/db/index.js` picks its driver from the environment:

| `DATABASE_URL` | Driver | When |
|---|---|---|
| not set | SQLite file in `server/db/` | local development, the default |
| set | PostgreSQL | deployment |

All SQL is written once, Postgres-first with `$1` placeholders, and rewritten to
SQLite's positional `?` at the seam in `server/db/sql.js`. So local development
needs no setup and deploying is a config change rather than a rewrite.

The two schema files in `server/db/` are kept deliberately parallel. **Adding a
table means editing both.**

---

## Server commands

Run these from `server/`.

| Command | What it does |
|---|---|
| `npm run dev` | start with auto-reload |
| `npm start` | start once |
| `npm run migrate` | create tables — safe to re-run |
| `npm run seed` | insert sample records |
| `npm run seed:clear` | delete all records |

## What it does

**Inventory** — add products, track stock, set a reorder level per product and
see at a glance what is low or out. Stock changes are entered as "add 20" or
"remove 3" rather than by overwriting a total, so two people working at once
cannot clobber each other.

**Sales** — record a sale, and stock moves in the same step. It will not let you
sell more than you have. Lines can be a catalogue product or free text, so
services work too. Every sale produces a receipt, on screen and as a PDF.

**Incoming stock** — raise an order against a supplier. Stock only goes up when
you mark goods as received, and partial deliveries are supported: receive 20 of
50 now and the rest later.

**Messages** — DocDesk notices when something runs low or a sale needs
confirming and queues the message. *Sending is not connected yet* — that needs
an email account, which comes in Phase 6. Until then the Messages page shows
exactly what would go out.

**Files** — keep invoices, delivery notes and photos in one place. Drag them in,
preview images and PDFs without downloading, attach them to a product or sale.

**Import** — already keeping stock in a spreadsheet? Export it as CSV and import
it. DocDesk works out which of your columns is which, shows you what it found
before saving anything, and tells you which rows it couldn't read.

**Reports** — revenue, profit estimate, what sells best, who spends most, and
what any one customer has bought before.

**Export** — every table downloads as CSV, Excel, JSON or PDF, and respects
whatever search and sorting you had applied.

**Settings** — your shop's name, address and footer go on every receipt.

**Ask in plain English** — type *"sort by price, cheapest first"* or *"add a
column for expiry date"* above any table. It shows you what it's about to do,
with a preview, and waits for you to say yes. Simple requests work out of the
box; connect a free AI key (see `REQUIREMENTS.md`) and it understands the rest.

**Light or dark** — the toggle in the top bar cycles: match your computer,
always light, always dark. It remembers your choice.

## API

| Route | Purpose |
|---|---|
| `GET /api/health` | liveness plus a real database round trip |
| `GET /api/stats` | live row counts |
| `GET/POST /api/products`, `/customers`, `/suppliers` | list and create |
| `GET/PUT/DELETE /api/products/:id` | single record |
| `POST /api/products/:id/stock` | adjust stock by a delta |
| `GET /api/products/summary` | counts, low stock, stock value |
| `GET/POST /api/sales` | list and record sales |
| `GET /api/sales/:id/receipt` | receipt as JSON |
| `GET /api/sales/:id/receipt.pdf` | receipt as PDF |
| `GET/POST /api/purchase-orders` | list and raise orders |
| `POST /api/purchase-orders/:id/receive` | book in a delivery |
| `GET /api/messages` | queued and sent messages |
| `POST /api/messages/send` | run the mock sender |
| `GET /api/export/:table?format=` | csv, xlsx, json or pdf |
| `GET /api/ai/status` | whether an AI provider is connected |
| `POST /api/ai/interpret` | plain English in, described operation + preview out |
| `POST /api/ai/apply` | run an operation the user confirmed |
| `GET/POST /api/files` | list and upload files |
| `GET /api/files/:id/content` | preview or download a file |
| `POST /api/products/import/preview` | dry-run a CSV import |
| `POST /api/products/import` | apply a CSV import |
| `GET/PUT /api/settings` | business details |
| `GET /api/reports/summary` | revenue, margin, outstanding |

All list endpoints accept `search`, `sort`, `dir`, `page` and `pageSize`, and
return `{ rows, total, page, pageCount }`.

---

## Where things are written down

- **`memory.md`** — what was built, why, and what is still open. Read it first.
- **`REQUIREMENTS.md`** — external services and keys, none needed yet.

## Roadmap

| Phase | |
|---|---|
| 1 | Audit and wire-up — **done** |
| 2 | Inventory, sales, receipts, exports, stubbed messaging — **done** |
| 3 | Design pass, light and dark themes — **done** |
| 4 | Natural language table operations — **done** |
| 5 | Stabilisation |
| 6 | Real keys, deployment |
