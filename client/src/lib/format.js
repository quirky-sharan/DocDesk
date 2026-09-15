// Number, money and date formatting in one place, so every screen agrees on how
// "1,299.50" or "2 hours ago" is written. Money takes the shop's currency symbol
// from settings; left blank, amounts are plain numbers.

const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const moneyFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integerFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatNumber(value) {
  return numberFormat.format(toNumber(value));
}

export function formatInteger(value) {
  return integerFormat.format(Math.round(toNumber(value)));
}

export function formatMoney(value, symbol = '') {
  const n = toNumber(value);
  const body = moneyFormat.format(Math.abs(n));
  const sign = n < 0 ? '−' : '';
  return symbol ? `${sign}${symbol}${body}` : `${sign}${body}`;
}

/** 1284 -> 1.3K, 12900 -> 12.9K, 4200000 -> 4.2M */
export function formatCompact(value, symbol = '') {
  const n = toNumber(value);
  const abs = Math.abs(n);
  let body;
  if (abs >= 1_000_000_000) body = `${trim(abs / 1_000_000_000)}B`;
  else if (abs >= 1_000_000) body = `${trim(abs / 1_000_000)}M`;
  else if (abs >= 10_000) body = `${trim(abs / 1_000)}K`;
  else body = integerFormat.format(abs);
  return `${n < 0 ? '−' : ''}${symbol}${body}`;
}

function trim(n) {
  return n >= 100 ? n.toFixed(0) : n.toFixed(1).replace(/\.0$/, '');
}

export function formatPercent(value, digits = 0) {
  return `${toNumber(value).toFixed(digits)}%`;
}

export function formatBytes(bytes) {
  const n = toNumber(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  // A bare YYYY-MM-DD is a calendar date, not midnight UTC - parse it as local.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  // 'YYYY-MM-DD HH:MM:SS' from the database clock is UTC.
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const date = parseDate(value);
  return date ? date.toLocaleDateString(undefined, options) : '—';
}

export function formatDateTime(value) {
  const date = parseDate(value);
  if (!date) return '—';
  return date.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function formatTime(value) {
  const date = parseDate(value);
  return date ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—';
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "just now", "5 min ago", "yesterday", then a plain date. */
export function formatRelative(value, now = Date.now()) {
  const date = parseDate(value);
  if (!date) return '—';
  const seconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86400 * 6) return relative.format(Math.round(seconds / 86400), 'day');
  return formatDate(date);
}

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function initials(name, fallback = 'DD') {
  const letters = String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
  return letters || fallback;
}

/** A stable hue for a name, so the same customer always gets the same avatar. */
export function hueFor(text) {
  let hash = 0;
  for (const ch of String(text || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
}
