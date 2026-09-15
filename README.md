# DocDesk

A front desk that runs itself — inventory, receipts and customer records for
small businesses currently getting by on a spreadsheet.

Built for people who are not technical. Every screen should be obvious, forgiving,
and hard to break.

> **Status: Phase 1 of 6 — audit and wire-up.**
> The plumbing is proven end to end. Real inventory and billing features land in
> Phase 2.

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

The dashboard shows three status lights. All green means the browser, the API and
the database are talking to each other. Press **Add sample data** to put some
records in, then restart the server — the numbers stay, which is the point.

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

## API

| Route | Purpose |
|---|---|
| `GET /api/health` | liveness plus a real database round trip |
| `GET /api/stats` | live row counts |
| `POST /api/dev/seed` | insert sample data |
| `DELETE /api/dev/seed` | clear all data |

---

## Where things are written down

- **`memory.md`** — what was built, why, and what is still open. Read it first.
- **`REQUIREMENTS.md`** — external services and keys, none needed yet.

## Roadmap

| Phase | |
|---|---|
| 1 | Audit and wire-up — **done** |
| 2 | Inventory, sales, receipts, exports, stubbed messaging |
| 3 | Design pass, light and dark themes |
| 4 | Natural language table operations |
| 5 | Stabilisation |
| 6 | Real keys, deployment |
