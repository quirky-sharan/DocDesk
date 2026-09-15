// Turns PostgreSQL errors into sentences for the person at the counter.
//
// The database enforces the rules (see db/migrations); this decides how a broken
// rule is explained. Messages the database raises itself are already written for
// people and carry HINT 'docdesk' - those pass through unchanged.

const CONSTRAINT_MESSAGES = {
  products_sku_key: 'That code (SKU) is already used by another product.',
  categories_name_key: 'There is already a category with that name.',
  users_username_key: 'That username is taken.',
  sales_reference_key: 'That receipt number is already in use.',
  purchase_orders_reference_key: 'That order number is already in use.',
  products_stock_quantity_check: 'There is not enough stock for that.',
  products_cost_price_check: 'Cost price cannot be negative.',
  products_sale_price_check: 'Sale price cannot be negative.',
  products_reorder_level_check: 'Reorder level cannot be negative.',
  products_name_length: 'A product needs a name (up to 200 characters).',
  customers_name_length: 'A customer needs a name (up to 150 characters).',
  suppliers_name_length: 'A supplier needs a name (up to 150 characters).',
  customers_email_format: "That email address doesn't look right.",
  suppliers_email_format: "That email address doesn't look right.",
  sales_discount_le_subtotal: 'The discount is larger than the sale total.',
  sales_total_consistent: "The sale's totals don't add up.",
  sales_paid_range: 'The amount paid must be between zero and the sale total.',
  sale_items_quantity_positive: 'Each item needs a quantity above zero.',
  payments_amount_non_zero: 'A payment needs an amount.',
  payments_method_check: 'Payment method must be cash, card, UPI, bank transfer or other.',
  purchase_order_items_received_range: "You can't receive more than was ordered.",
  purchase_order_items_quantity_positive: 'Each item needs a quantity above zero.',
  message_log_one_queued_low_stock: 'An alert for that product is already waiting.',
  files_related_type_check: 'Files can only be attached to a product, sale, customer, supplier or order.',
  settings_key_format: 'That is not a valid setting name.',
};

const FRIENDLY_COLUMN = (column) => String(column || 'A value').replace(/_/g, ' ');

function translate(err) {
  if (!err || typeof err.code !== 'string' || !/^[0-9A-Z]{5}$/.test(err.code)) return null;

  if (err.hint === 'docdesk') return { status: 409, message: err.message };

  const result = translateCode(err);
  // Where in the statement it went wrong, so the console can point at it.
  if (result && err.position && /^42/.test(err.code)) result.position = Number(err.position);
  return result;
}

function translateCode(err) {
  const byConstraint = err.constraint && CONSTRAINT_MESSAGES[err.constraint];
  switch (err.code) {
    case '23505':
      return { status: 409, message: byConstraint || 'That value is already in use.' };
    case '23503':
      return {
        status: 409,
        message: byConstraint || (/is still referenced/.test(err.detail || '')
          ? 'Other records still depend on this, so it can\'t be removed.'
          : 'That refers to something that no longer exists.'),
      };
    case '23514':
      return { status: 400, message: byConstraint || "One of the values isn't allowed." };
    case '23502':
      return { status: 400, message: `${FRIENDLY_COLUMN(err.column)} is required.` };
    case '22P02':
    case '22007':
    case '22008':
      return { status: 400, message: "A value isn't in the right format." };
    case '22003':
      return { status: 400, message: 'A number is too large.' };
    case '22001':
      return { status: 400, message: 'A piece of text is too long.' };
    case '40001':
    case '40P01':
      return { status: 503, message: 'The database was busy with another change. Please try again.' };
    case '57014':
      return { status: 408, message: err.message.includes('stopped') ? err.message : 'The query took too long and was stopped.' };
    case '25006':
      return { status: 403, message: 'This is a read-only query, so it cannot change anything.' };
    case '42P01':
      return { status: 400, message: `There is no table by that name${err.message.match(/"([^"]+)"/) ? `: ${err.message.match(/"([^"]+)"/)[1]}` : ''}.` };
    case '42703':
      return { status: 400, message: err.message.replace(/^column/, 'Column') };
    case '42601':
      return { status: 400, message: `SQL syntax error: ${err.message}` };
    case '53300':
    case '08006':
    case '08001':
    case '57P01':
      return { status: 503, message: 'The database connection dropped. Please try again in a moment.' };
    default:
      // Anything else in the "bad data" (22) or "bad statement" (42) classes is
      // the query's fault, not the server's - mostly typed in the SQL console.
      if (err.code.startsWith('22') || err.code.startsWith('42') || err.code === 'P0001') {
        return { status: 400, message: err.message.charAt(0).toUpperCase() + err.message.slice(1) };
      }
      return null;
  }
}

module.exports = { translate, CONSTRAINT_MESSAGES };
