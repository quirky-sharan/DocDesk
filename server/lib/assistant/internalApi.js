/**
 * The assistant acts through DocDesk's own HTTP API rather than touching the
 * database directly.
 *
 * That is deliberate: every validation rule, transaction, stock movement and
 * low-stock trigger already lives behind those routes. Going through them means
 * the assistant can never do anything a person clicking the buttons couldn't,
 * and a rule added to the API later automatically applies to it too.
 */

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

async function call(method, path, { body, params } = {}) {
  const response = await fetch(`${baseUrl()}${path}${query(params)}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(payload?.error || `Request failed (${response.status})`, response.status);
  }
  return payload;
}

module.exports = {
  get: (path, params) => call('GET', path, { params }),
  post: (path, body) => call('POST', path, { body }),
  put: (path, body) => call('PUT', path, { body }),
  del: (path) => call('DELETE', path),
  ApiError,
};
