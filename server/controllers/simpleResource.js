const db = require('../db');
const { listRows, readListQuery } = require('../lib/tables');
const { fail } = require('../lib/validate');

/**
 * CRUD for tables that are a flat list of fields with no side effects.
 * Anything that touches stock, money or messaging has its own controller.
 */
function simpleResource({ table, label, parse }) {
  async function findOrFail(id) {
    const { rows } = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (!rows.length) throw fail(`${label} not found`, 404);
    return rows[0];
  }

  return {
    async list(req, res, next) {
      try {
        res.json(await listRows(table, readListQuery(req.query)));
      } catch (err) {
        next(err);
      }
    },

    async get(req, res, next) {
      try {
        res.json(await findOrFail(req.params.id));
      } catch (err) {
        next(err);
      }
    },

    async create(req, res, next) {
      try {
        const fields = parse(req.body);
        const names = Object.keys(fields);
        const placeholders = names.map((_, i) => `$${i + 1}`);
        const { rows } = await db.query(
          `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
          Object.values(fields)
        );
        res.status(201).json(rows[0]);
      } catch (err) {
        next(err);
      }
    },

    async update(req, res, next) {
      try {
        await findOrFail(req.params.id);
        const fields = parse(req.body);
        const names = Object.keys(fields);
        const assignments = names.map((name, i) => `${name} = $${i + 1}`);
        const values = Object.values(fields);
        values.push(req.params.id);
        const { rows } = await db.query(
          `UPDATE ${table} SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING *`,
          values
        );
        res.json(rows[0]);
      } catch (err) {
        next(err);
      }
    },

    async remove(req, res, next) {
      try {
        await findOrFail(req.params.id);
        await db.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    },
  };
}

module.exports = { simpleResource };
