# External services DocDesk will need

Nothing in this file is required yet. Everything listed is either stubbed or not
built, and DocDesk runs fully without any of it. Sharan supplies real keys in
Phase 6.

Anything added here must state: what it is for, which free tier we are relying
on, where to get the key, and the exact env var name the code reads.

---

## Not needed yet — Phase 1 uses none of these

### Managed PostgreSQL — for deployment only

**Why:** Local development uses a SQLite file and needs nothing. But most hosts
give a deployed app an ephemeral filesystem, so a SQLite file there would be
wiped on every redeploy. A managed Postgres is only needed once DocDesk is
actually hosted.

**The code is already written for this.** `server/db/index.js` switches driver
on the environment, so deploying means setting a variable, not changing code.

| Option | Free tier | Notes |
|---|---|---|
| [Neon](https://neon.tech) | 0.5 GB storage, scales to zero | Good default. No forced pause. |
| [Supabase](https://supabase.com) | 500 MB, 2 projects | What the original repo assumed. Pauses after ~1 week idle. |
| [Render Postgres](https://render.com) | 1 GB | Free instance is deleted after 90 days. |

```
DATABASE_URL=postgresql://user:password@host:5432/dbname
DATABASE_SSL=off   # optional, only for a local Postgres with no TLS
```

Leave `DATABASE_URL` unset and DocDesk uses SQLite. That is the intended local
setup — do not set it just to have it set.

---

## Stubbed and waiting for a key (built in Phase 2, switched on in Phase 6)

### Outbound messaging (low-stock alerts, order confirmations)

**Why:** The spec calls for automated messages when stock drops below its
reorder level and when orders are confirmed. **This is built and working** — the
triggers fire, and what *would* have been sent is written to the `message_log`
table with status `queued`, visible on the Messages page. The mock sender flips
rows to `sent` and logs the payload. Nothing leaves the machine until a real
provider is configured.

Swapping in a real provider means replacing `sendQueued()` in
`server/lib/messaging.js`. No caller needs to change.

Candidates, to be decided when we get there:

| Service | Free tier | Get the key |
|---|---|---|
| [Resend](https://resend.com) | 3,000 emails/month, 100/day | resend.com → API Keys |
| [Brevo](https://brevo.com) | 300 emails/day | brevo.com → SMTP & API |
| Gmail SMTP | ~500/day | Google Account → App Passwords |

Expected vars when it lands: `MESSAGING_PROVIDER`, `MESSAGING_API_KEY`,
`MESSAGING_FROM`.

WhatsApp is the obvious fit for the target user, but the Cloud API needs a
Business account and a verified number, so it is a Phase 6 conversation rather
than a free-tier drop-in.

---

## Phase 4 will add this — not started

### LLM for natural-language table operations

**Why:** The centrepiece feature — the user types "add a column for expiry date"
or "sort by quantity, lowest first" and it happens. Phase 4 picks a provider,
compares at least two on latency and how reliably they return structured
instructions, and records the comparison in `memory.md`.

| Candidate | Free tier |
|---|---|
| [Groq](https://console.groq.com) | Generous free limits, very fast. Strong default — already used successfully on a prior project. |
| [Hugging Face Inference](https://huggingface.co/settings/tokens) | Rate-limited free tier, slower cold starts. |
| Local small model (Ollama) | No key, no limits, but needs the machine to run it. |

Expected vars: `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`.
Key for the likely default: console.groq.com → API Keys.

Free tiers only. No paid plans at any point.
