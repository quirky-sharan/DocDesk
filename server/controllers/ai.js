const db = require('../db');
const llm = require('../lib/llm');
const { resolveTimezone } = require('../lib/timezone');
const { text, oneOf, fail } = require('../lib/validate');

/**
 * The AI page: which providers are up, what is left of each free allowance,
 * what has been spent, and what changed underneath without anyone asking.
 *
 * This exists because "it stopped working" is the least useful thing a system
 * can say. Every state here comes with a sentence and, where the owner can do
 * something, the exact thing to do.
 */

exports.status = async (req, res, next) => {
  try {
    res.json(await llm.status({ probe: req.query.probe === '1' }));
  } catch (err) {
    next(err);
  }
};

exports.models = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT m.provider_key, m.model, m.tier, m.capabilities, m.context_window, m.is_enabled,
              m.bench_score, m.bench_run_at, m.last_error, m.last_error_at, m.tokenizer_factor,
              p.label AS provider_label, p.status AS provider_status,
              s.passed, s.total, s.percent, s.blocked, s.p50_ms, s.started_at AS bench_at
         FROM ai_models m
         JOIN ai_providers p ON p.key = m.provider_key
         LEFT JOIN v_eval_scoreboard s
           ON s.provider_key = m.provider_key AND s.model = m.model AND s.mode = 'normal'
        WHERE m.capabilities ? 'chat'
        ORDER BY m.provider_key, m.tier NULLS LAST, m.model`
    );
    res.json({ items: rows, tiers: Object.keys(llm.registry.TIERS) });
  } catch (err) {
    next(err);
  }
};

exports.discover = async (req, res, next) => {
  try {
    res.json(await llm.registry.discover({ force: true }));
  } catch (err) {
    next(err);
  }
};

exports.usage = async (req, res, next) => {
  try {
    const timezone = await resolveTimezone(req);
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);

    const [byModel, byDay] = await Promise.all([
      llm.usage.summary({ days }),
      db.query('SELECT * FROM ai_usage_by_day($1, $2, $3)', [from, to, timezone]).then((r) => r.rows),
    ]);

    res.json({ days, byModel, byDay, budgets: llm.budget.snapshot(), timezone });
  } catch (err) {
    next(err);
  }
};

exports.events = async (req, res, next) => {
  try {
    res.json({
      items: await llm.usage.recentEvents({
        limit: Number(req.query.limit) || 30,
        unseenOnly: req.query.unseen === '1',
      }),
    });
  } catch (err) {
    next(err);
  }
};

exports.markEventsSeen = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    res.json({ ok: true, updated: await llm.usage.markEventsSeen(ids) });
  } catch (err) {
    next(err);
  }
};

/**
 * The manual override: pin a model, switch a provider off, or take the language
 * model out of the loop entirely. Someone has to be able to overrule this.
 */
exports.setOverrides = async (req, res, next) => {
  try {
    const body = req.body || {};
    const next_ = {};

    if ('pinned_model' in body) {
      next_.pinnedModel = body.pinned_model ? text(body.pinned_model, 'Model', { max: 120 }) : null;
    }
    if ('disabled_providers' in body) {
      const keys = Array.isArray(body.disabled_providers) ? body.disabled_providers : [];
      next_.disabledProviders = keys.map((key) => text(key, 'Provider', { max: 40 })).filter(Boolean);
    }
    if ('deterministic_only' in body) next_.deterministicOnly = Boolean(body.deterministic_only);
    if ('daily_token_cap' in body) {
      const cap = Number(body.daily_token_cap);
      if (!Number.isFinite(cap) || cap < 0) throw fail('The daily limit must be a number, or 0 for no limit');
      next_.dailyTokenCap = Math.round(cap);
    }

    llm.gateway.setOverrides(next_);
    res.json({ ok: true, overrides: llm.gateway.getOverrides() });
  } catch (err) {
    next(err);
  }
};

/** Turns a provider on or off for good, rather than just for this process. */
exports.setProviderEnabled = async (req, res, next) => {
  try {
    const key = text(req.params.key, 'Provider', { required: true, max: 40 });
    const enabled = Boolean(req.body?.enabled);
    const { rowCount } = await db.query(
      `UPDATE ai_providers SET is_enabled = $2, status = CASE WHEN $2 THEN 'unknown' ELSE 'disabled' END WHERE key = $1`,
      [key, enabled]
    );
    if (!rowCount) throw fail('There is no provider by that name', 404);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

/** The rules-versus-model disagreement rate, which is how prompt drift shows up. */
exports.agreement = async (req, res, next) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
    const { rows } = await db.query(
      `SELECT (created_at AT TIME ZONE business_timezone())::date AS day,
              count(*)::int AS turns,
              count(*) FILTER (WHERE (detail->>'agree') = 'false')::int AS disagreements
         FROM conversation_events
        WHERE kind = 'rules_disagreement'
          AND created_at > now() - make_interval(days => $1)
        GROUP BY 1 ORDER BY 1`,
      [days]
    );
    const totals = rows.reduce((sum, row) => ({ turns: sum.turns + row.turns, disagreements: sum.disagreements + row.disagreements }), { turns: 0, disagreements: 0 });
    res.json({
      days,
      byDay: rows,
      rate: totals.turns ? Number((totals.disagreements / totals.turns).toFixed(3)) : 0,
      // Above this the prompt has probably drifted and is worth looking at.
      threshold: 0.2,
    });
  } catch (err) {
    next(err);
  }
};

exports.scoreboard = async (req, res, next) => {
  try {
    const mode = req.query.mode ? oneOf(req.query.mode, 'Mode', ['normal', 'degraded']) : null;
    const { rows } = await db.query(
      `SELECT * FROM v_eval_scoreboard ${mode ? 'WHERE mode = $1' : ''} ORDER BY percent DESC NULLS LAST`,
      mode ? [mode] : []
    );
    const { rows: runs } = await db.query(
      `SELECT id, provider_key, model, mode, started_at, finished_at, total, passed, failed, blocked, p50_ms, p95_ms
         FROM eval_runs ORDER BY started_at DESC LIMIT 20`
    );
    res.json({ scoreboard: rows, runs });
  } catch (err) {
    next(err);
  }
};
