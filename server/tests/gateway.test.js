// The model gateway: routing, the error taxonomy, budgets and degraded mode.
//
// Every error class is forced against a real HTTP server rather than a mocked
// fetch, so the test exercises the whole path a live failure takes - status
// code, body, headers, adapter mapError, gateway action. A mock would only
// prove the switch statement matches itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

if (!process.env.DATABASE_URL) {
  process.env.PGDATA_DIR = process.env.TEST_PGDATA_DIR || path.join(__dirname, '..', 'db', 'test-pgdata-gateway');
  fs.rmSync(process.env.PGDATA_DIR, { recursive: true, force: true });
  fs.rmSync(`${process.env.PGDATA_DIR}.lock`, { force: true });
}

const db = require('../db');
const { migrate } = require('../db/migrate');
const llm = require('../lib/llm');
const { LlmError, classifyHttp } = require('../lib/llm/errors');

// A stand-in provider. `next` decides what the next chat request gets back, so
// a test can make it fail in one specific way.
let stub = { next: null, requests: 0 };
let server = null;
let baseUrl = '';

function startStub() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const send = (status, body, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
        res.end(JSON.stringify(body));
      };

      if (req.url.startsWith('/v1/models')) {
        return send(200, {
          data: [
            { id: 'stub-large-70b', context_window: 32000 },
            { id: 'stub-small-8b', context_window: 8000 },
          ],
        });
      }

      if (req.url.startsWith('/v1/chat/completions')) {
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
          // A real provider names the model you asked for, so the stub does too
          // - otherwise a test can assert against a model that was never
          // actually routed to.
          let model = 'unknown';
          try { model = JSON.parse(raw).model || 'unknown'; } catch { /* leave it */ }
          stub.requests += 1;
          stub.lastModel = model;
          if (stub.requests === 1) stub.firstModel = model;

          const planned = stub.next;
          if (planned) {
            if (planned.once) stub.next = null;
            const shaped = typeof planned.body === 'function' ? planned.body(model) : planned.body;
            return send(planned.status, shaped, planned.headers || {});
          }
          return send(200, {
            choices: [{ message: { role: 'assistant', content: 'stub answer' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }, {
            'x-ratelimit-limit-tokens': '8000',
            'x-ratelimit-remaining-tokens': '7000',
          });
        });
        return undefined;
      }
      return send(404, { error: { message: 'no route' } });
    });
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
      resolve();
    });
  });
}

/** Only the stub provider is configured, so routing has one place to go. */
function onlyStub() {
  for (const key of ['GROQ_API_KEY', 'GOOGLE_API_KEY', 'OPENROUTER_API_KEY', 'MISTRAL_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    delete process.env[key];
  }
  process.env.LLM_BASE_URL = baseUrl;
  process.env.OLLAMA_URL = 'http://127.0.0.1:1';
}

const ask = (options = {}) =>
  llm.chat({ messages: [{ role: 'user', content: 'hello' }], purpose: 'test', maxWaitMs: 1500, ...options });

/** Runs `fn` and returns the LlmError it threw. */
async function failure(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  assert.fail('expected that to fail');
}

const modelRow = (model) =>
  db.query('SELECT is_enabled, last_error FROM ai_models WHERE provider_key = $1 AND model = $2', ['custom', model])
    .then((r) => r.rows[0]);

const providerRow = () =>
  db.query("SELECT status, status_reason FROM ai_providers WHERE key = 'custom'").then((r) => r.rows[0]);

test.before(async () => {
  await startStub();
  onlyStub();
  await db.ready;
  await migrate();
});

test.after(async () => {
  server?.close();
  await db.close();
});

test.beforeEach(async () => {
  stub = { next: null, requests: 0, firstModel: null, lastModel: null };
  onlyStub();
  llm.budget.reset();
  llm.gateway.setOverrides({ pinnedModel: null, disabledProviders: [], deterministicOnly: false, dailyTokenCap: 0 });
  await db.query('TRUNCATE ai_usage, ai_events, ai_budget_windows, ai_models, ai_providers RESTART IDENTITY CASCADE');
  await llm.registry.discover({ force: true });
});

// --- the taxonomy itself, before anything routes on it ----------------------

test('every provider dialect maps to exactly one error class', () => {
  const cases = [
    [401, 'Invalid API key', 'auth'],
    [403, 'Method does not allow unregistered callers', 'auth'],
    [403, 'Quota exceeded for this project', 'quota_daily'],
    [402, 'Payment required', 'credits_exhausted'],
    [429, 'Rate limit reached for tokens per day (TPD)', 'quota_daily'],
    [429, 'Rate limit reached, please retry in 7.66s', 'rate_limited'],
    [429, 'Insufficient credits, add credits to continue', 'credits_exhausted'],
    [400, "The model 'llama-3.3-70b-versatile' does not exist", 'model_missing'],
    [404, 'model not found', 'model_missing'],
    [400, 'maximum context length is 8192 tokens', 'context_overflow'],
    [400, 'Request blocked by content policy', 'content_filter'],
    [400, 'messages: expected array', 'bad_request'],
    [500, 'internal server error', 'transient'],
    [503, 'upstream unavailable', 'transient'],
  ];
  for (const [status, detail, expected] of cases) {
    assert.equal(classifyHttp(status, detail), expected, `${status} "${detail}" should be ${expected}`);
  }
});

test('a daily cap and a per-minute limit are never confused', () => {
  // Both arrive as 429. Treating the per-minute one as exhausted makes the
  // system give up when it had allowance; treating the daily one as busy makes
  // it hammer a wall. This is the single most annoying bug in this class of
  // system, in both directions.
  assert.equal(classifyHttp(429, 'Rate limit reached for requests per day'), 'quota_daily');
  assert.equal(classifyHttp(429, 'Rate limit reached for requests per minute'), 'rate_limited');
});

// --- routing ----------------------------------------------------------------

test('a plain request is answered, recorded and budgeted', async () => {
  const result = await ask();
  assert.equal(result.message.content, 'stub answer');
  assert.equal(result.provider, 'custom');

  const { rows } = await db.query("SELECT outcome, tokens_in, tokens_out FROM ai_usage WHERE purpose = 'test'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'ok');
  assert.equal(rows[0].tokens_in, 10);

  const budgets = llm.budget.snapshot('custom');
  const tpm = budgets.find((b) => b.kind === 'tpm');
  assert.ok(tpm, 'the token allowance reported in the headers should be tracked');
  assert.equal(tpm.limit, 8000);
  assert.equal(tpm.refillMode, 'continuous', 'a per-minute allowance refills continuously');
});

test('a retired model is disabled and the request re-routed in the same turn', async () => {
  stub.next = {
    status: 400,
    body: (model) => ({ error: { message: `The model '${model}' does not exist` } }),
    once: true,
  };

  const result = await ask();
  const retired = stub.firstModel;
  assert.equal(result.message.content, 'stub answer', 'the caller still gets an answer');
  assert.ok(stub.requests >= 2, 'it tried another model rather than giving up');
  assert.notEqual(result.model, retired, 'it answered on a different model');

  const row = await modelRow(retired);
  assert.equal(row.is_enabled, false, 'the retired model is taken out of the pool');

  const { rows } = await db.query("SELECT kind, message FROM ai_events WHERE kind = 'model_retired'");
  assert.equal(rows.length, 1);
  assert.match(rows[0].message, /nothing needs doing/i, 'the owner is told, in a sentence, that they need do nothing');
});

test('a per-minute limit parks the model briefly and moves on, never "exhausted"', async () => {
  stub.next = {
    status: 429,
    body: { error: { message: 'Rate limit reached for requests per minute, please retry in 2s' } },
    headers: { 'retry-after': '2' },
    once: true,
  };

  const result = await ask();
  assert.equal(result.message.content, 'stub answer');

  const provider = await providerRow();
  assert.notEqual(provider.status, 'credits_exhausted', 'busy is not the same as out of credit');
  assert.notEqual(provider.status, 'quota_daily');

  const { rows } = await db.query("SELECT kind FROM ai_events WHERE kind IN ('credits_exhausted', 'quota_daily')");
  assert.equal(rows.length, 0, 'a per-minute limit is normal operation and not worth telling anyone about');
});

test('a daily cap parks that model until its reset and says so in plain English', async () => {
  stub.next = { status: 429, body: { error: { message: 'Rate limit reached for tokens per day (TPD)' } } };

  const error = await failure(() => ask());
  assert.equal(error.errorClass, 'quota_daily');

  const { rows } = await db.query("SELECT message FROM ai_events WHERE kind = 'quota_daily'");
  assert.equal(rows.length, 1);
  assert.match(rows[0].message, /comes back on its own/i);
  assert.doesNotMatch(rows[0].message, /credit/i, 'a daily allowance is not a credit problem');
});

test('spent credit parks the whole provider and names what to do', async () => {
  stub.next = { status: 402, body: { error: { message: 'Insufficient credits' } } };

  const error = await failure(() => ask());
  assert.equal(error.errorClass, 'credits_exhausted');

  const provider = await providerRow();
  assert.equal(provider.status, 'credits_exhausted');

  const { rows } = await db.query("SELECT message FROM ai_events WHERE kind = 'credits_exhausted'");
  assert.match(rows[0].message, /run out/i);
});

test('a refused key parks the provider and says which key, in which file', async () => {
  stub.next = { status: 401, body: { error: { message: 'Invalid API key' } } };

  const error = await failure(() => ask());
  assert.equal(error.errorClass, 'auth');

  assert.equal((await providerRow()).status, 'auth');
  const { rows } = await db.query("SELECT message FROM ai_events WHERE kind = 'auth_failed'");
  assert.match(rows[0].message, /server\/\.env/, 'the owner is told exactly where to fix it');
});

test('a request that was too long is shortened and sent again', async () => {
  const long = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i}` }));
  stub.next = { status: 400, body: { error: { message: 'maximum context length is 8192 tokens' } }, once: true };

  const result = await llm.chat({ messages: long, purpose: 'test', maxWaitMs: 1500 });
  assert.equal(result.message.content, 'stub answer');
  assert.ok(stub.requests >= 2, 'it retried rather than failing the turn');
});

test('a refusal is not asked again elsewhere', async () => {
  stub.next = { status: 400, body: { error: { message: 'Request blocked by content policy' } } };

  const error = await failure(() => ask());
  assert.equal(error.errorClass, 'content_filter');
  assert.equal(stub.requests, 1, 'asking a second model the same refused question is pointless');
});

test('our own bad request fails honestly instead of being retried', async () => {
  stub.next = { status: 400, body: { error: { message: 'messages: expected an array' } } };

  const error = await failure(() => ask());
  assert.equal(error.errorClass, 'bad_request');
  assert.equal(stub.requests, 1);
});

// --- overrides and the floor ------------------------------------------------

test('pinning a model routes everything to it', async () => {
  llm.gateway.setOverrides({ pinnedModel: 'stub-small-8b' });
  const result = await ask();
  assert.equal(result.model, 'stub-small-8b');
});

test('the daily token cap is enforced before anything is sent', async () => {
  await db.query(
    `INSERT INTO ai_usage (purpose, provider_key, model, tokens_in, tokens_out) VALUES ('test', 'custom', 'stub-small-8b', 5000, 5000)`
  );
  llm.gateway.setOverrides({ dailyTokenCap: 1000 });

  const before = stub.requests;
  const error = await failure(() => ask());
  assert.equal(error.errorClass, 'quota_daily');
  assert.equal(stub.requests, before, 'nothing was sent - the cap is checked before routing, not after');

  const { rows } = await db.query("SELECT message FROM ai_events WHERE kind = 'budget_capped'");
  assert.match(rows[0].message, /daily AI limit/i);
});

test('forcing the deterministic engine sends nothing at all', async () => {
  llm.gateway.setOverrides({ deterministicOnly: true });
  const before = stub.requests;
  const error = await failure(() => ask());
  assert.equal(stub.requests, before);
  assert.ok(error instanceof LlmError);
});

test('with no keys at all it fails in a way the caller can fall back from', async () => {
  delete process.env.LLM_BASE_URL;
  process.env.OLLAMA_URL = 'http://127.0.0.1:1';

  assert.equal(llm.isConfigured(), false);

  const error = await failure(() => ask());
  assert.equal(error.errorClass, 'auth');
  assert.match(error.message, /GROQ_API_KEY/, 'it says how to fix it rather than just failing');

  const state = await llm.status();
  assert.equal(state.deterministicOnly, true, 'the app knows to use its own rules');
  assert.equal(state.configured, false);

  const notSetUp = state.providers.find((p) => p.key === 'groq');
  assert.equal(notSetUp.status, 'not_configured');
  assert.match(notSetUp.action, /GROQ_API_KEY/);
});

test('the status page has a sentence and a next step for every state', async () => {
  const state = await llm.status();
  for (const provider of state.providers) {
    assert.ok(provider.summary, `${provider.key} has no summary`);
    if (provider.status !== 'ready') {
      assert.ok(provider.action, `${provider.key} is ${provider.status} and offers no next step`);
    }
  }
});
