const api = require('./internalApi');
const knowledge = require('../knowledge');
const { parse: parseWhen, describe: describeWhen } = require('./parse/datetime');
const { parsePhone, formatPhone } = require('./parse/phone');
const { renderRecord } = require('./untrusted');
const { ToolError } = require('./records');

/**
 * The front desk's own tools: appointments, availability, knowledge, messages.
 *
 * This is a SEPARATE registry from the operator tools in tools.js, not a
 * filtered view of them. The build spec is emphatic about this and it is right:
 * a filter is one missed entry away from exposing something, and the entry that
 * gets missed is always the one added last by somebody who did not know the
 * filter existed. Two registries cannot drift into each other.
 *
 * What may never appear here, and is asserted by a test that walks the
 * registry: anything touching cost prices, margins, stock levels, purchase
 * orders, suppliers, settings, files, exports, backups, table structure or raw
 * SQL. If a future session wants to add one, it needs a line in memory.md
 * explaining why it is safe.
 *
 * Read tools run immediately. Write tools never do: prepare() resolves names,
 * validates, and returns a description a person can read, and the change only
 * happens when they confirm it. That is the Phase 5 rule, and it is what makes
 * a prompt injection hidden in a customer note survivable - the worst it
 * achieves is a proposal that gets declined.
 */

/**
 * The list endpoints do not agree on a name. DocDesk's generic table layer
 * answers with { rows }, the controllers written for the front desk answer with
 * { items }, and a tool that guesses wrong silently sees an empty list and
 * tells somebody the business offers nothing.
 */
function listOf(result) {
  return result?.rows || result?.items || [];
}

function obj(properties, required = []) {
  return { type: 'object', properties, required };
}

const money = (value, symbol = '') => `${symbol}${Number(value || 0).toFixed(2)}`;

/** Turns a spoken time into an instant, or explains why it could not. */
function resolveWhen(value, { timezone, openHour, closeHour }) {
  if (!value) return null;
  // An ISO timestamp from the model is taken at face value; anything else goes
  // through the parser rather than being guessed at.
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime()) && /\d{4}-\d{2}-\d{2}/.test(String(value))) {
    return { start: direct, needsConfirmation: false, assumptions: [] };
  }
  const parsed = parseWhen(String(value), { timezone, openHour, closeHour });
  if (!parsed) throw new ToolError(`I could not work out when "${value}" is. Ask for the day and time.`);
  return parsed;
}

async function shopContext() {
  const [settings, hours] = await Promise.all([
    api.get('/settings').then((s) => s.values).catch(() => ({})),
    api.get('/hours').then((h) => h.items || []).catch(() => []),
  ]);
  const open = hours.filter((h) => !h.resource_id);
  return {
    timezone: settings.timezone || 'UTC',
    currency: settings.currency_symbol || '',
    openHour: open.length ? Math.min(...open.map((h) => Number(String(h.open_time).slice(0, 2)))) : 9,
    closeHour: open.length ? Math.max(...open.map((h) => Number(String(h.close_time).slice(0, 2)))) : 18,
  };
}

/** Finds one service by name, and says so plainly when it cannot. */
async function findService(name) {
  const active = listOf(await api.get('/services', { pageSize: 100 })).filter((s) => s.is_active);
  if (!name) {
    if (active.length === 1) return active[0];
    throw new ToolError(`Which one? ${active.map((s) => s.name).join(', ')}`);
  }
  const needle = String(name).trim().toLowerCase();
  const exact = active.filter((s) => s.name.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];
  const partial = active.filter((s) => s.name.toLowerCase().includes(needle) || needle.includes(s.name.toLowerCase()));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) throw new ToolError(`That could be ${partial.map((s) => s.name).join(' or ')}. Which one?`);
  throw new ToolError(`There is nothing called "${name}". Available: ${active.map((s) => s.name).join(', ') || 'nothing yet'}.`);
}

async function findResource(name, serviceId) {
  const active = listOf(await api.get('/resources', { pageSize: 100 })).filter((r) => r.is_active);
  if (!name) return null; // null means "whoever is free"
  const needle = String(name).trim().toLowerCase();
  const matches = active.filter((r) => r.name.toLowerCase().includes(needle));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new ToolError(`Which one - ${matches.map((r) => r.name).join(' or ')}?`);
  throw new ToolError(`There is nobody called "${name}". ${active.map((r) => r.name).join(', ')}.`);
}

async function findCustomer(name) {
  if (!name) return null;
  const phone = parsePhone(name);
  const items = listOf(await api.get('/customers', { search: phone ? phone.national : String(name), pageSize: 10 }));
  if (!items.length) return null;
  if (items.length === 1) return items[0];
  const needle = String(name).trim().toLowerCase();
  const exact = items.filter((c) => c.name?.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];
  throw new ToolError(`There are ${items.length} people matching "${name}": ${items.slice(0, 5).map((c) => c.name).join(', ')}. Which one?`);
}

async function findAppointment({ reference, customer, when }) {
  if (reference) {
    const byReference = listOf(await api.get('/appointments', { search: String(reference), pageSize: 10 }));
    if (byReference.length === 1) return byReference[0];
  }
  const params = { pageSize: 50, from: new Date(Date.now() - 86400000).toISOString() };
  let candidates = listOf(await api.get('/appointments', params)).filter((a) => !['cancelled', 'completed', 'no_show'].includes(a.status));

  if (customer) {
    const needle = String(customer).trim().toLowerCase();
    candidates = candidates.filter((a) => a.customer_name?.toLowerCase().includes(needle));
  }
  if (when?.start) {
    const dayOf = (value) => new Date(value).toISOString().slice(0, 10);
    const target = dayOf(when.start);
    const sameDay = candidates.filter((a) => dayOf(a.starts_at) === target);
    if (sameDay.length) candidates = sameDay;
  }

  if (!candidates.length) throw new ToolError('I could not find that appointment. What name is it under?');
  if (candidates.length > 1) {
    throw new ToolError(
      `There are ${candidates.length} that could be it: ${candidates.slice(0, 4).map((a) => `${a.reference} (${a.customer_name || 'no name'}, ${new Date(a.starts_at).toISOString().slice(0, 16).replace('T', ' ')})`).join('; ')}. Which one?`
    );
  }
  return candidates[0];
}

const TOOLS = {
  // --- reading ------------------------------------------------------------

  get_business_info: {
    kind: 'read',
    description: "The business's name, address, phone and timezone.",
    parameters: obj({}),
    async run() {
      const { values } = await api.get('/settings');
      return {
        data: {
          name: values.business_name,
          address: values.business_address || null,
          phone: values.business_phone || null,
          email: values.business_email || null,
          timezone: values.timezone || null,
        },
      };
    },
  },

  get_opening_hours: {
    kind: 'read',
    description: 'When the business is open, and any days it is closed.',
    parameters: obj({}),
    async run() {
      const [{ items: hours }, { items: closures }] = await Promise.all([
        api.get('/hours'),
        api.get('/closures'),
      ]);
      const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return {
        data: {
          hours: hours.filter((h) => !h.resource_id).map((h) => ({
            day: names[h.weekday],
            open: String(h.open_time).slice(0, 5),
            close: String(h.close_time).slice(0, 5),
          })),
          closed_days: closures.map((c) => ({ from: c.starts_on, to: c.ends_on, reason: c.reason })),
        },
      };
    },
  },

  list_services: {
    kind: 'read',
    description: 'What can be booked, how long each takes and what it costs.',
    parameters: obj({}),
    async run() {
      const [services, context] = await Promise.all([api.get('/services', { pageSize: 100 }), shopContext()]);
      return {
        data: listOf(services).filter((s) => s.is_active).map((s) => ({
          name: s.name,
          minutes: s.duration_minutes,
          price: Number(s.price) > 0 ? money(s.price, context.currency) : 'not set',
          description: s.description || undefined,
        })),
      };
    },
  },

  check_availability: {
    kind: 'read',
    description: 'Free slots for a service. Use before offering a time.',
    parameters: obj({
      service: { type: 'string', description: 'The service name' },
      when: { type: 'string', description: 'A day or time in plain words, e.g. "next tuesday"' },
      person: { type: 'string', description: 'A particular person or room, if asked for' },
    }, ['service']),
    async run({ service, when, person }) {
      const context = await shopContext();
      const found = await findService(service);
      const resource = person ? await findResource(person, found.id) : null;

      const parsed = when ? resolveWhen(when, context) : null;
      const from = parsed?.start || new Date();
      const to = parsed?.end || new Date(from.getTime() + (parsed ? 86400000 : 7 * 86400000));

      const { items, timezone } = await api.get('/appointments/availability', {
        service_id: found.id,
        resource_id: resource?.id,
        from: from.toISOString(),
        to: to.toISOString(),
      });

      const shown = items.slice(0, 12).map((slot) => ({
        when: new Date(slot.starts_at).toLocaleString('en-GB', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }),
        with: slot.resource_name,
        iso: slot.starts_at,
      }));

      return {
        data: {
          service: found.name,
          slots: shown,
          total: items.length,
          note: items.length ? undefined : 'Nothing free in that range - try another day.',
        },
      };
    },
  },

  get_day_schedule: {
    kind: 'read',
    description: "What is booked on a given day, and who is waiting.",
    parameters: obj({ when: { type: 'string', description: 'A day in plain words, e.g. "tomorrow"' } }),
    async run({ when }) {
      const context = await shopContext();
      const parsed = when ? resolveWhen(when, context) : null;
      const date = parsed
        ? new Date(parsed.start).toLocaleDateString('en-CA', { timeZone: context.timezone })
        : undefined;

      const day = await api.get('/appointments/day', { date });
      return {
        data: {
          date: date || 'today',
          appointments: day.appointments.map((a) => ({
            reference: a.reference,
            time: new Date(a.starts_at).toLocaleTimeString('en-GB', { timeZone: day.timezone, hour: '2-digit', minute: '2-digit' }),
            who: a.customer_name || 'no name given',
            what: a.service_name,
            with: a.resource_name,
            status: a.status,
          })),
          waiting: day.waiting.length,
        },
      };
    },
  },

  find_appointment: {
    kind: 'read',
    description: 'Look up one appointment by reference, name or day.',
    parameters: obj({
      reference: { type: 'string', description: 'A booking reference like A-1004' },
      customer: { type: 'string', description: "The customer's name" },
      when: { type: 'string', description: 'The day it is on' },
    }),
    async run({ reference, customer, when }) {
      const context = await shopContext();
      const parsed = when ? resolveWhen(when, context) : null;
      const found = await findAppointment({ reference, customer, when: parsed });
      return {
        data: {
          reference: found.reference,
          who: found.customer_name || 'no name given',
          what: found.service_name,
          with: found.resource_name,
          when: new Date(found.starts_at).toLocaleString('en-GB', { timeZone: context.timezone, dateStyle: 'medium', timeStyle: 'short' }),
          status: found.status,
        },
      };
    },
  },

  search_knowledge: {
    kind: 'read',
    description: 'Look up what the business has written down. Use for ANY question of fact about the business, and say you are not sure if this finds nothing.',
    parameters: obj({ question: { type: 'string' } }, ['question']),
    async run({ question }) {
      const result = await knowledge.ask(question);
      if (!result.supported) {
        return {
          data: {
            found: false,
            // Worded as an instruction to the model on purpose: this is the one
            // tool result that has to change its behaviour rather than inform it.
            instruction: 'There is nothing written down that answers this. Do NOT answer from general knowledge. Say you are not sure and offer to take a message or fetch someone.',
          },
        };
      }
      return {
        data: {
          found: true,
          // Wrapped: a knowledge note is text a person typed, and the model is
          // reading it as data, not taking instructions from it.
          passages: result.chunks.slice(0, 3).map((c) => renderRecord({ from: c.title, text: c.content }, { fields: ['from', 'text'], label: 'knowledge note' })),
        },
      };
    },
  },

  check_product_availability: {
    kind: 'read',
    description: 'Whether an item is in stock, and its selling price.',
    parameters: obj({ item: { type: 'string' } }, ['item']),
    async run({ item }) {
      const [products, context] = await Promise.all([
        api.get('/products', { search: String(item), pageSize: 5 }),
        shopContext(),
      ]);
      const items = listOf(products);
      if (!items.length) return { data: { found: false, note: `Nothing matching "${item}".` } };

      // In stock yes or no, and the selling price. Never the count, never the
      // cost price, never the margin - see the forbidden list at the top.
      return {
        data: {
          items: items.map((product) => ({
            name: product.name,
            in_stock: Number(product.stock_quantity) > 0,
            price: Number(product.sale_price) > 0 ? money(product.sale_price, context.currency) : 'ask',
          })),
        },
      };
    },
  },

  find_customer: {
    kind: 'read',
    description: 'Look someone up by name or phone number.',
    parameters: obj({ who: { type: 'string' } }, ['who']),
    async run({ who }) {
      const found = await findCustomer(who);
      if (!found) return { data: { found: false } };
      const items = listOf(await api.get('/appointments', { customer_id: found.id, pageSize: 5 }));
      return {
        data: {
          found: true,
          name: found.name,
          phone: found.phone ? formatPhone(found.phone) : null,
          appointments: items.map((a) => ({ reference: a.reference, when: a.starts_at, status: a.status })),
        },
      };
    },
  },

  // --- proposing a change -------------------------------------------------
  // None of these run. Each returns a description; the change happens on Confirm.

  book_appointment: {
    kind: 'write',
    description: 'Propose a booking. The person confirms before anything is written.',
    parameters: obj({
      service: { type: 'string' },
      when: { type: 'string', description: 'Day and time in plain words or ISO' },
      customer: { type: 'string', description: "Who it is for" },
      person: { type: 'string', description: 'Who or what it is with, if specified' },
      notes: { type: 'string' },
    }, ['service', 'when']),
    async prepare({ service, when, customer, person, notes }) {
      const context = await shopContext();
      const found = await findService(service);
      const parsed = resolveWhen(when, context);
      const requested = parsed.start;

      // Offer only what is actually free. Proposing a taken slot and letting
      // the database refuse it on confirm wastes the person's time.
      const { items } = await api.get('/appointments/availability', {
        service_id: found.id,
        resource_id: person ? (await findResource(person, found.id))?.id : undefined,
        from: requested.toISOString(),
        to: new Date(requested.getTime() + 60 * 60 * 1000).toISOString(),
      });
      const slot = items.find((s) => new Date(s.starts_at).getTime() === requested.getTime());
      if (!slot) {
        const nearby = await api.get('/appointments/availability', {
          service_id: found.id,
          from: new Date(requested.getTime() - 4 * 3600000).toISOString(),
          to: new Date(requested.getTime() + 8 * 3600000).toISOString(),
        });
        const options = nearby.items.slice(0, 4).map((s) =>
          new Date(s.starts_at).toLocaleTimeString('en-GB', { timeZone: context.timezone, hour: '2-digit', minute: '2-digit' })
        );
        throw new ToolError(
          options.length
            ? `That time is not free. Nearby: ${options.join(', ')}.`
            : 'Nothing is free anywhere near that time.'
        );
      }

      const existing = customer ? await findCustomer(customer) : null;
      const lines = [
        ['Service', found.name],
        ['When', describeWhen(parsed, context.timezone)],
        ['With', slot.resource_name],
        ['For', existing ? existing.name : customer || 'no name given'],
      ];
      if (Number(found.price) > 0) lines.push(['Price', money(found.price, context.currency)]);
      if (parsed.assumptions?.length) lines.push(['Read as', parsed.assumptions.join('; ')]);

      return {
        title: 'Book an appointment',
        summary: `Book ${found.name} for ${existing?.name || customer || 'a walk-in'} on ${describeWhen(parsed, context.timezone)}`,
        lines,
        needsConfirmation: parsed.needsConfirmation,
        async run() {
          const created = await api.post('/appointments', {
            service_id: found.id,
            resource_id: slot.resource_id,
            starts_at: slot.starts_at,
            customer_id: existing?.id || null,
            status: 'confirmed',
            source: 'receptionist',
            notes: notes || null,
          });
          return {
            message: `Booked. ${created.reference}, ${found.name} on ${describeWhen(parsed, context.timezone)}.`,
            data: { reference: created.reference },
            refresh: ['appointments'],
          };
        },
      };
    },
  },

  reschedule_appointment: {
    kind: 'write',
    description: 'Propose moving an appointment to a new time.',
    parameters: obj({
      reference: { type: 'string' },
      customer: { type: 'string' },
      when: { type: 'string', description: 'The new day and time' },
      reason: { type: 'string' },
    }, ['when']),
    async prepare({ reference, customer, when, reason }) {
      const context = await shopContext();
      const found = await findAppointment({ reference, customer });
      const parsed = resolveWhen(when, context);

      return {
        title: 'Move an appointment',
        summary: `Move ${found.reference} to ${describeWhen(parsed, context.timezone)}`,
        lines: [
          ['Appointment', `${found.reference} - ${found.service_name}`],
          ['For', found.customer_name || 'no name given'],
          ['From', new Date(found.starts_at).toLocaleString('en-GB', { timeZone: context.timezone, dateStyle: 'medium', timeStyle: 'short' })],
          ['To', describeWhen(parsed, context.timezone)],
          ...(reason ? [['Reason', reason]] : []),
        ],
        needsConfirmation: parsed.needsConfirmation,
        async run() {
          await api.post(`/appointments/${found.id}/reschedule`, {
            starts_at: parsed.start.toISOString(),
            reason: reason || null,
          });
          return {
            message: `Moved ${found.reference} to ${describeWhen(parsed, context.timezone)}.`,
            data: { reference: found.reference },
            refresh: ['appointments'],
          };
        },
      };
    },
  },

  cancel_appointment: {
    kind: 'write',
    destructive: true,
    description: 'Propose cancelling an appointment.',
    parameters: obj({
      reference: { type: 'string' },
      customer: { type: 'string' },
      reason: { type: 'string' },
    }),
    async prepare({ reference, customer, reason }) {
      const context = await shopContext();
      const found = await findAppointment({ reference, customer });
      return {
        title: 'Cancel an appointment',
        summary: `Cancel ${found.reference}`,
        destructive: true,
        lines: [
          ['Appointment', `${found.reference} - ${found.service_name}`],
          ['For', found.customer_name || 'no name given'],
          ['When', new Date(found.starts_at).toLocaleString('en-GB', { timeZone: context.timezone, dateStyle: 'medium', timeStyle: 'short' })],
          ...(reason ? [['Reason', reason]] : []),
        ],
        async run() {
          await api.post(`/appointments/${found.id}/status`, { status: 'cancelled', reason: reason || null });
          return {
            message: `Cancelled ${found.reference}. The slot is free again.`,
            data: { reference: found.reference },
            refresh: ['appointments'],
          };
        },
      };
    },
  },

  mark_arrived: {
    kind: 'write',
    description: 'Propose marking someone as arrived, finished, or a no-show.',
    parameters: obj({
      reference: { type: 'string' },
      customer: { type: 'string' },
      status: { type: 'string', enum: ['arrived', 'completed', 'no_show'] },
    }, ['status']),
    async prepare({ reference, customer, status }) {
      const found = await findAppointment({ reference, customer });
      const said = { arrived: 'arrived', completed: 'finished', no_show: 'did not turn up' }[status] || status;
      return {
        title: 'Update an appointment',
        summary: `Mark ${found.reference} as ${said}`,
        lines: [['Appointment', `${found.reference} - ${found.service_name}`], ['For', found.customer_name || 'no name given'], ['Now', said]],
        async run() {
          await api.post(`/appointments/${found.id}/status`, { status });
          return { message: `${found.reference} marked ${said}.`, data: {}, refresh: ['appointments'] };
        },
      };
    },
  },

  leave_message: {
    kind: 'write',
    description: 'Propose taking a message for someone to deal with later.',
    parameters: obj({
      message: { type: 'string' },
      from: { type: 'string', description: 'Who it is from' },
      contact: { type: 'string', description: 'A phone number or email to reply on' },
    }, ['message']),
    async prepare({ message, from, contact }) {
      const phone = contact ? parsePhone(contact) : null;
      return {
        title: 'Take a message',
        summary: `Take a message from ${from || 'a caller'}`,
        lines: [
          ['From', from || 'not given'],
          ['Contact', phone ? formatPhone(phone.e164) : contact || 'not given'],
          ['Message', message],
        ],
        async run() {
          const created = await api.post('/messages', {
            channel: phone ? 'sms' : 'email',
            recipient: phone ? phone.e164 : contact || null,
            subject: `Message from ${from || 'a caller'}`,
            body: message,
            trigger_type: 'reception_message',
          });
          return { message: 'Message saved - it is on the Messages page.', data: { id: created?.id }, refresh: ['message_log'] };
        },
      };
    },
  },

  create_lead: {
    kind: 'write',
    description: 'Propose recording somebody who is not a customer yet.',
    parameters: obj({
      name: { type: 'string' },
      contact: { type: 'string' },
      note: { type: 'string' },
    }, ['name']),
    async prepare({ name, contact, note }) {
      const phone = contact ? parsePhone(contact) : null;
      return {
        title: 'Record a new contact',
        summary: `Record ${name}`,
        lines: [['Name', name], ['Contact', phone ? formatPhone(phone.e164) : contact || 'not given'], ...(note ? [['Note', note]] : [])],
        async run() {
          const created = await api.post('/leads', {
            name,
            phone: phone ? phone.e164 : null,
            email: contact && contact.includes('@') ? contact : null,
            note: note || null,
            source: 'receptionist',
          });
          return { message: `${name} recorded. Turn them into a customer from the Front Desk when they book.`, data: { id: created?.id }, refresh: ['leads'] };
        },
      };
    },
  },
};

/**
 * Everything this registry must never contain. Asserted by a test that walks
 * the registry rather than trusted to review.
 */
const FORBIDDEN = [
  'run_query', 'execute_sql', 'sql', 'backup_database', 'restore', 'change_table_structure',
  'update_settings', 'export_table', 'adjust_stock', 'create_purchase_order', 'receive_purchase_order',
  'delete_record', 'database_overview', 'list_suppliers', 'cost_price', 'margin', 'stock_count',
];

function toolDefinitions() {
  return Object.entries(TOOLS).map(([name, tool]) => ({
    type: 'function',
    function: { name, description: tool.description, parameters: tool.parameters },
  }));
}

module.exports = { TOOLS, toolDefinitions, FORBIDDEN, findService, findResource, findCustomer, findAppointment, shopContext };
