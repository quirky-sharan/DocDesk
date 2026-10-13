const crypto = require('crypto');
const db = require('../../db');
const { createCache } = require('../cache');
const { fail, oneOf } = require('../validate');
const { ROLES } = require('./context');

/**
 * People and their sessions.
 *
 * A session is a random 256-bit value held in an HttpOnly cookie. The database
 * keeps only its SHA-256, so neither a backup nor the SQL console can be used
 * to sign in as somebody. It is a row rather than a signed token on purpose:
 * signing out, removing someone, or changing their role takes effect on their
 * very next request instead of whenever a token happens to expire - and there
 * is no signing secret to keep safe.
 */

const DAY_MS = 86_400_000;
const IDLE_MS = 7 * DAY_MS;        // unused this long, and it is over
const LIFETIME_MS = 30 * DAY_MS;   // however busy, sign in again after this
const TOUCH_MS = 5 * 60_000;       // "last used" is written at most this often
const MAX_SESSIONS = 10;           // per person; the oldest go first

// Looking a session up on every request would be one query per request for an
// answer that almost never changes. It is remembered briefly instead, and
// forgotten at once when it does change (sign-out, a new role, removal).
const lookups = createCache({ name: 'sessions', ttlMs: 30_000, max: 1000 });

// Sign-ins and "last used" stamps change nothing a report is built from, so
// they must not throw away everything the reports have cached.
const QUIET = { actor: 'auth', quiet: true };

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * The anti-forgery token for a session, derived from the cookie rather than
 * stored: only a page that was handed it by the API can know it, and the
 * cookie alone - which is all a forged cross-site request carries - is not it.
 */
const csrfFor = (token) => crypto.createHmac('sha256', token).update('docdesk-csrf').digest('base64url');

function toUser(row) {
  return {
    id: Number(row.id),
    email: row.email,
    displayName: row.display_name,
    photoURL: row.photo_url,
    role: row.role,
    status: row.status,
  };
}

function ownerEmail() {
  return String(process.env.OWNER_EMAIL || '').trim().toLowerCase();
}

/** True when OWNER_EMAIL names this account and Google vouches for the address. */
function isNamedOwner(identity) {
  const named = ownerEmail();
  return Boolean(named) && identity.emailVerified && String(identity.email || '').toLowerCase() === named;
}

/**
 * Records a verified sign-in and says who it was.
 *
 * The first account on a fresh installation becomes the owner. Everyone after
 * that waits as "pending" until an owner lets them in - Firebase lets anybody
 * create an account, so having one cannot be what grants access.
 *
 * With OWNER_EMAIL set, only that (verified) address is ever made owner
 * automatically. It is also the way back in if the owner is locked out.
 */
async function recordSignIn(identity) {
  return db.transaction(async (tx) => {
    // One at a time, so two people racing on a new installation cannot both
    // find it empty and both be made owner.
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('docdesk.users'))");

    const named = isNamedOwner(identity);
    const { rows: found } = await tx.query('SELECT * FROM users WHERE firebase_uid = $1', [identity.uid]);

    if (found.length) {
      const { rows } = await tx.query(
        `UPDATE users
            SET email = COALESCE($2, email),
                display_name = COALESCE($3, display_name),
                photo_url = COALESCE($4, photo_url),
                role = CASE WHEN $5 THEN 'owner' ELSE role END,
                status = CASE WHEN $5 THEN 'active' ELSE status END,
                last_seen_at = now()
          WHERE id = $1
          RETURNING *`,
        [found[0].id, identity.email, identity.name, identity.picture, named]
      );
      return toUser(rows[0]);
    }

    const { rows: counted } = await tx.query("SELECT count(*)::int AS owners FROM users WHERE role = 'owner' AND status = 'active'");
    const first = counted[0].owners === 0 && !ownerEmail();
    const owner = named || first;
    const { rows } = await tx.query(
      `INSERT INTO users (firebase_uid, email, display_name, photo_url, role, status, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING *`,
      [identity.uid, identity.email, identity.name, identity.picture, owner ? 'owner' : 'staff', owner ? 'active' : 'pending']
    );
    return toUser(rows[0]);
  }, QUIET);
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM sessions WHERE expires_at < now() OR last_used_at < now() - make_interval(secs => $1)', [IDLE_MS / 1000]);
    await tx.query(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))',
      [hashToken(token), userId, LIFETIME_MS / 1000]
    );
    await tx.query(
      `DELETE FROM sessions
        WHERE user_id = $1
          AND id NOT IN (SELECT id FROM sessions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2)`,
      [userId, MAX_SESSIONS]
    );
  }, QUIET);
  return { token, csrfToken: csrfFor(token), maxAgeMs: LIFETIME_MS };
}

function stamp(found) {
  return db.transaction(async (tx) => {
    await tx.query('UPDATE sessions SET last_used_at = now() WHERE id = $1', [found.sessionId]);
    await tx.query('UPDATE users SET last_seen_at = now() WHERE id = $1', [found.user.id]);
  }, { ...QUIET, settings: { 'docdesk.skip_audit': 'on' } });
}

/** The session a cookie belongs to and whose it is, or null. */
async function findSession(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const key = hashToken(token);

  const found = await lookups.wrap(key, async () => {
    const { rows } = await db.query(
      `SELECT s.id AS session_id,
              extract(epoch FROM s.expires_at) * 1000 AS expires_ms,
              extract(epoch FROM s.last_used_at) * 1000 AS last_used_ms,
              u.id, u.email, u.display_name, u.photo_url, u.role, u.status
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1`,
      [key]
    );
    if (!rows.length) return undefined;
    return {
      sessionId: Number(rows[0].session_id),
      expiresAt: Number(rows[0].expires_ms),
      lastUsedAt: Number(rows[0].last_used_ms),
      user: toUser(rows[0]),
    };
  });
  if (!found) return null;

  const now = Date.now();
  if (now >= found.expiresAt || now - found.lastUsedAt >= IDLE_MS) {
    await destroySession(token);
    return null;
  }
  if (now - found.lastUsedAt >= TOUCH_MS) {
    found.lastUsedAt = now;
    stamp(found).catch(() => {});
  }
  return { ...found, csrfToken: csrfFor(token) };
}

async function destroySession(token) {
  if (typeof token !== 'string' || !token) return;
  const key = hashToken(token);
  lookups.delete(key);
  await db.transaction((tx) => tx.query('DELETE FROM sessions WHERE token_hash = $1', [key]), QUIET);
}

/** Makes the next request from this person read their row again. */
function forgetUser(userId) {
  lookups.deleteWhere((found) => found.user.id === Number(userId));
}

async function findUser(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id < 1) return null;
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows.length ? toUser(rows[0]) : null;
}

// --- the team, as the owner sees it ------------------------------------------

async function listUsers() {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.display_name, u.photo_url, u.role, u.status, u.created_at, u.last_seen_at,
            (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions
       FROM users u
      ORDER BY (u.status = 'pending') DESC, u.created_at`
  );
  return rows.map((row) => ({
    ...toUser(row),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    sessions: row.sessions,
  }));
}

/**
 * Lets someone in, turns them away, or changes what they may do. Nobody edits
 * their own row: an owner who demoted themselves by accident would have no way
 * to undo it. The database refuses to be left with no owner at all
 * (users_keep_an_owner), whatever is asked here.
 */
async function updateUser(userId, changes, actingUser) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id < 1) throw fail('That person is not on the list.', 404);
  if (id === actingUser.id) throw fail('You cannot change your own access. Ask another owner.', 400);

  const role = oneOf(changes.role, 'Role', ROLES);
  const status = oneOf(changes.status, 'Status', ['active', 'disabled']);
  if (!role && !status) throw fail('Nothing to change.');

  const { rows } = await db.transaction(
    (tx) => tx.query(
      'UPDATE users SET role = COALESCE($2, role), status = COALESCE($3, status) WHERE id = $1 RETURNING *',
      [id, role, status]
    ),
    QUIET
  );
  if (!rows.length) throw fail('That person is not on the list.', 404);

  // Turned away means signed out now, not when their session next expires.
  if (rows[0].status !== 'active') await destroyUserSessions(id);
  forgetUser(id);
  return toUser(rows[0]);
}

async function removeUser(userId, actingUser) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id < 1) throw fail('That person is not on the list.', 404);
  if (id === actingUser.id) throw fail('You cannot remove yourself. Ask another owner.', 400);
  forgetUser(id);
  const { rowCount } = await db.transaction((tx) => tx.query('DELETE FROM users WHERE id = $1', [id]), QUIET);
  if (!rowCount) throw fail('That person is not on the list.', 404);
  forgetUser(id);
}

async function destroyUserSessions(userId) {
  forgetUser(userId);
  await db.transaction((tx) => tx.query('DELETE FROM sessions WHERE user_id = $1', [Number(userId)]), QUIET);
  forgetUser(userId);
}

module.exports = {
  recordSignIn, createSession, findSession, destroySession, destroyUserSessions, findUser, forgetUser,
  listUsers, updateUser, removeUser, csrfFor, hashToken, IDLE_MS, LIFETIME_MS,
};
