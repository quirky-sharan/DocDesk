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

function query(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, value);
  }
  const string = search.toString();
  return string ? `?${string}` : '';
}

const send = (path, method, payload) =>
  request(path, { method, body: JSON.stringify(payload ?? {}) });

// multipart: no Content-Type header, so the browser sets its own boundary.
async function sendForm(path, formData, method = 'POST') {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, { method, body: formData });
  } catch {
    throw new Error(UNREACHABLE);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (!body) throw new Error(UNREACHABLE);
    throw new Error(body.error || `Upload failed (${response.status})`);
  }
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
  health: () => request('/health'),
  stats: () => request('/stats'),
  seed: () => request('/dev/seed', { method: 'POST' }),
  clearSeed: () => request('/dev/seed', { method: 'DELETE' }),

  products: {
    ...resource('/products'),
    summary: () => request('/products/summary'),
    categories: () => request('/products/categories'),
    adjustStock: (id, change, reason) => send(`/products/${id}/stock`, 'POST', { change, reason }),
    importPreview: (formData) => sendForm('/products/import/preview', formData),
    importCommit: (formData) => sendForm('/products/import', formData),
    history: (id) => request(`/products/${id}/history`),
    restockSuggestion: () => request('/products/restock-suggestion'),
  },
  customers: {
    ...resource('/customers'),
    history: (id) => request(`/customers/${id}/history`),
  },
  suppliers: resource('/suppliers'),
  sales: {
    ...resource('/sales'),
    receipt: (id) => request(`/sales/${id}/receipt`),
  },
  purchaseOrders: {
    ...resource('/purchase-orders'),
    receive: (id, items) => send(`/purchase-orders/${id}/receive`, 'POST', items ? { items } : {}),
  },
  messages: {
    list: (params) => request(`/messages${query(params)}`),
    send: () => request('/messages/send', { method: 'POST' }),
    remove: (id) => request(`/messages/${id}`, { method: 'DELETE' }),
  },
  files: {
    list: (params) => request(`/files${query(params)}`),
    info: () => request('/files/info'),
    upload: (formData) => sendForm('/files', formData),
    update: (id, payload) => send(`/files/${id}`, 'PUT', payload),
    remove: (id) => request(`/files/${id}`, { method: 'DELETE' }),
  },
  settings: {
    get: () => request('/settings'),
    update: (payload) => send('/settings', 'PUT', payload),
  },
  reports: {
    summary: (params) => request(`/reports/summary${query(params)}`),
    salesByDay: (params) => request(`/reports/sales-by-day${query(params)}`),
    topProducts: (params) => request(`/reports/top-products${query(params)}`),
    topCustomers: (params) => request(`/reports/top-customers${query(params)}`),
    byCategory: (params) => request(`/reports/by-category${query(params)}`),
    byPaymentMethod: (params) => request(`/reports/by-payment-method${query(params)}`),
    stockByCategory: () => request('/reports/stock-by-category'),
    pulse: () => request('/reports/pulse'),
  },
};

export function fileContentUrl(id, { download = false } = {}) {
  return `${BASE}/files/${id}/content${download ? '?download=1' : ''}`;
}

// Downloads go through a plain link rather than fetch: the browser handles the
// Content-Disposition filename and the save dialog for free, and the file never
// has to pass through JS memory.
export function exportUrl(table, format, params = {}) {
  return `${BASE}/export/${table}${query({ format, ...params })}`;
}

export function receiptPdfUrl(saleId) {
  return `${BASE}/sales/${saleId}/receipt.pdf`;
}
