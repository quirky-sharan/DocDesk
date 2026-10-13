const db = require('../db');

// Where DocDesk is running decides how much it should assume. On somebody's own
// computer with the embedded database it is a desktop app and stays on that
// computer. Anywhere else it is on a network and is treated as public.

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const production = () => process.env.NODE_ENV === 'production';

function isLoopbackAddress(address) {
  return LOOPBACK_ADDRESSES.has(String(address || ''));
}

/**
 * The address the API listens on. Loopback for the embedded database, so
 * nothing else on the same Wi-Fi can reach it; every interface once it is a
 * deployment, because that is the only way a host can route traffic to it.
 */
function listenHost() {
  const chosen = String(process.env.HOST || '').trim();
  if (chosen) return chosen;
  return db.mode === 'embedded' && !production() ? '127.0.0.1' : '0.0.0.0';
}

/** True when this is one person's own machine and nothing beyond it. */
function localOnly() {
  return db.mode === 'embedded' && !production() && LOCAL_HOSTNAMES.has(listenHost());
}

/**
 * Whether requests must be signed in. Always, with one exception: AUTH_REQUIRED=off
 * on a local-only installation, as a way back in when sign-in itself is the
 * problem (no internet, a lost account). The switch is ignored anywhere a
 * stranger could reach - it can open this computer's door and no other.
 */
function authRequired() {
  return !(process.env.AUTH_REQUIRED === 'off' && localOnly());
}

let parsedFrom = null;
let parsed = new Set();

/** The sites, other than DocDesk's own address, allowed to call the API from a browser. */
function allowedOrigins() {
  const raw = `${process.env.CORS_ORIGIN || ''}|${process.env.NODE_ENV || ''}`;
  if (raw === parsedFrom) return parsed;
  const configured = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    // A wildcard cannot be combined with cookies, and "any site" is exactly
    // what this list exists to rule out.
    .filter((origin) => /^https?:\/\/[^*\s/]+$/.test(origin));
  parsed = new Set([...configured, ...(production() ? [] : DEV_ORIGINS)]);
  parsedFrom = raw;
  return parsed;
}

function isAllowedOrigin(origin, req) {
  if (allowedOrigins().has(origin)) return true;
  // The page was served from the same address the request is going to.
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function isLocalHostname(host) {
  const name = String(host || '').toLowerCase().replace(/:\d+$/, '');
  return LOCAL_HOSTNAMES.has(name);
}

module.exports = {
  production, isLoopbackAddress, listenHost, localOnly, authRequired, allowedOrigins, isAllowedOrigin, isLocalHostname,
};
