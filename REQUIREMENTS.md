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

**What it unlocks:** the "Ask in plain English" box on Inventory, Sales,
Customers and Suppliers. Type *"show me everything from Northwind that's running
low"* or *"set the category to Misc for anything with no category"* and it works
out what you meant, shows you what it will do, and waits for you to confirm.

**Without a key it still works, but only for simple phrasings** — "sort by
price, cheapest first", "add a column for expiry date". Anything more and it
tells you plainly that it can't.

### Get a Groq key — 2 minutes, free, no card

1. Go to **https://console.groq.com/keys**
2. Sign in with Google or GitHub
3. Click **Create API Key**, name it anything, and copy it
   *(you only see it once — copy it now)*
4. Put this line in `server/.env`:

```
GROQ_API_KEY=gsk_paste_your_key_here
```

5. Restart the server. The Inventory page should stop saying "Simple requests
   only".

**Check it worked:**

```bash
cd server && npm run bench:ai
```

That runs 12 real requests through the model and scores them, including two it
is *supposed* to refuse. You'll see accuracy and latency.

### Why Groq

| | Free tier | Notes |
|---|---|---|
| **Groq** ← recommended | ~14,400 requests/day, 30/min on `llama-3.3-70b-versatile`. No card. | By far the fastest — usually well under a second. Supports JSON mode, which removes a whole class of "here is your JSON:" parsing failures. |
| OpenRouter | Varies by model; the `:free` models are genuinely free but rate-limited and sometimes queue. | Useful if you want to try several models without several accounts. Set `OPENROUTER_API_KEY`. |
| Together | $1 free credit, plus some models marked Free. | Fine, but the free allowance is small enough to run out. Set `TOGETHER_API_KEY`. |
| Local (Ollama) | Unlimited, no key, fully private. | Needs a reasonably powerful machine and is much slower. Set `LLM_PROVIDER=custom` and `LLM_BASE_URL=http://localhost:11434/v1`. |

Set **one** key. DocDesk picks the provider from whichever key is present — you
don't need to configure anything else.

To override the automatic choice:

```
LLM_PROVIDER=groq
LLM_MODEL=llama-3.3-70b-versatile
```

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

Locally DocDesk keeps everything in `server/db/docdesk.sqlite` and needs
nothing. But most hosts wipe the filesystem on redeploy, so a deployed copy
needs a real database.

**The code is already written for this** — `server/db/index.js` picks its driver
from the environment, so deploying is a variable, not a rewrite.

| Option | Free tier | Notes |
|---|---|---|
| [Neon](https://neon.tech) | 0.5 GB, scales to zero | Good default. Doesn't force-pause. |
| [Supabase](https://supabase.com) | 500 MB, 2 projects | Pauses after ~1 week idle. |
| [Render Postgres](https://render.com) | 1 GB | Free instance deleted after 90 days. |

```
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

Leave it **unset** for normal use. Setting it without a real database behind it
stops the server starting.

> Not yet tested against a real Postgres — the driver is written and the SQL is
> portable, but it has only ever run on SQLite. Worth an hour before you deploy.

---

## Everything else

| Variable | Default | What it does |
|---|---|---|
| `PORT` | 5000 | API port |
| `SQLITE_PATH` | `server/db/docdesk.sqlite` | Where the local database file lives |
| `MAX_UPLOAD_MB` | 25 | Largest file the Files page accepts |
| `CORS_ORIGIN` | any | Restrict which site may call the API. Set this when deploying. |
| `DATABASE_SSL` | on | Set to `off` for a local Postgres with no TLS |
