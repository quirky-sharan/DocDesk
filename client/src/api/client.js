// In dev, Vite proxies /api to the Express server (see vite.config.js), so the
// default relative base works without any env file. VITE_API_URL is only needed
// when the frontend is deployed somewhere separate from the API.
const BASE = import.meta.env.VITE_API_URL || '/api';

const UNREACHABLE = 'Cannot reach the DocDesk server. Is it running on port 5000?';

/** The browser's timezone, so reports bucket days the way the shop sees them. */
export const TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
})();

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
    // Why it was refused, where the server said: signed_out, pending, disabled,
    // forbidden, csrf, rate_limited.
    this.code = body?.code || null;
  }
}

// The session itself is an HttpOnly cookie: the browser sends it, and nothing
// in this file - or any script - can read it. What the page does hold is the
// anti-forgery token, kept here in memory and sent with every change. Another
// site can make this browser send the cookie; it cannot know this.
let csrfToken = null;
let sessionEnded = null;

export function setCsrfToken(token) {
  csrfToken = token || null;
}

/** Called when the server says the session is over, so the app can show the way back in. */
export function onSessionEnded(handler) {
  sessionEnded = handler;
}

const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function withSession(options = {}, headers = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  return {
    // 'include' rather than the default so the cookie also travels when the
    // API is deployed at a different address from the web app.
    credentials: 'include',
    ...options,
    headers: {
      ...headers,
      ...(CHANGES.has(method) && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...options.headers,
    },
  };
}

function failure(response, body, fallback) {
  // Every error our API produces is JSON, so a non-JSON error body means the
  // request never reached it - the Vite proxy in dev, or a gateway in prod,
  // answered instead. Report that plainly rather than echoing a bare 500.
  if (!body) return new ApiError(UNREACHABLE, response.status);
  const error = new ApiError(body.error || `${fallback} (${response.status})`, response.status, body);
  // Signed out, turned away, or no longer let in: the whole app needs to know,
  // not just whichever page happened to make the call.
  if (['signed_out', 'pending', 'disabled'].includes(error.code)) sessionEnded?.(error.code);
  return error;
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, withSession(options, { 'Content-Type': 'application/json' }));
  } catch {
    // fetch only rejects when nothing answered at all.
    throw new ApiError(UNREACHABLE, 0);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) throw failure(response, body, 'Request failed');
  return body;
}

function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, value);
  }
  const string = search.toString();
  return string ? `?${string}` : '';
}

const withTz = (params = {}) => ({ tz: TIMEZONE, ...params });

const send = (path, method, payload) =>
  request(path, { method, body: JSON.stringify(payload ?? {}) });

// multipart: no Content-Type header, so the browser sets its own boundary.
async function sendForm(path, formData, method = 'POST') {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, withSession({ method, body: formData }));
  } catch {
    throw new ApiError(UNREACHABLE, 0);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw failure(response, body, 'Upload failed');
  return body;
}

function resource(path) {
  return {
    list: (params) => request(`${path}${query(params)}`),
    get: (id) => request(`${path}/${id}`),
    create: (payload) => send(path, 'POST', payload),
    update: (id, payload) => send(`${path}/${id}`, 'PUT', payload),
    remove: (id) => request(`${path}/${id}`, { method: 'DELETE' }),
  };
}

export const api = {
  // Signing in is Firebase's job; these trade its answer for a session here.
  auth: {
    session: () => request('/auth/session'),
    signIn: (idToken) => send('/auth/session', 'POST', { idToken }),
    signOut: () => request('/auth/session', { method: 'DELETE' }),
  },
  team: {
    list: () => request('/team'),
    update: (id, changes) => send(`/team/${id}`, 'PUT', changes),
    remove: (id) => request(`/team/${id}`, { method: 'DELETE' }),
    signOut: (id) => request(`/team/${id}/sign-out`, { method: 'POST' }),
  },
  health: () => request('/health'),
  stats: () => request('/stats'),
  seed: () => request('/dev/seed', { method: 'POST' }),
  clearSeed: () => request('/dev/seed', { method: 'DELETE' }),
  search: (q, limit = 5) => request(`/search${query({ q, limit })}`),

  products: {
    ...resource('/products'),
    summary: () => request('/products/summary'),
    categories: () => request('/products/categories'),
    adjustStock: (id, change, reason) => send(`/products/${id}/stock`, 'POST', { change, reason }),
    importPreview: (formData) => sendForm('/products/import/preview', formData),
    importCommit: (formData) => sendForm('/products/import', formData),
    history: (id) => request(`/products/${id}/history${query(withTz())}`),
    movements: (id, params) => request(`/products/${id}/movements${query(params)}`),
    restockSuggestion: () => request('/products/restock-suggestion'),
  },
  customers: {
    ...resource('/customers'),
    history: (id) => request(`/customers/${id}/history${query(withTz())}`),
  },
  suppliers: resource('/suppliers'),
  sales: {
    ...resource('/sales'),
    list: (params) => request(`/sales${query(withTz(params))}`),
    receipt: (id) => request(`/sales/${id}/receipt`),
    addPayment: (id, payload) => send(`/sales/${id}/payments`, 'POST', payload),
    removePayment: (id, paymentId) => request(`/sales/${id}/payments/${paymentId}`, { method: 'DELETE' }),
  },
  purchaseOrders: {
    ...resource('/purchase-orders'),
    receive: (id, items) => send(`/purchase-orders/${id}/receive`, 'POST', items ? { items } : {}),
  },
  messages: {
    list: (params) => request(`/messages${query(params)}`),
    send: () => request('/messages/send', { method: 'POST' }),
    create: (payload) => send('/messages', 'POST', payload),
    remove: (id) => request(`/messages/${id}`, { method: 'DELETE' }),
  },
  files: {
    list: (params) => request(`/files${query(params)}`),
    info: () => request('/files/info'),
    upload: (formData) => sendForm('/files', formData),
    update: (id, payload) => send(`/files/${id}`, 'PUT', payload),
    remove: (id) => request(`/files/${id}`, { method: 'DELETE' }),
  },
  ai: {
    status: (probe = false) => request(`/ai/status${probe ? '?probe=1' : ''}`),
    models: () => request('/ai/models'),
    discover: () => request('/ai/discover', { method: 'POST' }),
    usage: (days = 7) => request(`/ai/usage${query({ days, tz: TIMEZONE })}`),
    events: (params) => request(`/ai/events${query(params)}`),
    markEventsSeen: (ids) => send('/ai/events/seen', 'POST', { ids }),
    setOverrides: (payload) => send('/ai/overrides', 'PUT', payload),
    setProviderEnabled: (key, enabled) => send(`/ai/providers/${encodeURIComponent(key)}`, 'PUT', { enabled }),
    agreement: (days = 14) => request(`/ai/agreement${query({ days })}`),
    scoreboard: (mode) => request(`/ai/scoreboard${query({ mode })}`),
  },

  // The front desk.
  services: resource('/services'),
  resources: {
    ...resource('/resources'),
    setServices: (id, serviceIds) => send(`/resources/${id}/services`, 'PUT', { service_ids: serviceIds }),
  },
  hours: {
    get: () => request('/hours'),
    set: (hours, resourceId = null) => send('/hours', 'PUT', { hours, resource_id: resourceId }),
  },
  closures: {
    list: () => request('/closures'),
    add: (payload) => send('/closures', 'POST', payload),
    remove: (id) => request(`/closures/${id}`, { method: 'DELETE' }),
  },
  appointments: {
    list: (params) => request(`/appointments${query(withTz(params))}`),
    get: (id) => request(`/appointments/${id}`),
    create: (payload) => send('/appointments', 'POST', payload),
    day: (date) => request(`/appointments/day${query(withTz({ date }))}`),
    availability: (params) => request(`/appointments/availability${query(withTz(params))}`),
    reschedule: (id, payload) => send(`/appointments/${id}/reschedule`, 'POST', payload),
    setStatus: (id, status, reason) => send(`/appointments/${id}/status`, 'POST', { status, reason }),
    capabilities: () => request('/appointments/capabilities'),
  },
  leads: {
    ...resource('/leads'),
    convert: (id) => request(`/leads/${id}/convert`, { method: 'POST' }),
  },
  knowledge: {
    list: () => request('/knowledge'),
    get: (id) => request(`/knowledge/${id}`),
    create: (payload) => send('/knowledge', 'POST', payload),
    update: (id, payload) => send(`/knowledge/${id}`, 'PUT', payload),
    remove: (id) => request(`/knowledge/${id}`, { method: 'DELETE' }),
    search: (q) => request(`/knowledge/search${query({ q })}`),
    gaps: (limit = 20) => request(`/knowledge/gaps${query({ limit })}`),
    rebuild: () => request('/knowledge/rebuild', { method: 'POST' }),
  },
  receptionist: {
    message: (payload) => send('/receptionist/message', 'POST', payload),
    confirm: (payload) => send('/receptionist/confirm', 'POST', payload),
    cancel: (id) => send('/receptionist/cancel', 'POST', { id }),
  },
  settings: {
    get: () => request('/settings'),
    update: (payload) => send('/settings', 'PUT', payload),
  },
  reports: {
    summary: (params) => request(`/reports/summary${query(withTz(params))}`),
    salesByDay: (params) => request(`/reports/sales-by-day${query(withTz(params))}`),
    topProducts: (params) => request(`/reports/top-products${query(withTz(params))}`),
    topCustomers: (params) => request(`/reports/top-customers${query(withTz(params))}`),
    byCategory: (params) => request(`/reports/by-category${query(withTz(params))}`),
    byPaymentMethod: (params) => request(`/reports/by-payment-method${query(withTz(params))}`),
    byWeekday: (params) => request(`/reports/by-weekday${query(withTz(params))}`),
    heatmap: (params) => request(`/reports/heatmap${query(withTz(params))}`),
    stockByCategory: () => request('/reports/stock-by-category'),
    pulse: () => request(`/reports/pulse${query(withTz())}`),
  },
  db: {
    overview: () => request('/db/overview'),
    tables: () => request('/db/tables'),
    table: (name) => request(`/db/tables/${encodeURIComponent(name)}`),
    rows: (name, params) => request(`/db/tables/${encodeURIComponent(name)}/rows${query(params)}`),
    row: (name, id) => request(`/db/tables/${encodeURIComponent(name)}/rows/${encodeURIComponent(id)}`),
    tableStats: () => request('/db/table-stats'),
    savedQueries: () => request('/db/saved-queries'),
    saveQuery: (payload) => send('/db/saved-queries', 'POST', payload),
    updateQuery: (id, payload) => send(`/db/saved-queries/${id}`, 'PUT', payload),
    deleteQuery: (id) => request(`/db/saved-queries/${id}`, { method: 'DELETE' }),
    relationships: () => request('/db/relationships'),
    routines: () => request('/db/routines'),
    samples: () => request('/db/samples'),
    query: (sql, allowWrite = false) => send('/db/query', 'POST', { sql, allowWrite }),
    explain: (sql, { analyze = true, allowWrite = false } = {}) => send('/db/explain', 'POST', { sql, analyze, allowWrite }),
    activity: (params) => request(`/db/activity${query(params)}`),
    history: (table, id) => request(`/db/history/${table}/${id}`),
    performance: () => request('/db/performance'),
    integrity: () => request('/db/integrity'),
    fix: (id) => request(`/db/integrity/${id}/fix`, { method: 'POST' }),
    backups: () => request('/db/backups'),
    createBackup: () => request('/db/backups', { method: 'POST' }),
    deleteBackup: (name) => request(`/db/backups/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    restoreFile: (file) => {
      const form = new FormData();
      form.append('file', file);
      form.append('confirm', 'RESTORE');
      return sendForm('/db/restore', form);
    },
    restoreSaved: (name) => send('/db/restore', 'POST', { name, confirm: 'RESTORE' }),
    maintenance: (action, extra = {}) => send('/db/maintenance', 'POST', { action, ...extra }),
  },
};

/** Server-issued links are "/api/..."; point them at the configured API base. */
export function apiUrl(path) {
  if (!path.startsWith('/api')) return path;
  return `${BASE}${path.slice(4)}`;
}

export function fileContentUrl(id, { download = false } = {}) {
  return `${BASE}/files/${id}/content${download ? '?download=1' : ''}`;
}

// Downloads go through a plain link rather than fetch: the browser handles the
// Content-Disposition filename and the save dialog for free, and the file never
// has to pass through JS memory.
export function exportUrl(table, format, params = {}) {
  return `${BASE}/export/${table}${query({ format, tz: TIMEZONE, ...params })}`;
}

export function receiptPdfUrl(saleId) {
  return `${BASE}/sales/${saleId}/receipt.pdf`;
}

export function backupDownloadUrl(name) {
  return `${BASE}/db/backups/${encodeURIComponent(name)}`;
}

export function sqlExportUrl() {
  return `${BASE}/db/export.sql`;
}
