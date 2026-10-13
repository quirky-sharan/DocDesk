const accounts = require('../lib/auth/accounts');
const { verifyIdToken } = require('../lib/auth/firebaseToken');
const { authRequired } = require('../lib/net');
const { fail } = require('../lib/validate');
const { COOKIE, LOCAL_OWNER, readCookie, cookieOptions } = require('../middleware/authenticate');

/**
 * Signing in, and who is on the team.
 *
 * The browser proves who it is to Firebase and is handed a short-lived token.
 * It gives that token to POST /api/auth/session exactly once. From then on the
 * browser holds nothing but an HttpOnly cookie it cannot read: no token sits
 * in localStorage or anywhere else a script could reach.
 */

const wrap = (handler) => async (req, res, next) => {
  try {
    await handler(req, res);
  } catch (err) {
    next(err);
  }
};

// Sign-in is switched off on this (local-only) installation: everyone is the owner.
const openDoor = { user: LOCAL_OWNER, csrfToken: null, signInRequired: false };

/** Who this browser is signed in as. Never an error: "nobody" is an answer. */
exports.session = wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!authRequired()) return res.json(openDoor);

  const token = readCookie(req);
  const session = token ? await accounts.findSession(token) : null;
  if (!session) return res.json({ user: null, signInRequired: true });
  return res.json({ user: session.user, csrfToken: session.csrfToken, signInRequired: true });
});

/** Trades a Firebase ID token for a session cookie. */
exports.signIn = wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!authRequired()) return res.json(openDoor);

  const identity = await verifyIdToken(req.body?.idToken);
  const user = await accounts.recordSignIn(identity);
  if (user.status === 'disabled') {
    const err = fail('This account has been turned off. Ask the owner to switch it back on.', 403);
    err.kind = 'disabled';
    throw err;
  }

  // A fresh session every time, and the one this browser had before is ended:
  // a session id that was known before signing in is never the one in use after.
  await accounts.destroySession(readCookie(req));
  const session = await accounts.createSession(user.id);
  res.cookie(COOKIE, session.token, { ...cookieOptions(req), maxAge: session.maxAgeMs });
  return res.status(201).json({ user, csrfToken: session.csrfToken, signInRequired: true });
});

exports.signOut = wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  await accounts.destroySession(req.sessionToken);
  res.clearCookie(COOKIE, cookieOptions(req));
  res.json({ ok: true });
});

// --- the team ----------------------------------------------------------------

exports.team = wrap(async (req, res) => {
  res.json({ items: await accounts.listUsers(), you: req.user.id, signInRequired: authRequired() });
});

exports.updateMember = wrap(async (req, res) => {
  res.json(await accounts.updateUser(req.params.id, req.body || {}, req.user));
});

exports.removeMember = wrap(async (req, res) => {
  await accounts.removeUser(req.params.id, req.user);
  res.json({ ok: true });
});

/** Signs somebody out of every browser, without changing what they may do. */
exports.signOutMember = wrap(async (req, res) => {
  await accounts.destroyUserSessions(req.params.id);
  res.json({ ok: true });
});
