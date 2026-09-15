const db = require('../db');
const { listRows, readListQuery } = require('../lib/tables');
const { fail, version } = require('../lib/validate');

/**
 * CRUD for tables that are a flat list of fields with no side effects.
 * Anything that touches stock, money or messaging has its own controller.
 *
 * Updates use optimistic locking: a form sends back the row_version it was
 * loaded with, and if someone else saved in between, the update matches no row
 * and the person is told instead of silently overwriting the other change.
 */
function simpleResource({ table, label, parse }) {
  async function findOrFail(id) {
    const { rows } = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (!rows.length) throw fail(`${label} not found`, 404);
    return rows[0];
  }

  return {
    findOrFail,

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
        const fields = parse(req.body || {});
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
        const current = await findOrFail(req.params.id);
        const fields = parse(req.body || {});
        const names = Object.keys(fields);
        const values = Object.values(fields);
        const assignments = names.map((name, i) => `${name} = $${i + 1}`);
        values.push(req.params.id);
        let sql = `UPDATE ${table} SET ${assignments.join(', ')} WHERE id = $${values.length}`;

        const expected = version(req.body?.row_version);
        if (expected && current.row_version !== undefined) {
          values.push(expected);
          sql += ` AND row_version = $${values.length}`;
        }
        const { rows } = await db.query(`${sql} RETURNING *`, values);
        if (!rows.length) {
          const latest = await findOrFail(req.params.id);
          const err = fail(`${latest.name || label} was changed by someone else after you opened it. Your edits were not saved - reload to see the latest.`, 409);
          err.conflict = latest;
          throw err;
        }
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
