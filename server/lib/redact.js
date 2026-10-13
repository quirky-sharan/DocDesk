/**
 * Keeping people's details out of the log.
 *
 * The console window, and wherever a host keeps its output, is read by people
 * who have no business seeing a customer's phone number, and is kept far longer
 * and far less carefully than the database is. So what goes there is enough to
 * follow what happened - which message, which route - and not who it was about.
 */

/** "priya@example.com" -> "p***@example.com"; "+91 98765 43210" -> "*** 3210". */
function maskContact(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const at = text.indexOf('@');
  if (at > 0) return `${text[0]}***${text.slice(at)}`;
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 4) return `*** ${digits.slice(-4)}`;
  return '***';
}

/** A request's address without its query string, which is where search text and names end up. */
function pathOnly(url) {
  return String(url || '').split('?')[0];
}

module.exports = { maskContact, pathOnly };
