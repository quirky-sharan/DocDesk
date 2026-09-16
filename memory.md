# DocDesk — build log

Running log of what was built, why, and what's still open. Read this first at
the start of any session.

---

## 2026-09-15 — Phase 1: audit & wire-up

### What the repo looked like on arrival

Nothing ran. Three separate problems, each independently fatal:

1. **Frontend could not render.** `main.jsx` wrapped `<App/>` in a
   `<BrowserRouter>`, and `App.jsx` rendered a second `<Router>` inside it.
   React Router throws on a nested router, so the page was blank.
2. **No database existed.** `db.js` hard-required `DATABASE_URL` pointing at
   Supabase with SSL. Only `.env.example` was present, never a real `.env`, so
   every endpoint 500'd.
3. **Two incompatible data models in one codebase.** Six routes were mounted
   (doctors, patients, appointments, medicines, inventory, bills) against a vet
   clinic schema in `db/schema.sql`. Four more (auth, billing, medications,
   export) existed but were **never registered in `index.js`**, and queried
   tables and columns defined in *no* schema file anywhere —
   `exportController` selected `patients.owner_name`, `billingController`
   selected `bills.subtotal` and formatted `i.total_price`, a column its own
   INSERT never wrote. A third and fourth schema (`server/schema.sql`,
   `server/schema-app.sql`) described a different app again.

Also: `migrate.js` read the wrong schema file, `errorHandler.js` was written but
never attached, and the frontend had duplicate page pairs
(Bills/Billing, Medicines/Medications) where only one of each was routed.

### Decisions

**Product scope → universal small business.** Confirmed with Sharan. The
existing code was vet-specific (`species`, `pet_name`, `owner_name`, `doctors`)
but the spec describes a front desk for clinics, shops and small enterprises.
The core model is now generic: `products`, `customers`, `sales`, `sale_items`,
`suppliers`, `purchase_orders`, `message_log`. A clinic is then just one way to
use it rather than a schema baked into the tables.

**Database → one codebase, two drivers.** Sharan wants to deploy eventually,
which rules out plain SQLite (most hosts wipe the filesystem on redeploy), but
requiring a Supabase signup now would break the "no external services before
Phase 6" rule. So `server/db/index.js` picks its driver from the environment:
`DATABASE_URL` set means Postgres, absent means a local SQLite file. A fresh
clone runs with zero setup, and deploying is a config change rather than a
rewrite.

The cost of that is one compatibility seam. All SQL is written Postgres-first
with `$1` placeholders; `server/db/sql.js` rewrites them to positional `?` for
SQLite. It expands reused placeholders into occurrence order because
better-sqlite3 will not bind `?N` from an array, and it skips string literals so
a `$` inside quotes survives. The two schema files are kept deliberately
parallel — **if you add a table, add it to both.**

**Dropped dependencies.** `puppeteer` and `xlsx` were only used by the dead
unmounted controllers, and between them accounted for most of the audit
findings including a critical in `tar` via `node-pre-gyp`. Removed both.
`bcrypt` → `bcryptjs` to kill the last native build step, which also makes
deployment simpler. `npm audit` is clean. Phase 2 will use `pdfkit` for
receipts and `exceljs` for spreadsheets — both maintained, neither needs a
headless browser.

**Auth deferred, not deleted.** There is a `users` table ready, but the login
page and route guard were removed. They pointed at endpoints that no longer
exist, and a half-wired login is worse than none. A single operator running this
on their own machine does not need one yet. Revisit when multi-user or
deployment makes it real.

### What exists now

- `GET /api/health` — liveness plus a real database round trip, so a green light
  means the whole chain works rather than just Express being up
- `GET /api/stats` — live row counts
- `POST|DELETE /api/dev/seed` — sample data, proves writes persist
- Dashboard at `/` showing all of the above
- `npm run migrate` / `npm run seed` / `npm run seed:clear` in `server/`

### Verified by actually running it

Boots clean on both ports. Seed and clear round trip through the UI. Data
survives a server restart. With the backend stopped the UI degrades to a plain
"cannot reach the server" message with the action buttons disabled, and recovers
on its own when the backend returns. No console errors, no backend exceptions.

Transaction behaviour was tested directly: commits apply, a failed statement
rolls the whole transaction back, `CHECK` constraints and foreign keys are
enforced (SQLite needs `PRAGMA foreign_keys = ON`, which the driver sets).

### Open / next

- `ml/` is scaffolded and intentionally empty.
- Phase 2 builds the real CRUD: inventory, sales, receipts, purchase orders,
  the stubbed messaging trigger, and exports.
- Sale line items denormalise `description` on purpose so a receipt still reads
  correctly after a product is renamed or deleted. Keep that property.
- Not yet tested against real Postgres — the driver is written but has only run
  on SQLite. Test before deploying.

---

## 2026-09-15 — Phase 2: full functionality

### Scope decision

Sharan confirmed **universal small business**, not the vet clinic the old code
described. Core model is products / customers / sales / suppliers / purchase
orders, with a clinic being one way to use it rather than a shape baked into
the tables.

### Bug fixed first

"Add sample data" threw a raw `SqliteError: UNIQUE constraint failed:
products.sku` on a second click, because the sample rows use fixed SKUs.
Seeding now checks for existing records *before* touching any table and refuses
with a 409 and a sentence, and the button is disabled while records exist. The
guard is the backstop, not the normal path. Also stopped the error handler
dumping a stack trace for 4xx — a handled refusal is not a fault.

### What was built

Full CRUD for products, customers, suppliers. Sales with transactional stock
movement. Purchase orders with partial receiving. Messaging triggers with a
mock sender. Exports to CSV / JSON / XLSX / PDF for every table, plus PDF
receipts. Seven frontend pages.

### Decisions worth remembering

**Stock adjustment takes a delta, not a new total.** Two people adjusting at
once would otherwise silently overwrite each other. Same reasoning behind
receiving being incremental on purchase orders.

**Sale line items copy their description.** `sale_items.description` is written
at the time of sale rather than joined from `products`. Rename or delete a
product later and old receipts still read correctly — which is the entire point
of a receipt. `product_id` is kept alongside for reporting and goes null on
delete. Do not "fix" this into a join.

**Lines can be free text with no product**, so services and one-off items work
without inventing fake catalogue entries.

**Purchase order status is derived, never set by hand** — computed from what
actually arrived, so it cannot disagree with the line items.

**Low-stock re-alerting is suppressed.** Without it, every sale of an
already-low item would queue another copy. Restocking above the reorder level
clears the queued alert.

**Deleting a sale returns its stock.** Deleting a partly-received purchase
order is refused outright, because stock has already moved — cancel instead.

**`lib/tables.js` is the Phase 4 seam.** Table and column names cannot be bound
as SQL parameters, so everything reaching an identifier position is checked
against a whitelist *and* the live schema before interpolation. The
natural-language layer should drive this module, not build SQL itself.

**Timestamps all come from the database clock.** Passing a JS
`new Date().toISOString()` for `updated_at` produced two different formats in
one column (`2026-09-15 05:51:58` vs `2026-09-15T05:53:07.027Z`), which would
have broken sorting. Use `CURRENT_TIMESTAMP`.

### Dependencies

Added `exceljs` and `pdfkit`. `exceljs` pulls a vulnerable `uuid`, pinned via an
`overrides` entry in `server/package.json` — do not remove it. `npm audit` is
clean. Deliberately did **not** go back to `puppeteer` for PDFs; `pdfkit` needs
no headless browser, which matters for deployment.

### Verified by running it

Sale maths, stock movement, trigger firing, partial receiving, over-receive and
oversell guards, all four export formats opening correctly, CSV escaping of
commas/quotes/newlines, and every failure path leaving stock untouched. Recorded
a sale through the browser end to end: stock moved 22 → 19, confirmation queued
on its own, no console errors.

### Open / next

- **Postgres driver still untested against real Postgres.** Written but only
  ever run on SQLite. Test before deploying.
- Auth still deferred; `users` table exists, nothing uses it.
- Phase 3 is the design pass — no new functionality, and every screen gets
  restyled, including a light/dark toggle.
- `sales.list` and `purchase_orders.list` fetch all customers/suppliers to
  attach names. Fine at this size, worth a join if the tables get large.

---

## 2026-09-15 — Phase 2 extension: files, import, reports, settings, paging

Sharan asked for better search and sorting, optimisation, a file store, and
"whatever else you think is needed". Still Phase 2 — no design work.

### Optimisation: the real problems were in the wrong layer

Three things were being done in JavaScript that belong in SQL:

1. **Sales and purchase orders fetched the entire customers/suppliers table on
   every list request** just to attach one display name. Now a LEFT JOIN,
   declared per table in `lib/tables.js`. Joined columns are searchable too, so
   searching a sale by its customer's name works.
2. **Product stock filtering ran on the returned rows.** That quietly meant the
   total count and page count were wrong whenever a filter was applied — it only
   filtered whatever page you happened to be on. Stock status compares two
   columns so it can't be a bound equality; `extraConditions` takes fixed SQL
   fragments written in the controllers. **Those must never be built from
   request input.**
3. No indexes on the columns search and sort actually hit. Added.

Everything paginates now (page/pageSize in, page/pageCount/total out, capped at
200). **Exports deliberately pass `paginate: false`** — a download is the whole
filtered set, not the page you were looking at.

On the client, six list pages were each hand-rolling the same search/sort/
debounce/loading state. They share `hooks/useList.js` now, which also fixed a
race none of them handled: a slow earlier request could land after a newer one
and overwrite it. Only the newest request writes state.

### Files

Storage is `server/uploads/` (gitignored), names on disk generated, never
derived from the upload — a crafted filename cannot escape the directory or
overwrite anything. Original name kept in the database for display only.

Security decisions worth not undoing:
- **Allow-list of MIME types, not a block-list.** Scripts and archives refused.
- **Only types a browser renders inertly preview inline** (images, PDF, plain
  text); everything else forces a download. Plus `nosniff` and a restrictive
  CSP, so an uploaded document can never execute in the app's origin.
- Previews render in an iframe with `sandbox=""` — no scripts, no same-origin.
- A rejected upload has its bytes deleted; multer writes to disk before the
  route runs, so without that cleanup every rejection leaves an orphan.

### CSV import

The target user is coming off a spreadsheet, so this is the migration path.
Matches their headings against aliases (Price/Rate/MRP all mean sale price),
previews before writing, reports bad rows by line number while still importing
the good ones, and **updates by SKU on re-import rather than duplicating**.

**It accepts CSVs by file extension, not MIME type.** Browsers variously report
a .csv as `text/csv`, `application/vnd.ms-excel` or `application/octet-stream`
depending on the machine and whether Excel is installed — trusting the type
would have failed for real users. Safe only because the importer reads the bytes
as text and deletes the file before responding. **Do not apply that reasoning to
the general file store.**

### Settings and reports

Receipts carried the literal string "DocDesk" instead of the shop's name.
Settings is a whitelisted key/value table so new settings need no migration.
The shop's usual tax rate pre-fills new sales.

Reports cover revenue, estimated margin, sales per day, best sellers, top
customers, and per-customer history. **Margin is an estimate** — it uses each
product's *current* cost price, so changing a cost shifts historical figures.
Storing cost per line at sale time would fix it; worth doing if margin
reporting ever becomes load-bearing.

### Verified by running it

Pagination, filters, joined-column search and sort, injection still blocked on
table/column names. File upload, type rejection, orphan cleanup, inline vs
forced download headers, sandboxed preview. CSV import: column auto-detection,
quoted commas, doubled quotes, multi-line fields, re-import updating by SKU,
bad rows skipped with line numbers, non-CSV refused. Receipt PDF rendered and
read back — the shop name, address, phone and footer all appear. All ten pages
load with zero console errors.

### Still open

- **Postgres driver has still never run against real Postgres.** Same warning as
  last session, now with more SQL riding on it. Test before deploying.
- Product/customer dropdowns on the sale and order forms request 200 rows and
  stop there. A shop with more than 200 products needs those to become
  type-to-search.
- Auth still deferred.

---

## 2026-09-15 — Phase 2 extension 2: charts, sample data, quick actions

### Sample data

Was five products and one sale, which made every chart a single bar. Now 18
products over four categories, 8 customers, ~125 sales across 75 days with a
weekday/weekend rhythm and a slight upward drift, unpaid and part-paid sales,
three purchase orders in different states, and the low-stock alerts those
levels would really have raised.

**It uses a seeded generator** (`makeRandom`) so the data varies but is
identical every run — screenshots and bug reports stay reproducible. Don't
replace it with `Math.random()`.

Backdated sales deliberately **do not** decrement stock: the quantities in
`PRODUCTS` are the current on-hand figures, and a sale from six weeks ago is
already accounted for in them.

### Charts

Hand-rolled SVG in `components/charts.jsx` — no charting dependency. Area chart
with a crosshair that follows the pointer across the plot (not a hit on the 1px
line), horizontal bars, a stacked share bar, a sparkline.

**Colour was picked by rule, and the rules are load-bearing:**
- Single-measure-across-categories charts use **one hue**. The categories are
  already labelled, so colour there would be decoration, not information.
- Only the share bar needs categorical hues. Those four slots were run through
  a CVD validator (worst adjacent ΔE 9.1 protan, 22.9 normal vision) and are
  **assigned in fixed order, never cycled** — a fifth category folds into
  "Other" rather than inventing a hue that no longer separates.
- Three slots sit under 3:1 against the light surface, so that chart always
  ships its legend with percentages, and the revenue chart has a
  **"show as table" toggle**. Don't remove either — they are the relief for
  that contrast finding.
- Direction on the pulse cards carries an **arrow as well as a colour**.

Palette tokens live in `index.css` as CSS variables so Phase 3's dark mode is a
value swap, not a rewrite. The reference palette has dark steps for the same
eight hues — use those rather than flipping the light ones.

### Layout bug found while testing

The body and `<main>` were **both** scrollable, so scrolling tore the sidebar
and header away from the viewport. The shell is now `h-screen overflow-hidden`
with only the content column scrolling. Don't reintroduce `min-h-screen` there.

### Quick actions added

- **Restock suggestion** groups everything below its reorder level by supplier
  and builds the order. Suggested quantity tops each item up to twice its
  reorder level — crude but honest, and editable.
- **Product detail** (click a product name): units sold, revenue, margin, trend,
  what's on order, recent sales, attached files.
- **Mark paid** is one click from the sales list.

### Also

Top bar with business name, an alerts badge counting queued messages, and a
profile menu. **Accounts are not built, and the menu says so** rather than
offering a dead button. Wire real accounts here when auth lands.

---

## 2026-09-15 — Phase 3: design pass and themes

No behaviour changed in this phase. Sharan approved moving on after the charts
and quick actions landed.

### How theming works — read before touching any colour

**Every colour resolves through CSS custom properties in `index.css`.** There
are no hardcoded palette classes left in `pages/` or `components/` (there is a
check for this — see below). Adding a raw `bg-slate-200` anywhere breaks dark
mode silently, because nothing will swap it.

The tokens are declared **three times on purpose**:
1. `:root` — light
2. `@media (prefers-color-scheme: dark) { :root:where(:not([data-theme='light'])) }`
   — the OS setting. The `:where()` keeps specificity at zero so the toggle can
   still win; the `:not()` guard lets an explicit light choice beat OS dark.
3. `:root[data-theme='dark']` — the in-app toggle.

**Theme has three states, not two.** "System" is a real state, not just the
initial value, so someone who switches their machine to dark in the evening
gets it without opening the app. `hooks/useTheme.js` owns this; it listens to
the media query so a live OS change applies immediately.

An inline script in `index.html` applies the saved theme **before React
mounts**. Without it a dark-mode user gets a white flash on every load. It
deliberately duplicates a few lines of `useTheme.js` — keep them in sync.

### Chart dark steps

Not a flip of the light values — the same hues re-stepped for the dark surface
and validated separately: worst adjacent CVD ΔE 8.4, normal-vision 19.8, and
unlike light mode **all four clear 3:1 against the surface**. Light mode's three
sub-3:1 slots are why the share bar always ships its legend and the revenue
chart has a table toggle. Don't remove either.

### A trap worth knowing about

While verifying, `getComputedStyle` reported dark values under
`data-theme="light"` and it looked like a real CSS bug. It wasn't: the browser
pane had stopped painting, which **freezes CSS transitions mid-flight**, and
computed style returns the frozen interpolated value. Injecting
`* { transition: none !important }` before measuring gives the settled values.
If colours ever look "stuck" in an automated check, suspect this first.

### How it was checked

Walked all ten pages in both themes and measured every text node's contrast
against whatever is actually painted behind it (walking up for the first
non-transparent ancestor). Nothing below 2.4:1 in either theme, no console
output. Re-run that audit after any styling change — it catches a missed
retint far faster than looking at screenshots.

---

## 2026-09-15 — Phase 4: the natural-language layer

### The decision everything else rests on

**The model never writes SQL.** It picks one operation from a fixed vocabulary
and fills in its fields. `lib/nlq/operations.js` validates every identifier
against the live schema; `lib/nlq/execute.js` builds the statement itself.

So the worst a hallucinated — or deliberately poisoned — model response can do
is produce a **rejected operation**. It can never become an executed statement.
This was tested by bypassing the model entirely and posting hostile operations
straight to `/api/ai/apply`: SQL in column names, SQL in the table name,
`{"type":"exec_sql"}`, protected-column drops. All refused, both tables intact.

**Do not add an operation type that takes raw SQL, an expression string, or a
free-form WHERE clause.** That would undo the whole design.

Related: `PROTECTED_COLUMNS` (id, created_at, reference, …) can't be renamed,
dropped or bulk-overwritten. Without that, one plausible-sounding request
quietly breaks receipts or stock.

### Nothing applies without confirmation

A request becomes a described operation **plus a live preview**, and the user
confirms. Read-only ops (sort/filter/summarize) change the view, not the data —
`apply` returns `applied: false` for those on purpose. Destructive ones say so
and colour the confirm button as such.

`/api/ai/apply` **re-validates** the operation rather than trusting it. The
request arrives from a browser, so the shape that was approved is not
necessarily the shape that comes back.

### Provider comparison

Every serious free option speaks the OpenAI chat-completions shape, so
`lib/llm/index.js` is one client and a new provider is a base URL plus a model
name.

| | Free tier | Latency | JSON mode | Verdict |
|---|---|---|---|---|
| **Groq** | ~14.4k req/day, 30/min, no card | sub-second typically | yes | **Chosen.** Fastest by a wide margin, most generous tier, and JSON mode removes a class of parsing failures. |
| OpenRouter | `:free` models, rate-limited, can queue | seconds, variable | yes | Good escape hatch for trying models; too variable to default to. |
| Together | $1 credit + some free models | moderate | yes | Allowance runs out. |
| Local Ollama | unlimited, private | slow without a GPU | no | Right answer for privacy, wrong default for a shop laptop. |

**This ranking is from documented limits and API shape, not measured latency —
no key existed when it was written.** `npm run bench:ai` exists to settle it
properly: 12 cases scored for correctness and latency, including two that must
be *refused* rather than guessed at. **Run it once a key is in and record the
real numbers here.**

### It works with no key

A rule-based interpreter handles the common phrasings, with an alias table so
"price" → `sale_price` and "qty" → `stock_quantity`. Two reasons, not one:
the feature does something useful before setup, **and it is a cheap correctness
check** — if the rules and the model disagree on an obvious request, the prompt
has drifted.

Found while testing: the on-screen example said *"sort by price"* but the
columns are `cost_price`/`sale_price`, so the fallback couldn't match its own
example. Fixed by adding the alias table rather than by weakening the example.

### Gotchas

- **Anything altering a table must call `invalidateSchemaCache(table)`** or
  later requests validate against a shape that no longer exists. `execute.js`
  does this for add/rename/drop.
- `buildWhere` qualifies columns as `t.<col>`; `UPDATE … SET` accepts no alias
  in either dialect, so `set_values` strips it for that statement only.
- A hostile column name is **sanitised, not rejected** — `x); DROP TABLE…`
  becomes `x_drop_table_products`. Safe, and the right behaviour for a real user
  typing punctuation, but it means junk names are creatable.
- Repeatedly hit during testing: a stale `node` process keeps port 5000 and the
  new one silently fails to bind, so you test old code. `pkill` doesn't work on
  Windows — stop it by port with PowerShell.

### Keys

`.gitignore` now covers `.env` at every level explicitly while keeping
`.env.example` tracked. **Verified with `git check-ignore`, not assumed.**
Setup instructions for Sharan are in REQUIREMENTS.md.

---

## 2026-09-15 — Phase 5: model retirement, the assistant, one-click launch

### What broke

`Groq returned an error: The model llama-3.3-70b-versatile does not exist`. The
key was fine; Groq retired the model. Available to this key now: `openai/gpt-oss-120b`,
`openai/gpt-oss-20b`, `qwen/qwen3.8-27b` (plus non-chat models). All three were
tested for tool calling and pass.

**Lesson: never hardcode a single model name.** `lib/llm/index.js` now asks
`/models` what the key can use, walks a preference list, and falls through on
"model not found" mid-request.

### Free-tier limits are the real constraint

Measured from response headers: **8,000 tokens/minute and 1,000 requests/day, per
model**. One assistant step is ~2,000–3,000 prompt tokens (the tool schema alone
is ~2,400), and a lookup question takes two steps. A single model throttles after
two or three questions.

What fixed it:
- **Pool the models.** Separate buckets, ~24k/minute combined. Requests route to
  whichever model has room.
- **Model the bucket correctly.** Groq refills *continuously* (limit/60 per
  second), not all at once at reset. The first version treated "remaining" as
  frozen until reset and gave up far too early. `tokensNow()` is the fix.
- Wait up to 25s for allowance rather than erroring; the UI says "Waiting for the
  free AI allowance…" after 6s.
- Shorter tool descriptions, older tool results truncated to 280 chars, history
  capped at 24 messages.
- qwen counts the same prompt as ~2x the tokens gpt-oss does (tokeniser). Keep
  that in mind before reordering the preference list.

### The assistant

Replaced the per-page ask bar with one assistant on every page (Ctrl+K). It is a
tool loop in `lib/assistant/`.

Decisions not to undo:
- **Tools act through DocDesk's own HTTP API** (`internalApi.js`), not the
  database. So the assistant inherits every validation, transaction, stock move
  and trigger, and can never do anything a button can't.
- **Writes never run in the loop.** `prepare()` resolves names and validates,
  returns a plain description, and the change runs only on Confirm. Pending plans
  live server-side (30 min TTL) so the browser can only approve exactly what was
  shown. This is also the prompt-injection defence: text stored in a record can
  at most get a change *proposed*.
- **A confirmed change that succeeded must never be reported as failed.** First
  version: confirm created the customer, then the follow-up AI message hit a rate
  limit and the whole response said it failed. The follow-up is now best-effort
  with a 4s wait and a canned fallback.
- The model sometimes invents a currency symbol the shop never set. It's stripped
  when `currency_symbol` is blank.
- Identical repeated tool calls in one turn are answered from memory (it did call
  `show_on_page` twice in one turn during testing).
- "Go to X and add Y" dropped the navigation, because the loop stops at a
  proposal. Fixed in the prompt (navigate in the same step) plus an "Open page"
  link after any confirmed change.

### gpt-oss phrases operations differently from Llama

Benchmark dropped to 6/12 on the new model. Raw output showed why:
`{"type":"add_column","add_column":{...}}` and, from the assistant,
`{"add_column":{...}}` with no `type` at all. `normaliseShape()` in
`nlq/operations.js` collapses all three shapes before validating; an object naming
two operations is still refused. Plus prompt rules: fields at top level, "price"
means sale_price, a rename target is *meant* to be new. Back to **12/12**, and the
assistant's table-structure tool went from three failed attempts to zero.

**When switching models, run `npm run bench:ai` and read raw outputs on failure
before touching prompts.**

### One-click launch

`start_all.bat` → `scripts/start.ps1` (batch quoting was too fragile). Checks
Node, creates `server/.env` if missing, reinstalls packages when the lockfile hash
changes (not just when node_modules is missing), migrates, starts API and web in
minimised windows, waits for both to answer, reports AI status, opens the browser.
Reuses anything already running.

Gotchas found while testing:
- Vite may bind IPv6 `localhost` only - check the web app by name, not 127.0.0.1.
- npm renames the console window, so `stop_all` finds windows by **command line**
  (`title DocDesk API`), not title, and kills the whole tree with `taskkill /T`.
  Killing only the port owner left nodemon alive to restart the API later.
- Stop is scoped to processes whose own or parent command line is inside this
  folder, so nothing else on the machine is touched.
- `.gitattributes` pins CRLF for .bat/.ps1 — a sed pass silently turned them LF.
- **Testing artefact, not a bug:** processes started from the agent's PowerShell
  tool are killed when that command ends. Launching via WMI (`Win32_Process
  Create`) behaves like a double-click and stays up.

### Security note

Sharan pasted the Groq key into the conversation. It works and is in
`server/.env` (gitignored, verified not in any commit). He should rotate it.

---

## 2026-09-16 — Redesign and the PostgreSQL rebuild

Asked for: a frontend that feels premium (Apple-like: clean, sober, animated,
3D, charts), then a real database and a proper database management system,
keeping deployment in mind.

### Design system (client)

- **Colour tokens are RGB channels** (`--c-accent: 10 132 255`) so Tailwind can
  do `rgb(var(--c-accent) / <alpha-value>)`. Each theme defines every token three
  times: `:root`, `prefers-color-scheme: dark` guarded by `:not([data-theme=light])`,
  and `[data-theme=dark]`. Never give a colour its only definition inside a media block.
- **Chart colours come from a validated palette** (series 1-4 per theme, a
  one-hue sequential ramp, reserved status colours). Text never wears a series colour.
- Motion: `motion/react` with `MotionConfig reducedMotion="user"`, Lenis smooth
  scrolling on `<main>` (inner scrollers need `data-lenis-prevent`), a global
  press ripple (`lib/press.js`), theme switch as a View Transition circle.
- **React is pinned to `~19.2.0`** because `@react-three/fiber` 9.7 declares
  `react <19.3`. Don't bump React without checking R3F's peer range.
- **3D is never load-bearing.** `components/three/Scene3D.jsx` loads three.js only
  when the scene nears the viewport, pauses rendering off screen, and falls back to
  a 2D chart when WebGL is missing or the scene throws. three.js is a ~1 MB lazy chunk.
- Pages other than the dashboard are `React.lazy`; the main bundle went 733 KB → 540 KB.

### Why PostgreSQL, and why embedded

SQLite locally + Postgres in production meant two dialects and two schema files
that had already drifted. Now it is **PostgreSQL everywhere**:

- Locally: **PGlite** (Postgres 18 compiled to WASM) in a `worker_thread`, data in
  `server/db/pgdata`. No install. A slow query can't block Express; a timeout
  terminates and restarts the worker.
- Hosted: `pg` Pool from `DATABASE_URL`. Same migrations, triggers and SQL.
- `db.transaction()` uses AsyncLocalStorage, so nested calls join the open
  transaction, and it sets `docdesk.actor` for the audit trigger.
- A **lock file** (`pgdata.lock`) stops a second process opening the same data
  folder — two PGlite instances on one folder corrupt it.

Rules moved into the database (migration 004): stock ledger kept by triggers,
payment rows derive a sale's status, deferred constraint trigger checks sale
totals, low-stock alerts raised by trigger, row_version optimistic locking,
reference numbers from sequences, generic JSONB audit trigger (005), reporting
views and set-returning functions bucketed by `business_timezone()` (006).
Money is computed in integer cents in JS so it matches `numeric` rounding.

The old SQLite file was imported once on first start (`db/legacy/importSqlite.js`)
and renamed `*.imported-<stamp>`; part-paid sales with no recorded amount were
kept and flagged (the Health tab lists them as a warning, not an error).

### Database console (Database page)

Overview · Tables · ER diagram · SQL workbench (autocomplete, examples, history,
charts, visual EXPLAIN) · Activity (audit trail) · Performance · Health
(integrity checks + repairs) · Backups (gzip JSON, restore in one transaction
after a safety backup, SQL export).

Safety model — keep it:
- Reads run through a `DECLARE CURSOR` inside a read-only transaction that is
  always rolled back, fetching at most 1,000 rows.
- Anything that writes needs "Allow changes", and the server refuses it unless
  admin is enabled: on for embedded, **off for hosted unless `DB_ADMIN=on`**,
  because a deployed DocDesk has no sign-in yet.
- Dangerous functions (`set_config`, file access…) are refused by the tokenizer
  before anything reaches the database.
- Error positions from PostgreSQL are shifted back past the prefix the server
  adds (`DECLARE … FOR`, `EXPLAIN (…)`), so the console's caret points at the
  right character.

### Gotchas worth remembering

- **Constraint triggers can't be `CREATE OR REPLACE`d** — drop and create.
- A Postgres created with a Windows code page (WIN1252) rejects `₹`
  (`22P05 untranslatable character`). Hosted DBs must be UTF8; the server warns.
- `pg` warns about `SET` in an on-connect hook; use explicit `AT TIME ZONE` instead.
- Binding a `$n` that the SQL doesn't use → `could not determine data type of
  parameter`. Only bind the timezone when a date range is actually present.
- Seed: apply purchase-order receipts **after** all items are inserted, or the
  status trigger marks a partial order received.
- motion can't animate an SVG path's `d` from undefined; use a CSS `transition: d`.
- `Rings` takes `target`, not `goal`.
- Nested `<button>`s (a row that expands containing a Repair/Delete button) —
  make the row a `div role="button"` instead.
- **Don't run `sed -i` or `node -e` with template literals through Git Bash on
  these files**: bash ate `${…}` once, and sed turned `start.ps1` LF (restored to CRLF).
- Browser-pane screenshots taken while the pane is hidden look faded: animations
  are throttled mid-flight. Wait, or re-screenshot, before calling it a bug.

### Verified

- `npx vite build` clean. Every route checked in the browser (desktop dark, phone
  light) with no console errors and no horizontal overflow at 375 px.
- 30 business-rule tests against embedded **and** a real PostgreSQL server; seed
  consistency (ledger, subtotals, paid amounts) zero mismatches on both.
- API smoke test of every endpoint, including the SQL console, EXPLAIN, backups
  and restore.
- Assistant answered "How big is the database?" through the new `database_overview` tool.

### Still open

- **Sign-in.** Needed before a deployment can safely enable `DB_ADMIN`.
- Real message delivery (Resend/Brevo) — `sendQueued()` in `lib/messaging.js`.
- The legacy import left 8 part-paid sales without an amount; record their
  payments from Sales when known.
- The Groq key pasted into chat earlier still needs rotating.

### Added after the first pass (same day)

- **Tests.** `server/tests/rules.test.js`, run with `npm test` (node:test, no new
  dependency). It points `PGDATA_DIR` at `db/test-pgdata`, migrates, and empties
  the tables between tests, so it never touches real data; with `DATABASE_URL`
  set it checks a hosted database instead. 21 checks: constraints, the stock
  ledger, payments-derived status, low-stock alerts, purchase receipts,
  sequences, row_version, the audit trail, views, timezone bucketing, trigram
  search and rollback.
- **Saved queries** live in the database (migration 007) rather than the browser,
  so the console's library is on every machine and inside every backup.
- **Query builder** (client-side) writes SQL from the real schema: joins are
  offered only where a foreign key exists, and picking a total groups the rest.
- **Row inspector**: click a row number in the table browser to see its values,
  what it points at, what points back, and its audit history.
- **Table health** on the Performance tab: index-vs-sequential reads, dead rows,
  and advice, with the thresholds decided on the server (`catalog.tableStats`).
- **`run_query`** gives the assistant one read-only SELECT for questions no other
  tool answers. It never passes allowWrite, so text hidden in a record can at
  most cause a read.
- **Print styles** for the Reports page's Print button (no sidebar, white paper,
  no page breaks through a card).
- `clear()` no longer truncates `settings` - clearing records shouldn't forget
  the shop's name, currency and timezone.

---

## 2026-09-16 — Sign-in and the front door

Sharan handed over a live Firebase web config and asked for authentication
first, then a landing page, explicitly lifting the "no real keys until Phase 6"
rule for this one. Both are done and both are verified against the real project
(`dbms-91b7e`), not a stub.

### Authentication

- `client/src/lib/firebase.js` — one connection. `initializeAuth` rather than
  `getAuth` so persistence order is explicit: IndexedDB first, localStorage
  behind it for private windows. Analytics is loaded lazily behind
  `isSupported()` and every failure is swallowed, so it can never be the reason
  a sign-in fails.
- `client/src/auth/AuthProvider.jsx` — `user`, `ready`, and sign up / sign in /
  Google / sign out / reset. Every Firebase error code is mapped to a sentence a
  non-technical person can act on; an unmapped code gets a sentence too and only
  logs the code in dev. Google uses a popup and falls back to a redirect when
  the browser blocks it, with `getRedirectResult` on mount to catch the return.
- **The config is committed on purpose.** A Firebase web config is public by
  design — it identifies the project, it does not authorise anything. What keeps
  others out is the authorised-domain list. `VITE_FIREBASE_*` still override it
  per environment. This is written down in `REQUIREMENTS.md` so it doesn't get
  "fixed" later by someone assuming it leaked.

### How the app splits in two

`App.jsx` now has a `Gate`. Signed out, `/` is the landing page and every other
address redirects to `/signin` carrying where it was headed; signed in, the
whole product mounts as before. **Settings, the toasts, the assistant, the
spotlight and the shell moved inside the signed-in branch** — a visitor who
never signs in now triggers no API calls at all. `DashboardPage` became lazy and
the landing page took its place as the eager one, since it is what an anonymous
visitor actually lands on.

The account menu in the top bar is now the real user — Google photo where there
is one, initials where there isn't — with Sign out. Signing out drops the
private tree and the landing page takes over; no navigation needed.

### The landing page

Studied awwwards.com's hero directly in the browser (Firecrawl isn't wired into
this session) and took the principles, not the design: one typeface, an extreme
jump in scale between 11px meta labels and ~8rem display type set at a line
height under 1, hairline rules instead of boxes, square media, a strictly
monochrome ground, and a single 0.3s transition on everything that reacts to a
pointer. Those map onto DocDesk's existing tokens almost exactly (#f5f5f7 /
#1d1d1f against their #f8f8f8 / #222), so the page is built from the same
variables and follows light and dark with the rest of the app.

Nine sections, in `client/src/pages/LandingPage.jsx` plus
`client/src/components/landing/`. GSAP + ScrollTrigger for motion, Lenis for the
scroll, `components/three/DeskScene3D.jsx` for the hero object. **No image files
anywhere** — every graphic is geometry, SVG or type.

Everything the page claims is something the product does. The four figures are
counts of the real thing (11 screens, 21 tests, 8 console tabs, 0 spreadsheets):
a product with no users yet has no honest social proof to put up.

### Three lessons worth keeping

- **Never let a ScrollTrigger own a reveal that should stay revealed.**
  `ScrollTrigger.refresh()` — which fires whenever fonts swap, the canvas
  settles or the window resizes — reverts the animation it owns back to its
  start values, and a trigger that is now far above the fold never re-enters to
  replay it, so the text parks below its mask for good. `playWhenVisible()` in
  `lib/gsap.js` builds the timeline paused and creates the trigger separately
  with `once: true`, so a refresh can recalculate all it likes and never touch
  what has already run.
- **Masked text clips its own descenders.** Display type is set below a line
  height of 1, so each character's mask is shorter than the glyph. `splitChars`
  pads the mask and takes the same amount back off as negative margin — without
  it every p, g and y is cut in half.
- The hidden-pane throttling noted in the last entry cost an hour here: GSAP's
  ticker sits at frame 0 while the pane is hidden, so reading transforms over
  the MCP bridge shows every animation frozen at its "from" state. It looks
  exactly like a bug. **Screenshots are the only honest way to check motion.**

### Verified against the real project

- Providers probed over the Identity Toolkit REST API: email/password and Google
  are both enabled, and `localhost`, `dbms-91b7e.firebaseapp.com` and
  `dbms-91b7e.web.app` are the authorised domains.
- Signed up through the UI as **desk.test@docdesk.test** → landed on the
  dashboard with the display name showing in the account menu. Signed out →
  landing page. Asked for `/reports` while signed out → sign-in → landed on
  `/reports`, not the dashboard. Reloaded on `/inventory` → stayed signed in,
  no landing-page flash.
- Google: the button reaches Google's real "to continue to
  dbms-91b7e.firebaseapp.com" screen. **Not carried past that point** — finishing
  it would mean signing in as a real Google account, which is Sharan's to do.
- `npm run build` clean. Landing page checked at 1440 and 375, light and dark,
  with no console errors.

### Still open

- Finish a Google sign-in once by hand, to confirm the round trip end to end.
- Delete the `desk.test@docdesk.test` account from Firebase → Authentication →
  Users when it has served its purpose.
- **Add the deployed domain to the authorised list before shipping** — sign-in
  fails on any domain Firebase doesn't know.
- The app still has one shop's data behind whichever account signs in; accounts
  are not yet scoped to their own records. Fine for one business, and the thing
  to decide before a second one exists.
- Real message delivery, the 8 part-paid legacy sales, and rotating the Groq key
  are all still open from the previous entry.
