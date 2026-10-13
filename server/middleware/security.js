const cors = require('cors');
const { localOnly, production, allowedOrigins, isAllowedOrigin, isLocalHostname } = require('../lib/net');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Headers every response carries.
 *
 * The API answers with data, never with a page, so its content policy is the
 * strictest there is: nothing it returns may load or run anything, or be put
 * in a frame. A route that does send something a browser will render (an
 * uploaded file) sets its own.
 */
function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
}

function apiHeaders(req, res, next) {
  res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  // Stops another site pulling an API response in as an image or a script.
  // Left off when a separate site is meant to be calling the API.
  if (!process.env.CORS_ORIGIN) res.set('Cross-Origin-Resource-Policy', 'same-origin');
  // "private": only this person's browser may keep it, never a shared proxy.
  // "no-cache": it must be re-checked with the server before each use, which
  // costs a 304 instead of the whole body when nothing changed (Express sends
  // the ETag) - and means nothing is ever shown after a sign-out.
  res.set('Cache-Control', req.method === 'GET' ? 'private, no-cache' : 'no-store');
  next();
}

/**
 * On somebody's own computer, only answer requests addressed to localhost.
 *
 * Without this a website can point its own domain at 127.0.0.1 ("DNS
 * rebinding") and have the visitor's browser talk to DocDesk as though it were
 * that site - same origin, so none of the browser's cross-site rules apply.
 * The Host header still carries the attacker's name, which is how it is caught.
 */
function hostGuard(req, res, next) {
  if (!localOnly() || isLocalHostname(req.headers.host)) return next();
  res.status(421).json({ error: 'DocDesk on this computer only answers to localhost.' });
}

const corsOptions = {
  origin(origin, done) {
    done(null, Boolean(origin) && allowedOrigins().has(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  exposedHeaders: ['Content-Disposition', 'Retry-After', 'X-Cache'],
  maxAge: 600,
};

/**
 * Refuses a change that a browser says came from another site.
 *
 * This is the first of two checks against cross-site request forgery; the
 * second is the anti-forgery token (see authenticate.js). A browser always
 * names the origin of a cross-site write, so a request with no Origin is not
 * a browser at all - the launcher, or the receptionist calling the API - and
 * has no signed-in cookie to be tricked into sending.
 */
function originGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (!origin || isAllowedOrigin(origin, req)) return next();
  res.status(403).json({ error: 'That request came from a site DocDesk does not trust.', code: 'origin' });
}

/**
 * The policy for the web app itself, when this server is the one serving it.
 * Scripts may only come from DocDesk and from the one Google file Firebase
 * sign-in loads; nothing inline runs, so text that found its way into a page
 * cannot become code.
 */
function pagePolicy(firebase) {
  const authFrame = firebase.authDomain ? `https://${firebase.authDomain}` : '';
  return [
    "default-src 'self'",
    "script-src 'self' https://apis.google.com https://www.googletagmanager.com",
    // The interface positions and animates with inline styles; those cannot run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self' blob: https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseinstallations.googleapis.com https://firebase.googleapis.com https://*.google-analytics.com https://www.googletagmanager.com",
    `frame-src 'self' ${authFrame}`.trim(),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

module.exports = {
  SAFE_METHODS, securityHeaders, apiHeaders, hostGuard, originGuard, pagePolicy,
  cors: () => cors(corsOptions),
  production,
};
