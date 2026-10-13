/**
 * Receptionist AI acts through DocDesk's own HTTP API rather than touching the
 * database directly.
 *
 * That is deliberate: every validation rule, transaction, stock movement and
 * low-stock trigger already lives behind those routes. Going through them means
 * the receptionist can never do anything a person clicking the buttons couldn't,
 * and a rule added to the API later automatically applies to it too.
 *
 * It holds for permissions as well. Each call says who the receptionist is
 * working for, and the API applies that person's role to it - so asking the
 * receptionist to do something is never a way around not being allowed to.
 */
const brand = require('../../../shared/brand.json');
const { currentUser, internalToken } = require('../auth/context');

function baseUrl() {
  const port = Number(process.env.PORT) || 5000;
  return `http://127.0.0.1:${port}/api`;
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

/**
 * Parts of these paths come from what a model decided to call a record, and a
 * model can be talked into things by text it was shown. A path is therefore
 * only ever plain segments: "/products/../db/restore" would be tidied by fetch
 * into a different route altogether, and never gets that far.
 */
function checked(path) {
  const ok = typeof path === 'string'
    && /^(\/[A-Za-z0-9._-]+)+$/.test(path)
    && !path.split('/').some((segment) => segment === '.' || segment === '..');
  if (!ok) throw new ApiError('That is not somewhere the receptionist can go.', 400);
  return path;
}

function headers(extra = {}) {
  const user = currentUser();
  return {
    // Proves this is DocDesk calling itself: made at start-up, held in memory.
    'x-docdesk-internal': internalToken,
    // Who it is acting for. The API gives the call that person's permissions.
    ...(user ? { 'x-docdesk-user': String(user.id) } : {}),
    // Marks the change as the receptionist's in the database's audit trail.
    'x-docdesk-actor': brand.actor,
    ...extra,
  };
}

async function call(method, path, { body, params } = {}) {
  const response = await fetch(`${baseUrl()}${checked(path)}${query(params)}`, {
    method,
    headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(payload?.error || `Request failed (${response.status})`, response.status);
  }
  return payload;
}

/**
 * Whether a download would work, without reading it: the receptionist checks a
 * file renders before telling someone it is ready.
 */
async function probe(path, params) {
  const response = await fetch(`${baseUrl()}${checked(path)}${query(params)}`, {
    headers: headers(),
    signal: AbortSignal.timeout(20000),
  });
  const error = response.ok ? null : (await response.json().catch(() => null))?.error || null;
  await response.body?.cancel().catch(() => {});
  return { ok: response.ok, status: response.status, error };
}

module.exports = {
  get: (path, params) => call('GET', path, { params }),
  post: (path, body) => call('POST', path, { body }),
  put: (path, body) => call('PUT', path, { body }),
  del: (path) => call('DELETE', path),
  probe,
  checked,
  ApiError,
};
