const crypto = require('crypto');
const brand = require('../../shared/brand.json');
const db = require('../db');
const accounts = require('../lib/auth/accounts');
const { runAsUser, requireRole, isInternalToken } = require('../lib/auth/context');
const { authRequired, isLoopbackAddress, production } = require('../lib/net');
const { fail } = require('../lib/validate');
const { SAFE_METHODS } = require('./security');

const COOKIE = 'docdesk_session';

// Everything is private unless it is named here. A new route is therefore
// behind sign-in by default, and forgetting to protect one is not possible -
// only forgetting to open one, which somebody notices straight away.
const PUBLIC = new Set([
  'GET /health',
  'GET /auth/session',
  'POST /auth/session',
  'POST /system/shutdown',
]);

// Who a request is "for" when sign-in has been switched off on a local-only
// installation (AUTH_REQUIRED=off, see lib/net.js).
const LOCAL_OWNER = Object.freeze({
  id: 0, email: null, displayName: 'This computer', photoURL: null, role: 'owner', status: 'active',
});

function readCookie(req, name = COOKIE) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/**
 * How the session cookie is set.
 *
 *  HttpOnly  no script can read it, so text that somehow ran as code in the
 *            page still could not walk off with the session
 *  SameSite  the browser will not attach it to a request another site started
 *  Secure    HTTPS only, wherever there is HTTPS
 *  Path      it travels with API calls and nothing else
 */
function cookieOptions(req) {
  const wanted = String(process.env.COOKIE_SAMESITE || '').toLowerCase();
  const sameSite = ['strict', 'lax', 'none'].includes(wanted) ? wanted : 'strict';
  return {
    httpOnly: true,
    // A browser throws away a SameSite=None cookie that is not also Secure.
    secure: req.secure || production() || sameSite === 'none',
    sameSite,
    path: '/api',
  };
}

function sameText(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function refuse(message, status, kind) {
  const err = fail(message, status);
  err.kind = kind;
  return err;
}

const signedOut = () => refuse('You are signed out. Sign in to carry on.', 401, 'signed_out');

/** The receptionist's own calls: no cookie, a secret only this process knows. */
async function internalCaller(req) {
  if (!isLoopbackAddress(req.socket.remoteAddress) || !isInternalToken(req.get('x-docdesk-internal'))) {
    throw signedOut();
  }
  // It acts for whoever asked it to, with exactly what they are allowed.
  const user = authRequired() ? await accounts.findUser(req.get('x-docdesk-user')) : LOCAL_OWNER;
  if (!user) throw signedOut();
  return user;
}

async function browserCaller(req) {
  if (!authRequired()) return LOCAL_OWNER;

  const token = readCookie(req);
  const session = token ? await accounts.findSession(token) : null;
  if (!session) throw signedOut();

  // The second check against cross-site request forgery (the first is the
  // Origin check in security.js). A forged request carries the cookie, because
  // the browser adds it - but not this token, which only a page that was
  // handed it by the API can know.
  if (!SAFE_METHODS.has(req.method) && !sameText(req.get('x-csrf-token'), session.csrfToken)) {
    throw refuse('This page is out of date. Reload it and try again.', 403, 'csrf');
  }
  req.sessionToken = token;
  return session.user;
}

/** Puts the actor and the person on the call stack for everything downstream. */
function withContext(req, res, next) {
  db.runAs(req.actor || 'web', () => (req.user ? runAsUser(req.user, () => next()) : next()));
}

async function authenticate(req, res, next) {
  try {
    if (PUBLIC.has(`${req.method} ${req.path}`)) {
      req.actor = 'web';
      return withContext(req, res, next);
    }

    const internal = req.get('x-docdesk-internal') !== undefined;
    const user = internal ? await internalCaller(req) : await browserCaller(req);

    if (user.status === 'pending') {
      throw refuse('Your account is waiting for the owner to let you in.', 403, 'pending');
    }
    if (user.status !== 'active') {
      throw refuse('This account has been turned off. Ask the owner to switch it back on.', 403, 'disabled');
    }

    req.user = user;
    req.internal = internal;
    // The audit trail records which part of DocDesk made a change. Only
    // DocDesk's own call may claim to be the receptionist; from a browser the
    // header means nothing.
    const claimed = req.get('x-docdesk-actor');
    req.actor = (internal || !authRequired()) && (claimed === brand.actor || claimed === brand.legacyActor) ? brand.actor : 'web';
    return withContext(req, res, next);
  } catch (err) {
    return next(err);
  }
}

/** Route guard: at least this role, or 403. */
function allow(minimum) {
  return (req, res, next) => {
    try {
      requireRole(minimum, req.user);
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { authenticate, allow, withContext, readCookie, cookieOptions, COOKIE, LOCAL_OWNER };
