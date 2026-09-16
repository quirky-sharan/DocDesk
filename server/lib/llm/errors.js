/**
 * The error taxonomy the whole fallback chain turns on.
 *
 * Every provider's error body maps to exactly one of these classes, and the
 * class alone decides what happens next. Getting this mapping wrong is why
 * naive fallback chains fail: a per-minute limit treated as "out of credits"
 * makes the system give up when it had allowance all along, and "out of
 * credits" reported as a busy signal makes it retry forever against a wall.
 *
 * quota_daily and credits_exhausted are deliberately separate. One resets
 * tonight and needs no action; the other needs the owner to do something. They
 * get different sentences because they are different problems.
 */

const ACTIONS = {
  /** Try the same model once more after a short wait, then move on. */
  RETRY_THEN_REROUTE: 'retry_then_reroute',
  /** Wait for allowance if the wait is short, otherwise use another model. */
  WAIT_OR_REROUTE: 'wait_or_reroute',
  /** This model is done for now. Use another. */
  PARK_MODEL: 'park_model',
  /** Every model behind this key is done. Use another provider. */
  PARK_PROVIDER: 'park_provider',
  /** Shorten the conversation and try once more. */
  COMPRESS_RETRY: 'compress_retry',
  /** Do not ask another model the same thing. Fall to the deterministic path. */
  DETERMINISTIC: 'deterministic',
  /** Our bug. Fail honestly rather than papering over it. */
  FAIL: 'fail',
};

/**
 * `userVisible` marks the classes the owner is told about in plain English.
 * A per-minute limit is normal operation and not worth mentioning; a revoked
 * key is something only they can fix.
 */
const CLASSES = {
  transient: {
    action: ACTIONS.RETRY_THEN_REROUTE,
    userVisible: false,
    sentence: 'The AI service did not answer. Trying another one.',
  },
  rate_limited: {
    action: ACTIONS.WAIT_OR_REROUTE,
    userVisible: false,
    sentence: 'Busy for a moment - this refills every few seconds.',
  },
  quota_daily: {
    action: ACTIONS.PARK_MODEL,
    userVisible: true,
    sentence: "Today's free allowance is used up. It comes back on its own.",
  },
  credits_exhausted: {
    action: ACTIONS.PARK_PROVIDER,
    userVisible: true,
    sentence: 'The free credit on this account has run out.',
  },
  auth: {
    action: ACTIONS.PARK_PROVIDER,
    userVisible: true,
    sentence: 'The API key was refused.',
  },
  model_missing: {
    action: ACTIONS.PARK_MODEL,
    userVisible: false,
    sentence: 'That model has been retired. Looking up what is available now.',
  },
  context_overflow: {
    action: ACTIONS.COMPRESS_RETRY,
    userVisible: false,
    sentence: 'The conversation got too long to send. Shortening it.',
  },
  content_filter: {
    action: ACTIONS.DETERMINISTIC,
    userVisible: false,
    sentence: 'The AI service refused to answer that.',
  },
  bad_request: {
    action: ACTIONS.FAIL,
    userVisible: false,
    sentence: 'DocDesk sent a request the AI service could not read.',
  },
};

class LlmError extends Error {
  /**
   * @param {string} message  what to show a person
   * @param {object} options  errorClass is the only one that matters to routing
   */
  constructor(message, { errorClass = 'transient', status = 502, provider = null, model = null, waitMs = 0, detail = null } = {}) {
    super(message);
    this.name = 'LlmError';
    this.errorClass = CLASSES[errorClass] ? errorClass : 'transient';
    this.action = CLASSES[this.errorClass].action;
    this.userVisible = CLASSES[this.errorClass].userVisible;
    this.status = status;
    this.provider = provider;
    this.model = model;
    this.waitMs = waitMs;
    this.detail = detail;
    // Kept so older callers that switch on `code` still behave. The old names
    // were bad_key / daily_limit / rate_limited / model_missing / not_configured.
    this.code = this.errorClass;
    this.retryable = [ACTIONS.RETRY_THEN_REROUTE, ACTIONS.WAIT_OR_REROUTE].includes(this.action);
  }
}

/**
 * The shared part of mapping an HTTP failure to a class. Adapters call this and
 * then override where their provider is unusual - which is most of the value in
 * writing an adapter at all, because free tiers differ most in how they say no.
 */
function classifyHttp(status, detail = '', headers = null) {
  const text = String(detail || '');

  if (status === 401 || status === 403) {
    // "Quota" inside a 403 is Google saying the project has no allowance left,
    // not that the key is wrong. Telling someone to fix a working key wastes
    // an evening.
    if (/quota|billing|exceed/i.test(text)) return 'quota_daily';
    return 'auth';
  }

  if (status === 402 || /insufficient.*(credit|balance|fund)|out of credit|no credit|payment required|add credits/i.test(text)) {
    return 'credits_exhausted';
  }

  if (status === 429) {
    if (/per[ -]?day|daily|RPD|TPD|quota.*exceeded.*day/i.test(text)) return 'quota_daily';
    if (/credit|balance/i.test(text)) return 'credits_exhausted';
    return 'rate_limited';
  }

  if (/context length|maximum context|too many tokens|reduce the length|input is too long/i.test(text)) {
    return 'context_overflow';
  }

  if (/content (policy|filter)|safety|blocked|refus/i.test(text) && status < 500) {
    return 'content_filter';
  }

  if ((status === 404 || status === 400) && /model.*(not exist|not found|decommission|deprecat|no access|unsupported)/i.test(text)) {
    return 'model_missing';
  }

  if (status >= 500 || status === 408 || status === 0) return 'transient';
  if (status === 400) return 'bad_request';
  return 'transient';
}

/** Milliseconds a provider asked us to wait, from whichever header it used. */
function retryAfterMs(headers) {
  if (!headers) return null;
  const candidates = ['retry-after', 'x-ratelimit-reset-tokens', 'x-ratelimit-reset-requests', 'x-ratelimit-reset'];
  for (const name of candidates) {
    const parsed = parseDuration(headers.get?.(name));
    if (parsed) return parsed;
  }
  return null;
}

/** "2.5", "500ms", "1m30s", "7.66s" - providers use all of these. */
function parseDuration(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.ceil(Number(text) * 1000);
  let ms = 0;
  for (const [, amount, unit] of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    const n = Number(amount);
    ms += unit === 'h' ? n * 3600000 : unit === 'm' ? n * 60000 : unit === 's' ? n * 1000 : n;
  }
  return ms ? Math.ceil(ms) : null;
}

module.exports = { ACTIONS, CLASSES, LlmError, classifyHttp, retryAfterMs, parseDuration };
