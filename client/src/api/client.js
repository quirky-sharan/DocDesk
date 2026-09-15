// In dev, Vite proxies /api to the Express server (see vite.config.js), so the
// default relative base works without any env file. VITE_API_URL is only needed
// when the frontend is deployed somewhere separate from the API.
const BASE = import.meta.env.VITE_API_URL || '/api';

const UNREACHABLE = 'Cannot reach the DocDesk server. Is it running on port 5000?';

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    // fetch only rejects when nothing answered at all.
    throw new Error(UNREACHABLE);
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    // Every error our API produces is JSON, so a non-JSON error body means the
    // request never reached it - the Vite proxy in dev, or a gateway in prod,
    // answered instead. Report that plainly rather than echoing a bare 500.
    if (!body) throw new Error(UNREACHABLE);
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return body;
}

export const api = {
  health: () => request('/health'),
  stats: () => request('/stats'),
  seed: () => request('/dev/seed', { method: 'POST' }),
  clearSeed: () => request('/dev/seed', { method: 'DELETE' }),
};
