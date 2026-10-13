const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');
const { fail } = require('../validate');

/**
 * Who the current request is for.
 *
 * Kept on the call stack (AsyncLocalStorage) rather than passed down as an
 * argument, so the two places that need it without having a request in hand can
 * still ask: the audit trail, and the receptionist when it calls the API on
 * somebody's behalf.
 */
const store = new AsyncLocalStorage();

// Least to most. A role may do everything the ones before it may.
const ROLES = ['staff', 'manager', 'owner'];

function runAsUser(user, fn) {
  return store.run({ user }, fn);
}

function currentUser() {
  return store.getStore()?.user || null;
}

/** How the audit trail names the person: their email where there is one. */
function currentUserLabel() {
  const user = currentUser();
  if (!user) return '';
  return String(user.email || user.displayName || `user ${user.id}`).slice(0, 200);
}

function hasRole(user, minimum) {
  const needed = ROLES.indexOf(minimum);
  return Boolean(user) && needed >= 0 && ROLES.indexOf(user.role) >= needed;
}

const ROLE_SENTENCE = {
  manager: 'That needs a manager or the owner.',
  owner: 'Only the owner can do that.',
};

/** Throws unless the person this request is for holds at least `minimum`. */
function requireRole(minimum, user = currentUser()) {
  if (!hasRole(user, minimum)) {
    const err = fail(ROLE_SENTENCE[minimum] || 'You are not allowed to do that.', 403);
    err.kind = 'forbidden';
    throw err;
  }
  return user;
}

// The receptionist acts through the HTTP API (see receptionist/internalApi.js),
// so it needs a way to say "this is DocDesk calling itself". The secret is made
// fresh each time the server starts, exists only in this process's memory, and
// is never written anywhere - there is nothing to leak or rotate.
const internalToken = crypto.randomBytes(32).toString('base64url');

function isInternalToken(value) {
  const given = Buffer.from(String(value || ''));
  const expected = Buffer.from(internalToken);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

module.exports = {
  ROLES, runAsUser, currentUser, currentUserLabel, hasRole, requireRole, internalToken, isInternalToken,
};
