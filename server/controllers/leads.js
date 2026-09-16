const db = require('../db');
const { simpleResource } = require('./simpleResource');
const { text, email, id, fail } = require('../lib/validate');

/**
 * People who have been dealt with but are not customers yet.
 *
 * Promoting one to a customer is deliberately a person's decision, never
 * automatic. Two people share a phone number all the time, and merging the
 * wrong pair puts one person's appointment history in front of another.
 */
const leads = simpleResource({
  table: 'leads',
  label: 'Contact',
  parse: (body) => ({
    name: text(body.name, 'Name', { max: 150 }),
    phone: text(body.phone, 'Phone', { max: 40 }),
    email: email(body.email),
    source: text(body.source, 'Source', { max: 40 }) || 'receptionist',
    note: text(body.note, 'Note', { max: 2000 }),
  }),
});

module.exports = {
  ...leads,

  /** Turns a lead into a real customer, in one step, on purpose. */
  async convert(req, res, next) {
    try {
      const leadId = id(req.params.id, 'Contact');
      const result = await db.transaction(async (tx) => {
        const { rows } = await tx.query('SELECT * FROM leads WHERE id = $1', [leadId]);
        if (!rows.length) throw fail('That contact is not there', 404);
        const lead = rows[0];
        if (lead.converted_customer_id) throw fail('That contact is already a customer');

        const { rows: created } = await tx.query(
          `INSERT INTO customers (name, phone, email, notes) VALUES ($1, $2, $3, $4) RETURNING *`,
          [lead.name || 'Unnamed', lead.phone, lead.email, lead.note]
        );
        await tx.query('UPDATE leads SET converted_customer_id = $2 WHERE id = $1', [leadId, created[0].id]);
        return created[0];
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};
