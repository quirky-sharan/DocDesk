const crypto = require('crypto');
const { chat, LlmError } = require('../llm');
const businessTools = require('./tools');
const frontDesk = require('./frontdesk');
const { ToolError } = require('./records');
const { envelopeInstructions } = require('./untrusted');
const { classify, compare } = require('./rules');
const conversations = require('./conversation');
const { INTENTS } = require('./intents');
const { detectEmergency, detectAdviceRequest } = require('./emergency');

/**
 * Two registries, composed - never one registry with a filter over it.
 *
 * The front desk's tools are their own module with their own rules about what
 * may never appear in them. Merging them here is a lookup, not a merge of the
 * definitions: each side keeps its own file, its own tests and its own list of
 * what it must not contain, so neither can quietly grow into the other.
 */
const TOOLS = { ...businessTools.TOOLS, ...frontDesk.TOOLS };
const toolDefinitions = () => [...businessTools.toolDefinitions(), ...frontDesk.toolDefinitions()];
const { listColumns } = require('../tables');
const api = require('./internalApi');

const MAX_STEPS = 8;
const MAX_HISTORY = 24;
const MAX_TOOL_RESULT_CHARS = 3500;
// Tool results from earlier turns are shrunk hard: the model already acted on
// them, and they are the biggest drain on the per-minute token allowance.
const OLD_TOOL_RESULT_CHARS = 280;
const PENDING_TTL_MS = 30 * 60 * 1000;

// Changes awaiting a click. Held server-side so the browser can only say "yes"
// or "no" to exactly what was described - it can't swap in a different action.
const pending = new Map();

function prunePending() {
  const now = Date.now();
  for (const [id, entry] of pending) {
    if (now - entry.createdAt > PENDING_TTL_MS) pending.delete(id);
  }
}

async function systemPrompt(page) {
  const [settings, products, customers, suppliers] = await Promise.all([
    api.get('/settings').then((s) => s.values).catch(() => ({})),
    listColumns('products'),
    listColumns('customers'),
    listColumns('suppliers'),
  ]);
  const cols = (table) => table
    .map((c) => c.name)
    .filter((n) => !['id', 'is_active', 'updated_at', 'row_version'].includes(n) && !n.endsWith('_id'))
    .join(', ');
  const now = new Date();

  return `You are the front-desk receptionist for ${settings.business_name || 'this business'}, working inside DocDesk - the shop's inventory, sales and records app. You are talking to the shop owner or their staff, who are not technical.

Right now: ${now.toDateString()}, ${now.toTimeString().slice(0, 5)}. The user is looking at the "${page || '/'}" page.
${settings.currency_symbol ? `Currency symbol: "${settings.currency_symbol}" - put it in front of money amounts.` : 'No currency symbol is set: write money as plain numbers like 1250.00, with no symbol and no currency name.'} Default tax rate: ${settings.default_tax_rate || 0}%.

What's in the database:
- products: ${cols(products)}
- customers: ${cols(customers)}
- suppliers: ${cols(suppliers)}
- sales (receipts S-xxxx, with line items and payments - part payments and refunds are recorded as payments), purchase_orders (PO-xxxx, stock ordered from suppliers), files (uploaded documents), message_log (queued alerts).
- The database is PostgreSQL: every stock change is in a ledger and every edit in an audit trail. It can be backed up. When no other tool answers a question, run_query reads it with one SELECT.

The front desk, which is yours to run:
- services (what can be booked), resources (the people, rooms or chairs it is booked against), opening hours and closed days.
- appointments (A-xxxx). Availability is worked out by the database, never by you: call check_availability and offer only what it returns. Never say a time is free because it sounds free.
- the knowledge base: what this business has actually written down about itself.

How to work:
1. Use tools for every fact about the business. Never guess a number, name, price, stock level or id.
1a. For any question of fact about the business - hours, policies, what is offered, anything a customer might ask - call search_knowledge FIRST. If it comes back with nothing, say you are not sure and offer to take a message or fetch someone. Do not answer from general knowledge. An invented opening time is worse than no answer.
1b. Dates and times are already worked out for you by the tools. Pass what the person actually said ("next tuesday at 4") straight through rather than converting it yourself.
2. Refer to things by name. If a name matches several records or none, say so and ask - don't pick one.
3. Change tools and get_details look records up by name themselves - call them directly; don't search first just to find something you're about to act on. To change anything, call the matching tool. The app shows the user a confirmation card; the change only happens when they click Confirm. Never say something is done until a tool result says it was confirmed and completed. After proposing a change, tell them briefly to check the card.
4. When the user wants to see, sort, filter or find a list, use show_on_page so it appears on screen, then summarise what's there in one or two lines.
5. If the user asks to go to a page or see something as well as change something, call navigate or show_on_page in the SAME response as the change tool - page moves run immediately, changes wait for confirmation. For other multi-step requests, do the steps in order. If a step needs confirmation, stop and wait; you'll be told when it's confirmed.
6. Keep replies short, warm and plain: no jargon, no SQL, no JSON, no internal ids. Use short bullet lists for several items. Money to 2 decimal places.
7. ${envelopeInstructions()}
8. If something can't be done in DocDesk, say so plainly and suggest the nearest thing that can.
9. Never give medical, legal or financial advice, whatever the wording. Offer the earliest appointment or a person instead. If someone describes an emergency, tell them to call the emergency services now - do not assess, reassure or suggest waiting.
10. Never promise a discount, a price that is not in the system, or a delivery date. You cannot authorise anything the business has not already agreed to.`;
}

/**
 * The receptionist's own settings, with defaults that work before anyone has
 * opened the settings page. Read through the API so it picks up a change
 * without a restart.
 */
async function receptionistSettings() {
  const values = await api.get('/settings').then((s) => s.values).catch(() => ({}));
  const hours = await api.get('/hours').then((h) => (h.items || []).filter((row) => !row.resource_id)).catch(() => []);
  const phrases = String(values.receptionist_emergency_phrases || '')
    .split(/[\n,]/)
    .map((phrase) => phrase.trim())
    .filter(Boolean);

  return {
    timezone: values.timezone || 'UTC',
    emergencyPhrases: phrases.length ? phrases : null,
    emergencyResponse: values.receptionist_emergency_response || null,
    openHour: hours.length ? Math.min(...hours.map((h) => Number(String(h.open_time).slice(0, 2)))) : 9,
    closeHour: hours.length ? Math.max(...hours.map((h) => Number(String(h.close_time).slice(0, 2)))) : 18,
  };
}

/**
 * Which intent a tool call implies, so the model's behaviour can be compared
 * with what the rules expected. The model never names an intent - it calls a
 * tool - and this is the honest way to read one out of that.
 */
const TOOL_INTENT = {
  book_appointment: 'book_appointment',
  reschedule_appointment: 'reschedule',
  cancel_appointment: 'cancel',
  find_appointment: 'check_appointment',
  get_day_schedule: 'check_appointment',
  check_availability: 'book_appointment',
  get_opening_hours: 'opening_hours',
  get_business_info: 'location_directions',
  list_services: 'service_enquiry',
  check_product_availability: 'product_availability',
  leave_message: 'leave_message',
  create_lead: 'leave_message',
  find_customer: 'order_status',
};

/**
 * What the receptionist can still do when no model will answer.
 *
 * This is the promise in the build spec made real: revoke every key, exhaust
 * every free allowance, pull the network cable, and hours, services, the
 * address and the day's diary still come back - because those are database
 * questions that the rules classifier can recognise and a tool can answer
 * without anything being generated.
 *
 * Everything else becomes "I'll take a message", which is a working
 * receptionist rather than an error page. There is never a dead end.
 */
async function deterministicTurn(ruleRead, { conversationId, reason }) {
  const intent = ruleRead?.intent || 'other';
  const say = async (tool, args, format) => {
    try {
      const result = await TOOLS[tool].run(args || {});
      return format(result.data);
    } catch {
      return null;
    }
  };

  let reply = null;

  if (intent === 'opening_hours') {
    reply = await say('get_opening_hours', {}, (data) => {
      if (!data.hours?.length) return null;
      const days = data.hours.map((h) => `${h.day}: ${h.open}–${h.close}`).join('\n');
      const shut = data.closed_days?.length
        ? `\n\nClosed: ${data.closed_days.map((c) => c.from + (c.reason ? ` (${c.reason})` : '')).join(', ')}`
        : '';
      return `Opening hours:\n${days}${shut}`;
    });
  } else if (intent === 'service_enquiry' || intent === 'price_enquiry') {
    reply = await say('list_services', {}, (data) => {
      if (!data?.length) return null;
      return `What can be booked:\n${data.map((s) => `- ${s.name}, ${s.minutes} minutes, ${s.price}`).join('\n')}`;
    });
  } else if (intent === 'location_directions') {
    reply = await say('get_business_info', {}, (data) => {
      if (data.address) return `${data.name}\n${data.address}${data.phone ? `\nPhone: ${data.phone}` : ''}`;
      // Saying "I can only answer where you are" and then not answering it is
      // worse than admitting the address was never filled in.
      return `No address has been saved for ${data.name || 'the business'} yet - it goes in Settings.`;
    });
  } else if (intent === 'check_appointment') {
    reply = await say('get_day_schedule', {}, (data) => {
      if (!data.appointments?.length) return 'Nothing is booked for today.';
      return `Today:\n${data.appointments.map((a) => `- ${a.time} ${a.who} (${a.what})`).join('\n')}`;
    });
  }

  await conversations.addEvent(conversationId, 'model_switch', {
    to: 'rules', reason, intent, answered: Boolean(reply),
  });

  if (reply) {
    return {
      reply,
      // Said once, quietly, and only to the owner - they should know the answer
      // came from the records rather than from a model that was thinking.
      blocks: [{ type: 'note', text: 'Answered from your records - the AI service is unavailable right now.' }],
      handledWithoutModel: true,
    };
  }

  return {
    reply: "I can't reach the AI service at the moment, so I can only answer from your records - "
      + 'opening hours, what you offer, where you are, and what is booked today. '
      + 'For anything else, tell me and I will take it down as a message.',
    blocks: [],
    handledWithoutModel: true,
  };
}

/** Keeps history bounded without leaving a tool result orphaned from its call. */
function trimHistory(messages) {
  if (messages.length <= MAX_HISTORY) return messages;
  let start = messages.length - MAX_HISTORY;
  while (start < messages.length && messages[start].role !== 'user') start++;
  return messages.slice(start);
}

/** Shrinks tool results that belong to turns before the latest user message. */
function compressOlderTurns(messages) {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUser = i;
      break;
    }
  }
  return messages.map((m, i) =>
    i < lastUser && m.role === 'tool' && m.content.length > OLD_TOOL_RESULT_CHARS
      ? { ...m, content: `${m.content.slice(0, OLD_TOOL_RESULT_CHARS)}…(older result shortened)` }
      : m
  );
}

/** Only fields the API accepts go back in; providers reject extras like `reasoning`. */
function cleanAssistantMessage(message) {
  const out = { role: 'assistant', content: message.content ?? '' };
  if (message.tool_calls?.length) {
    out.tool_calls = message.tool_calls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.function.name, arguments: c.function.arguments || '{}' },
    }));
  }
  return out;
}

function sanitiseIncoming(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    if (m.role === 'user' && typeof m.content === 'string') out.push({ role: 'user', content: m.content.slice(0, 4000) });
    else if (m.role === 'assistant') out.push(cleanAssistantMessage(m));
    else if (m.role === 'tool' && m.tool_call_id) {
      out.push({ role: 'tool', tool_call_id: String(m.tool_call_id), content: String(m.content ?? '').slice(0, MAX_TOOL_RESULT_CHARS) });
    }
  }
  // A history that starts mid tool-exchange is invalid for the API.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function toolContent(value) {
  const text = JSON.stringify(value);
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…(truncated)` : text;
}

function parseArgs(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new ToolError('The tool arguments were not valid JSON. Try again.');
  }
}

/**
 * Runs the model/tool loop for one user turn.
 * Returns { reply, messages, blocks, actions, pending, model, steps }.
 */
/**
 * The checks that run before a model is ever asked.
 *
 * Deliberately first, and deliberately not a prompt instruction. An emergency
 * has to be recognised when every provider is down, the key has been revoked
 * and the internet is off - so it is string matching against a list the owner
 * controls, and it returns without sending anything anywhere.
 *
 * @returns {null|object} a finished turn, when the turn is over before it began
 */
async function safetyFirst(userText, { conversationId, settings }) {
  if (!userText) return null;

  const emergency = detectEmergency(userText, {
    phrases: settings.emergencyPhrases,
    response: settings.emergencyResponse,
  });
  if (emergency) {
    await conversations.addEvent(conversationId, 'emergency', { matched: emergency.matched });
    await conversations.escalate(conversationId, 'an emergency was described');
    return {
      reply: emergency.response,
      blocks: [{ type: 'alert', tone: 'danger', title: 'Emergency', body: 'This has been flagged in the Front Desk. Deal with it now.' }],
      urgent: true,
      escalated: true,
      handledWithoutModel: true,
    };
  }

  const advice = detectAdviceRequest(userText);
  if (advice) {
    await conversations.addEvent(conversationId, 'guardrail', { kind: 'advice_refused', subject: advice.kind });
    return {
      reply: advice.response,
      blocks: [],
      escalated: false,
      handledWithoutModel: true,
    };
  }

  return null;
}

async function runTurn({ messages: incoming, userText, page, continuation, maxWaitMs, conversationId = null }) {
  prunePending();
  const history = sanitiseIncoming(incoming);
  if (userText) history.push({ role: 'user', content: String(userText).slice(0, 4000) });
  if (continuation) history.push({ role: 'user', content: continuation });

  // What the rules think, worked out on every turn whatever happens next: it is
  // the floor when there is no model, and a check on the model when there is.
  const settings = await receptionistSettings();
  const ruleRead = userText ? classify(userText, { timezone: settings.timezone, openHour: settings.openHour, closeHour: settings.closeHour }) : null;

  if (userText) {
    await conversations.addMessage(conversationId, {
      role: 'caller', content: userText, origin: 'internal',
      confidence: ruleRead?.confidence ?? null,
    });
  }

  const stopped = await safetyFirst(userText, { conversationId, settings });
  if (stopped) {
    history.push({ role: 'assistant', content: stopped.reply });
    await conversations.addMessage(conversationId, { role: 'receptionist', content: stopped.reply, origin: 'internal' });
    return {
      ...stopped,
      messages: trimHistory(history),
      actions: [],
      activity: [],
      pending: [],
      model: null,
      intent: ruleRead?.intent ?? null,
      conversationId,
    };
  }

  const system = { role: 'system', content: await systemPrompt(page) };
  const currencySymbol = await api.get('/settings').then((r) => r.values.currency_symbol).catch(() => '');
  const tools = toolDefinitions();

  const blocks = [];
  const actions = [];
  const activity = [];
  const proposals = [];
  // Models occasionally repeat an identical call in one turn. Answer the repeat
  // from memory so it neither costs a request nor shows a duplicate card.
  const seenCalls = new Map();
  let model = null;
  let reply = '';

  for (let step = 0; step < MAX_STEPS; step++) {
    let result;
    try {
      result = await chat({
        messages: [system, ...compressOlderTurns(trimHistory(history))],
        tools,
        temperature: 0.2,
        maxTokens: 900,
        maxWaitMs,
        conversationId,
      });
    } catch (err) {
      // No model would answer: out of allowance, no key, offline, or told to
      // work without one. Fall to what the records can answer rather than
      // handing back an error - but only at the start of a turn. Losing the
      // model half way through a tool sequence means the reply would be built
      // on an incomplete picture, and a wrong answer is worse than an honest
      // "try again".
      if (!(err instanceof LlmError) || step > 0) throw err;
      const fallback = await deterministicTurn(ruleRead, { conversationId, reason: err.errorClass });
      history.push({ role: 'assistant', content: fallback.reply });
      await conversations.addMessage(conversationId, { role: 'receptionist', content: fallback.reply, origin: 'internal' });
      return {
        ...fallback,
        messages: trimHistory(history),
        actions: [],
        activity: [],
        pending: [],
        model: null,
        intent: ruleRead?.intent ?? null,
        conversationId,
      };
    }
    model = result.model;
    const message = result.message;
    if (result.usage) {
      console.log(`[receptionist] step ${step + 1} ${result.model} ${result.usage.prompt_tokens}+${result.usage.completion_tokens} tokens ${result.latencyMs}ms`);
    }
    history.push(cleanAssistantMessage(message));

    if (!message.tool_calls?.length) {
      reply = (message.content || '').trim();
      break;
    }

    for (const call of message.tool_calls) {
      const name = call.function?.name;
      const tool = TOOLS[name];
      let content;

      try {
        if (!tool) throw new ToolError(`There is no tool called "${name}".`);
        const args = parseArgs(call.function.arguments);
        const signature = `${name}:${JSON.stringify(args)}`;

        if (seenCalls.has(signature)) {
          content = seenCalls.get(signature);
        } else if (tool.kind === 'write') {
          const plan = await tool.prepare(args);
          const id = crypto.randomUUID();
          pending.set(id, { plan, tool: name, createdAt: Date.now() });
          proposals.push({
            id,
            tool: name,
            title: plan.title,
            summary: plan.summary,
            lines: plan.lines,
            destructive: Boolean(plan.destructive || tool.destructive),
          });
          content = {
            status: 'awaiting_user_confirmation',
            summary: plan.summary,
            note: 'Not done yet. The user sees a confirmation card. Do not say it is done.',
          };
          activity.push({ tool: name, label: plan.summary, state: 'proposed' });
        } else {
          const output = await tool.run(args);
          if (output.block) blocks.push(output.block);
          if (output.clientAction) actions.push(output.clientAction);
          content = { ok: true, ...(output.data !== undefined ? { result: output.data } : {}) };
          activity.push({ tool: name, state: 'done' });
        }
        seenCalls.set(signature, content);
      } catch (err) {
        // Tool failures go back to the model as information so it can fix its
        // call or ask the user, rather than ending the conversation.
        const known = err instanceof ToolError || err.status;
        content = { ok: false, error: known ? err.message : 'That step failed unexpectedly.' };
        if (!known) console.error(`[receptionist] ${name} failed:`, err);
        activity.push({ tool: name, state: 'failed', label: content.error });
      }

      history.push({ role: 'tool', tool_call_id: call.id, content: toolContent(content) });
    }

    if (proposals.length) {
      // Stop here: anything after a proposed change may depend on it.
      reply = proposals.length === 1
        ? `Here's what I'll do — check the details and confirm.`
        : `I've prepared ${proposals.length} changes — check each one and confirm.`;
      history.push({ role: 'assistant', content: reply });
      break;
    }

    if (step === MAX_STEPS - 1) {
      reply = "That took more steps than I'm allowed in one go. Could you break it into smaller requests?";
      history.push({ role: 'assistant', content: reply });
    }
  }

  // Models sometimes add a currency the shop never set up. Strip it rather than
  // let a receipt amount read as the wrong currency.
  if (!currencySymbol) {
    reply = reply.replace(/(?:₹|Rs\.?|INR|\$|USD|€|£)\s?(?=\d)/g, '');
  }

  // What the model actually did, read out of the tools it reached for, and
  // compared with what the rules expected. Recorded on every turn: a rising
  // disagreement rate is how prompt drift shows up before a customer finds it.
  const modelIntent = activity.map((step) => TOOL_INTENT[step.tool]).find(Boolean) || null;
  if (ruleRead && userText) {
    const agreement = compare(ruleRead, modelIntent);
    if (agreement.meaningful || agreement.agree) {
      await conversations.addEvent(conversationId, 'rules_disagreement', {
        agree: agreement.agree,
        rules: ruleRead.intent,
        model: modelIntent,
        confidence: ruleRead.confidence,
        reason: agreement.reason,
      });
    }
    await conversations.addEvent(conversationId, 'intent', {
      intent: modelIntent || ruleRead.intent,
      from: modelIntent ? 'model' : 'rules',
      confidence: ruleRead.confidence,
    });
  }

  await conversations.addMessage(conversationId, {
    role: 'receptionist', content: reply || 'Done.', origin: 'internal', model,
    toolCalls: activity.length ? activity : null,
  });

  return {
    reply: reply || 'Done.',
    messages: trimHistory(history),
    blocks,
    actions,
    activity,
    pending: proposals,
    model,
    intent: modelIntent || ruleRead?.intent || null,
    conversationId,
  };
}

function stillWaiting(openIds = [], exceptId) {
  const summaries = openIds
    .filter((openId) => openId !== exceptId && pending.has(openId))
    .map((openId) => pending.get(openId).plan.summary);
  return summaries.length
    ? ` These are still waiting on the user's confirmation - do NOT propose them again: ${summaries.map((x) => `"${x}"`).join(', ')}.`
    : '';
}

async function confirmAction({ id, messages, page, openIds }) {
  prunePending();
  const entry = pending.get(id);
  if (!entry) {
    const err = new Error('That confirmation has expired or was already used. Ask again.');
    err.status = 410;
    throw err;
  }
  pending.delete(id);

  let outcome;
  try {
    outcome = await entry.plan.run();
  } catch (err) {
    // Tell the model it failed so its follow-up is accurate.
    const failure = err.message || 'The change could not be made.';
    const history = sanitiseIncoming(messages);
    history.push({ role: 'user', content: `(System note: the user confirmed "${entry.plan.summary}", but it failed: ${failure})` });
    const reply = `That didn't go through: ${failure}`;
    history.push({ role: 'assistant', content: reply });
    return {
      reply,
      messages: trimHistory(history),
      blocks: [],
      actions: [],
      activity: [],
      pending: [],
      model: null,
      confirmed: { ok: false, summary: entry.plan.summary, error: failure },
    };
  }

  const note =
    `(System note: the user confirmed "${entry.plan.summary}" and it succeeded: ${outcome.message} ` +
    `Result: ${toolContent(outcome.data || {})}.${stillWaiting(openIds, id)} If the original request has more steps, continue with them; ` +
    'otherwise reply with one short sentence confirming it is done.)';

  let turn;
  try {
    // Short wait only: the change is already made, so don't hold the user up
    // waiting for the AI to phrase a follow-up.
    turn = await runTurn({ messages, page, continuation: note, maxWaitMs: 4000 });
  } catch (err) {
    console.warn(`[receptionist] follow-up after confirm skipped: ${err.message}`);
    const history = sanitiseIncoming(messages);
    history.push({ role: 'user', content: note });
    history.push({ role: 'assistant', content: outcome.message });
    turn = {
      reply: outcome.message,
      messages: trimHistory(history),
      blocks: [],
      actions: [],
      activity: [],
      pending: [],
      model: null,
      followUpSkipped: true,
    };
  }

  const PAGE_FOR = {
    products: ['/inventory', 'Inventory'], customers: ['/customers', 'Customers'], suppliers: ['/suppliers', 'Suppliers'],
    sales: ['/sales', 'Sales'], purchase_orders: ['/orders', 'Incoming stock'], message_log: ['/messages', 'Messages'],
    settings: ['/settings', 'Settings'],
  };
  const target = PAGE_FOR[(outcome.refresh || [])[0]];
  const linkBlock = target && target[0] !== page ? [{ type: 'link', label: `Open ${target[1]}`, path: target[0] }] : [];

  return {
    ...turn,
    blocks: [...(outcome.block ? [outcome.block] : []), ...linkBlock, ...turn.blocks],
    actions: [{ type: 'refresh', tables: outcome.refresh || [] }, ...turn.actions],
    confirmed: { ok: true, summary: entry.plan.summary, message: outcome.message },
  };
}

function cancelAction({ id }) {
  const entry = pending.get(id);
  pending.delete(id);
  return { cancelled: Boolean(entry), summary: entry?.plan.summary || null };
}

module.exports = { runTurn, confirmAction, cancelAction, LlmError };
