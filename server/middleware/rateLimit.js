const { createLimiter } = require('../lib/rateLimit');
const { isInternalToken } = require('../lib/auth/context');

/**
 * Four limits, from widest to narrowest. A request has to fit inside every one
 * that applies to it.
 *
 *   address   everything from one IP address, signed in or not. A ceiling on
 *             what any single source can ask of the server.
 *   signIn    attempts to start a session, per address. Kept low: each one
 *             costs a signature check, and it is where guessing would happen.
 *   person    everything one signed-in person does.
 *   changes   their writes - creating, editing, deleting.
 *   heavy     the expensive things: SQL from the console, exports, backups,
 *             imports and anything that reaches an AI provider.
 *
 * The capacity is the burst allowed at once; perMinute is the sustained rate.
 */
const limiters = {
  address: createLimiter({ name: 'address', capacity: 600, perMinute: 1200 }),
  signIn: createLimiter({ name: 'signIn', capacity: 10, perMinute: 10 }),
  person: createLimiter({ name: 'person', capacity: 300, perMinute: 300 }),
  changes: createLimiter({ name: 'changes', capacity: 60, perMinute: 120 }),
  heavy: createLimiter({ name: 'heavy', capacity: 20, perMinute: 30 }),
};

const switchedOff = () => process.env.RATE_LIMIT === 'off';

function tooMany(res, result) {
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  res.set('Retry-After', String(seconds));
  res.status(429).json({
    error: `That is a lot of requests at once. Give it ${seconds} second${seconds === 1 ? '' : 's'} and try again.`,
    code: 'rate_limited',
    retryAfter: seconds,
  });
}

function limit(limiter, keyOf, { only = () => true } = {}) {
  return (req, res, next) => {
    // The receptionist's own calls are the server talking to itself on a
    // person's behalf; that person's message was already counted.
    if (switchedOff() || req.internal || !only(req)) return next();
    const result = limiter.take(keyOf(req));
    res.set('RateLimit-Limit', String(result.limit));
    res.set('RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) return tooMany(res, result);
    return next();
  };
}

const byAddress = (req) => req.ip || req.socket.remoteAddress || 'unknown';
const byPerson = (req) => (req.user ? `user:${req.user.id}` : byAddress(req));

module.exports = {
  limiters,
  // Runs before sign-in is checked, so it recognises DocDesk's own calls itself.
  perAddress: limit(limiters.address, byAddress, { only: (req) => !isInternalToken(req.get('x-docdesk-internal')) }),
  signInAttempts: limit(limiters.signIn, byAddress),
  perPerson: limit(limiters.person, byPerson),
  changes: limit(limiters.changes, byPerson, { only: (req) => !['GET', 'HEAD', 'OPTIONS'].includes(req.method) }),
  heavy: limit(limiters.heavy, byPerson),
  stats: () => Object.values(limiters).map((limiter) => limiter.snapshot()),
};
