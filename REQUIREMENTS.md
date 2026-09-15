# Keys and services

DocDesk runs with **none of this**. Everything here is optional and adds a
feature that is otherwise stubbed or limited.

**Where keys go:** `server/.env`. Copy the template and fill in what you want:

```bash
cp server/.env.example server/.env
```

`.env` is gitignored at every level — it will never be committed. The
`.env.example` templates are committed, and contain no real values.

Restart the server after editing it.

---

## 1. AI assistant — worth doing now

**What it unlocks:** the assistant on every page (**Ask DocDesk**, or
**Ctrl+J**). It can look things up, sort and filter your lists, record sales,
add, change or delete records, order and receive stock, run reports, back up
the database and export files. Every change waits for you to click Confirm.

**Without a key** the rest of DocDesk works normally and the assistant says it
isn't connected.

### Get a Groq key — 2 minutes, free, no card

1. Go to **https://console.groq.com/keys**
2. Sign in with Google or GitHub
3. Click **Create API Key**, name it anything, and copy it
   *(you only see it once — copy it now)*
4. Put this line in `server/.env`:

```
GROQ_API_KEY=gsk_paste_your_key_here
```

5. Run `stop_all.bat`, then `start_all.bat`. The launcher prints
   **"AI assistant connected"** when it's working.

> **If you ever paste your key into a chat, email or screenshot, rotate it:** go
> to console.groq.com/keys, delete that key, create a new one, and put the new one
> in `server/.env`.

**Check it worked:**

```bash
cd server && npm run bench:ai
```

That runs 12 real requests through the model and scores them, including two it
is *supposed* to refuse. You'll see accuracy and latency.

### Why Groq

| | Free tier | Notes |
|---|---|---|
| **Groq** ← recommended | No card. Per model: **8,000 tokens/minute and 1,000 requests/day** (measured from this key's rate-limit headers, Sept 2026). | Fastest option — typically under a second per step. DocDesk uses three Groq models (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`), each with its own allowance, so together they give roughly 24,000 tokens/minute. |
| OpenRouter | Varies by model; the `:free` models are genuinely free but rate-limited and sometimes queue. | Useful if you want to try several models without several accounts. Set `OPENROUTER_API_KEY`. |
| Together | $1 free credit, plus some models marked Free. | Fine, but the free allowance is small enough to run out. Set `TOGETHER_API_KEY`. |
| Local (Ollama) | Unlimited, no key, fully private. | Needs a reasonably powerful machine and is much slower. Set `LLM_PROVIDER=custom` and `LLM_BASE_URL=http://localhost:11434/v1`. |

Set **one** key. DocDesk picks the provider from whichever key is present — you
don't need to configure anything else.

To override the automatic choice:

```
LLM_PROVIDER=groq
LLM_MODEL=openai/gpt-oss-120b
```

**You shouldn't need `LLM_MODEL`.** DocDesk asks Groq which models your key can
use and picks from its list automatically — so when Groq retires a model (as it
did with `llama-3.3-70b-versatile`), the app moves to the next one instead of
breaking.

### What "busy" means

One assistant answer costs about 2,000–3,000 tokens per step, and a question that
needs a lookup takes two steps. At a normal typing pace that's comfortably within
the free allowance. If you fire off several requests in a few seconds, the
assistant shows *"Waiting for the free AI allowance…"* and carries on once
there's room — usually within 10–20 seconds. It only gives up if every model is
busy for longer than that, and then it says so.

**No paid tiers anywhere.** If you ever see a bill from this, something is
wrong — tell me.

---

## 2. Messaging — Phase 6

**What's built:** the trigger logic. Stock falling to its reorder level, or a
sale to a customer with contact details, queues a message. You can see exactly
what would be sent on the Messages page.

**What's missing:** actually sending it. That needs an email account.

| Service | Free tier | Get the key |
|---|---|---|
| [Resend](https://resend.com) | 3,000 emails/month, 100/day | resend.com → API Keys |
| [Brevo](https://brevo.com) | 300 emails/day | brevo.com → SMTP & API |
| Gmail SMTP | ~500/day | Google Account → Security → App Passwords |

Expected variables when it lands: `MESSAGING_PROVIDER`, `MESSAGING_API_KEY`,
`MESSAGING_FROM`.

Swapping in a real provider means replacing `sendQueued()` in
`server/lib/messaging.js`. Nothing else has to change.

WhatsApp would suit this user better than email, but the Cloud API needs a
Business account and a verified number, so it's a conversation rather than a
drop-in.

---

## 3. Database — only when deploying

Locally DocDesk runs **PostgreSQL 18 embedded** (PGlite) with its data in
`server/db/pgdata/`, and needs nothing installed. But most hosts wipe the
filesystem on redeploy, so a deployed copy needs a hosted PostgreSQL.

**Nothing in the code changes** — the same migrations, triggers and queries run
on both. Set one variable:

```
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

On first start DocDesk creates every table, trigger, view and function itself.

| Option | Free tier | Notes |
|---|---|---|
| [Neon](https://neon.tech) | 0.5 GB, scales to zero | Good default. Doesn't force-pause. |
| [Supabase](https://supabase.com) | 500 MB, 2 projects | Pauses after ~1 week idle. Use the pooled connection string. |
| [Render Postgres](https://render.com) | 1 GB | Free instance deleted after 90 days. |

**Requirements for the hosted database**

- **PostgreSQL 14 or newer.** Tested against PostgreSQL 18 locally and a real server.
- **UTF8 encoding.** Every provider above defaults to it. A database created with a Windows
  code page (WIN1252) can't store `₹`; the server prints a warning at start if it sees one.
- **`pg_trgm`** is used for typo-tolerant search when the provider allows it (all three do);
  without it search falls back to plain "contains" matching.

**Moving your local data up:** on the Database page, **Backups → Back up now**, download
the file, start the deployed copy, and **Restore from a file** there (with `DB_ADMIN=on`
set for that one step).

> **A deployed DocDesk has no sign-in yet.** That's why the SQL console's
> "Allow changes", restore and maintenance are **off** on a hosted database
> unless you set `DB_ADMIN=on`. Reading, backups and exports stay available.

---

## Everything else

| Variable | Default | What it does |
|---|---|---|
| `PORT` | 5000 | API port |
| `DATABASE_URL` | unset | Use a hosted PostgreSQL instead of the embedded one |
| `DATABASE_SSL` | on | Set to `off` for a local PostgreSQL server with no TLS |
| `DB_POOL_MAX` | 10 | Connections kept open to a hosted database |
| `PGDATA_DIR` | `server/db/pgdata` | Where the embedded database keeps its files |
| `DB_ADMIN` | on (embedded), off (hosted) | Allow changes from the SQL console, restores, maintenance and "clear all records" |
| `SQL_CONSOLE_TIMEOUT_MS` | 15000 | Longest a console query may run before it is stopped |
| `AUTO_BACKUP` | on (embedded), off (hosted) | Daily automatic backup; the last 14 are kept |
| `BACKUP_DIR` | `server/backups` | Where backups are written |
| `MAX_UPLOAD_MB` | 25 | Largest file the Files page accepts |
| `UPLOAD_DIR` | `server/uploads` | Where uploaded files are stored |
| `CORS_ORIGIN` | any | Restrict which site may call the API. Set this when deploying. |
| `SQLITE_PATH` | `server/db/docdesk.sqlite` | Only read once: an old SQLite file found here is imported into PostgreSQL on first start, then renamed |
