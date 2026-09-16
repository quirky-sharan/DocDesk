# Receptionist AI — what needs a human

Everything in this file is something **Sharan** has to do, decide, or sign up
for. DocDesk works without all of it; each entry says what you get by doing it
and what happens if you don't.

Nothing here costs money. Where a paid option would be better, it is written
down as an optional upgrade rather than assumed.

---

## Already done

- **Groq key.** Already in `server/.env`. This is what Receptionist AI uses
  today, and on its own it is enough.
- **Opening hours, services, people.** Set up for the test clinic (Rao Clinic).
  Replace them with yours from **Settings → Region**, **Appointments** and the
  service list.

---

## 1. Worth doing soon

### A second AI provider

**Why.** Groq's free tier is 8,000 tokens a minute and 1,000 requests a day
*per model*, measured from its own response headers. Three models are pooled, so
in practice you get about 24,000 tokens a minute — but a busy afternoon can
still use the day's requests. With a second provider, the receptionist moves
across without noticing. With only one, it drops to answering from your records
(hours, services, what is booked) and takes a message for the rest.

**Google AI Studio** is the best free option and needs no card.

1. Go to <https://aistudio.google.com/apikey>
2. Sign in with a Google account, **Create API key**
3. Put it in `server/.env` as `GOOGLE_API_KEY=...`
4. Restart DocDesk, then **AI & models → Check now**

> **Not yet verified against a live key.** The Google adapter is written and
> wired — discovery uses Google's own `/models`, chat uses its
> OpenAI-compatible endpoint — but there is no Google key in this project, so it
> has never actually run. If it misbehaves, that is the first place to look.
> Groq, by contrast, is verified end to end.

**Others, all free, all optional:** `OPENROUTER_API_KEY`
(<https://openrouter.ai/keys> — its free model list changes constantly, which is
why nothing hardcodes a name from it), `MISTRAL_API_KEY`
(<https://console.mistral.ai/api-keys>), `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID`.

### Decide what "free" costs you

Free tiers generally mean **the provider may use what you send to improve their
models**. For a shop, what gets sent is customer names, what they asked for, and
when they are coming in.

If that is not acceptable:

- Install **Ollama** (<https://ollama.com/download>) on the shop computer and
  pull a small model. DocDesk finds it at `localhost:11434` on its own, with no
  key and no account, and nothing leaves the machine. It is slower.
- Or switch **Settings → Receptionist AI → How it works** to **Off**. Hours,
  services, the day's diary and bookings all still work; they are database
  questions, not AI ones.

### Your own emergency wording

**Settings → Receptionist AI → Emergency phrases** and **What to say in an
emergency**.

The built-in list is medical and blunt — chest pain, not breathing, bleeding,
collapsed, overdose, self-harm — and the built-in reply tells people to call
**108**. If DocDesk is running a shop rather than a clinic, replace both: a
hardware shop's emergency is a gas leak, and the right number is not 108.

This path is matched before anything is sent anywhere, so it works when the
internet is down. Nothing about it is generated.

---

## 2. Decisions only you can make

These are set in **Settings → Receptionist AI**. The defaults are safe.

| Setting | Default | Worth thinking about |
|---|---|---|
| How it works | **Suggest** | Suggest drafts and waits for you. Run it there for a week before Live. |
| What it calls itself | Receptionist AI | A clinic might prefer "Priya at Dr Rao's". |
| Daily AI limit | 0 (no limit) | A cap in tokens. When it is hit, the receptionist drops to your records and keeps working. |
| Keep conversations for | 365 days | How long transcripts are kept. |
| Always fetch a person for | — | Anything you never want answered automatically. |

Still to decide, and nobody can decide them for you:

- **How far ahead people may book.** Not enforced yet; say what you want.
- **Whether a booking needs your approval.** Currently auto-confirmed, which is
  what you asked for. It is one setting away from needing approval.
- **Cancellation window.** Not enforced yet.

---

## 3. Known limits

**No public surface.** You asked for owner-facing only, so there is no customer
widget, no Telegram, no WhatsApp and no public booking link. The trust boundary
that would make those safe is built — the front desk has its own tool registry
and cannot reach SQL, cost prices, stock counts, settings or backups — so
adding a channel later is work, but it is not a rewrite.

**No voice yet.** Planned as browser speech in and out. Not built.

**No reminders yet.** Appointments do not send a reminder the day before.
`sendQueued()` in `lib/messaging.js` is still the mock sender — nothing actually
leaves the machine. Real delivery needs a Resend or Brevo free-tier key and is
still open from Phase 6.

**Semantic search is off.** Knowledge search uses full text and trigram
matching, which is genuinely enough for a knowledge base of this size. Turning
on embeddings means `npm install @huggingface/transformers` in `server/` — about
150 MB of native binaries plus a model download — for a modest ranking
improvement. It is wired to switch on by itself the moment that package exists.

**pgvector is not available** in the embedded database (checked: PGlite 0.5.8 is
the latest and has no vector extension). A hosted PostgreSQL has it, and the
knowledge tables are written so it can be used later without changing anything
else.

---

## 4. Housekeeping

- **Rotate the Groq key.** Still open from Phase 5 — it was pasted into a chat.
- **Delete the test accounts** from Firebase → Authentication → Users when they
  have served their purpose: `desk.test@docdesk.test` (Phase 6) and
  `phase7.test@docdesk.test` (Phase 7, password `DocDeskPhase7!`).
- **Never stop DocDesk with Task Manager or `taskkill /F`.** Use `stop_all.bat`,
  which asks it to close the database first. Force-killing it mid-write left a
  data directory that would not reopen at all, and the only way back was the
  nightly backup. That is how it is meant to be stopped and it is worth the
  extra two seconds.

---

## 5. If something looks wrong

**Open AI & models.** Every provider says what state it is in and what to do
about it. "Daily free allowance used, back around 05:30" needs nothing from you.
"Key refused" names the exact variable and file.

**Knowledge → Asked, and nobody could answer.** Every question the receptionist
could not answer is listed there. Each one is a couple of sentences away from
being answered for good.

**AI & models → Usage → Rules against model.** DocDesk works out what you meant
twice, once with plain rules and once with the model. If they start disagreeing
more than usual, the wording the model works from probably needs a look — and
you find out from that number rather than from a customer.

**The power button in the top bar** stops it from anywhere, instantly.
