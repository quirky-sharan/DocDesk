const jwt = require('jsonwebtoken');
const firebase = require('../../../shared/firebase.json');
const { fail } = require('../validate');

/**
 * Checks a Firebase ID token.
 *
 * The browser signs in with Firebase and is handed a token signed by Google.
 * Nothing the browser says about who it is counts until this has checked that
 * signature against Google's published keys, and that the token was issued for
 * this project, by the right issuer, and has not expired.
 *
 * No service account or secret is needed: the keys are public, and the project
 * id is the same one the browser already ships with.
 */

const KEYS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const DAY_MS = 86_400_000;
// A token signed with a key we have not seen triggers a refetch. An attacker
// can invent key ids at will, so that refetch is allowed only this often.
const REFETCH_GAP_MS = 60_000;

function projectId() {
  return String(process.env.FIREBASE_PROJECT_ID || firebase.projectId || '').trim();
}

async function fetchGoogleKeys() {
  const response = await fetch(KEYS_URL, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Google answered ${response.status}`);
  const keys = await response.json();
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') || '')?.[1]) || 3600;
  return { keys, maxAgeMs: maxAge * 1000 };
}

let fetchKeys = fetchGoogleKeys;
let held = { keys: null, expiresAt: 0, fetchedAt: 0 };
let inFlight = null;

/**
 * Google's signing keys, cached for as long as Google says they are good.
 * Concurrent callers share one request, and if Google cannot be reached the
 * last known set is used rather than signing everybody out - the keys rotate
 * over days, not minutes.
 */
async function publicKeys({ refresh = false } = {}) {
  const now = Date.now();
  if (held.keys && !refresh && now < held.expiresAt) return held.keys;
  if (held.keys && refresh && now - held.fetchedAt < REFETCH_GAP_MS) return held.keys;

  if (!inFlight) {
    inFlight = fetchKeys()
      .then(({ keys, maxAgeMs }) => {
        held = { keys, expiresAt: Date.now() + Math.min(maxAgeMs, DAY_MS), fetchedAt: Date.now() };
        return keys;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  try {
    return await inFlight;
  } catch (err) {
    if (held.keys) return held.keys;
    throw fail(`Sign-in could not be checked because Google's keys could not be fetched (${err.message}). Check the internet connection and try again.`, 503);
  }
}

const refused = (message) => fail(message, 401);

async function verifyIdToken(token) {
  if (typeof token !== 'string' || token.length > 4096 || token.split('.').length !== 3) {
    throw refused('That sign-in was not valid.');
  }
  const project = projectId();
  if (!project) throw fail('Sign-in is not set up on this server: there is no Firebase project id.', 500);

  const decoded = jwt.decode(token, { complete: true });
  const keyId = decoded?.header?.kid;
  // The algorithm is fixed here, not read from the token: a token that names
  // its own algorithm ("none", or HS256 with the public key as the secret) is
  // the classic way around a verifier that trusts the header.
  if (!decoded || decoded.header.alg !== 'RS256' || typeof keyId !== 'string') {
    throw refused('That sign-in was not valid.');
  }

  let keys = await publicKeys();
  if (!keys[keyId]) keys = await publicKeys({ refresh: true });
  if (!keys[keyId]) throw refused('That sign-in was not valid.');

  let claims;
  try {
    claims = jwt.verify(token, keys[keyId], {
      algorithms: ['RS256'],
      audience: project,
      issuer: `https://securetoken.google.com/${project}`,
      clockTolerance: 60,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw refused("That sign-in has expired. Sign in again - and if it keeps happening, check this computer's clock.");
    }
    throw refused('That sign-in was not valid.');
  }

  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) {
    throw refused('That sign-in was not valid.');
  }

  return {
    uid: claims.sub,
    email: typeof claims.email === 'string' ? claims.email.slice(0, 254) : null,
    emailVerified: claims.email_verified === true,
    name: typeof claims.name === 'string' ? claims.name.slice(0, 120) : null,
    picture: typeof claims.picture === 'string' && /^https:\/\//.test(claims.picture) ? claims.picture.slice(0, 500) : null,
    provider: claims.firebase?.sign_in_provider || null,
  };
}

/** Tests sign their own tokens, so they swap in their own key source. */
function useKeySource(source) {
  fetchKeys = source || fetchGoogleKeys;
  held = { keys: null, expiresAt: 0, fetchedAt: 0 };
  inFlight = null;
}

module.exports = { verifyIdToken, publicKeys, projectId, useKeySource };
