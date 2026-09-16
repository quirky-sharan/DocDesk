/**
 * The intent taxonomy: fixed, closed, and the dialogue policy in one table.
 *
 * The model picks one of these. It does not invent one. Each entry declares
 * what has to be known before anything can happen, which tier of model is
 * enough to handle it, which tools it may reach for, whether it may end in a
 * change, and when it has to stop and fetch a person.
 *
 * That last part is the point of putting it in a table rather than a prompt.
 * Adding an intent should be a data change: a new row, a new rule, tested.
 * Prompt text that quietly accumulates special cases is how a system becomes
 * impossible to reason about.
 */

/**
 * Slots are the facts a request needs before it can be acted on.
 * `ask` is the single question to put when it is missing - one per turn, never
 * a form in prose.
 */
const SLOTS = {
  service: { ask: 'What is it for?', kind: 'service' },
  date_time: { ask: 'When would suit?', kind: 'datetime' },
  resource: { ask: 'Anyone in particular, or whoever is free?', kind: 'resource' },
  customer: { ask: "Who is it for? A name is enough.", kind: 'person' },
  contact: { ask: 'What is the best number for them?', kind: 'phone' },
  appointment: { ask: 'Which appointment - what name is it under?', kind: 'appointment' },
  product: { ask: 'Which item?', kind: 'product' },
  message: { ask: 'What is the message?', kind: 'text' },
  reason: { ask: 'What is it about?', kind: 'text' },
};

/**
 * escalate:
 *   'never'      handle it and move on
 *   'onFailure'  two failed attempts at the same slot and a person takes over
 *   'always'     do not attempt an answer; fetch a person now
 */
const INTENTS = {
  book_appointment: {
    label: 'Book an appointment',
    required: ['service', 'date_time'],
    optional: ['resource', 'customer', 'contact'],
    tier: 'mid',
    tools: ['list_services', 'check_availability', 'find_customer', 'book_appointment'],
    mayWrite: true,
    escalate: 'onFailure',
  },
  reschedule: {
    label: 'Move an appointment',
    required: ['appointment', 'date_time'],
    optional: ['reason'],
    tier: 'mid',
    tools: ['find_appointment', 'check_availability', 'reschedule_appointment'],
    mayWrite: true,
    escalate: 'onFailure',
  },
  cancel: {
    label: 'Cancel an appointment',
    required: ['appointment'],
    optional: ['reason'],
    tier: 'mid',
    tools: ['find_appointment', 'cancel_appointment'],
    mayWrite: true,
    escalate: 'onFailure',
  },
  check_appointment: {
    label: 'Check an appointment',
    required: ['appointment'],
    optional: [],
    tier: 'small',
    tools: ['find_appointment', 'get_day_schedule'],
    mayWrite: false,
    escalate: 'never',
  },
  opening_hours: {
    label: 'Opening hours',
    required: [],
    optional: ['date_time'],
    tier: 'nano',
    tools: ['get_opening_hours'],
    mayWrite: false,
    escalate: 'never',
    // Answerable from the database alone, so it works with no model at all.
    deterministic: true,
  },
  location_directions: {
    label: 'Where we are',
    required: [],
    optional: [],
    tier: 'nano',
    tools: ['get_business_info'],
    mayWrite: false,
    escalate: 'never',
    deterministic: true,
  },
  service_enquiry: {
    label: 'What we do',
    required: [],
    optional: ['service'],
    tier: 'small',
    tools: ['list_services', 'search_knowledge'],
    mayWrite: false,
    escalate: 'never',
    deterministic: true,
  },
  price_enquiry: {
    label: 'What it costs',
    required: [],
    optional: ['service', 'product'],
    tier: 'small',
    tools: ['list_services', 'check_product_availability'],
    mayWrite: false,
    escalate: 'never',
    deterministic: true,
  },
  product_availability: {
    label: 'Whether something is in stock',
    required: ['product'],
    optional: [],
    tier: 'small',
    tools: ['check_product_availability'],
    mayWrite: false,
    escalate: 'never',
    deterministic: true,
  },
  order_status: {
    label: 'Where an order is',
    required: [],
    optional: ['customer'],
    tier: 'small',
    tools: ['find_customer', 'get_order_status'],
    mayWrite: false,
    escalate: 'never',
  },
  complaint: {
    label: 'A complaint',
    required: [],
    optional: ['reason'],
    tier: 'small',
    tools: ['leave_message'],
    mayWrite: true,
    // Never argued with, never explained away. A person deals with it.
    escalate: 'always',
  },
  emergency: {
    label: 'An emergency',
    required: [],
    optional: [],
    tier: 'nano',
    tools: [],
    mayWrite: false,
    escalate: 'always',
    // Detected before any model call, because it has to work when every
    // provider is down. See emergency.js.
    deterministic: true,
  },
  speak_to_human: {
    label: 'Asking for a person',
    required: [],
    optional: ['reason'],
    tier: 'nano',
    tools: ['leave_message'],
    mayWrite: true,
    escalate: 'always',
    deterministic: true,
  },
  leave_message: {
    label: 'Leave a message',
    required: ['message'],
    optional: ['customer', 'contact'],
    tier: 'small',
    tools: ['leave_message'],
    mayWrite: true,
    escalate: 'never',
  },
  callback_request: {
    label: 'Ask for a call back',
    required: ['contact'],
    optional: ['date_time', 'reason'],
    tier: 'small',
    tools: ['request_callback'],
    mayWrite: true,
    escalate: 'never',
  },
  payment_question: {
    label: 'A question about money owed',
    required: [],
    optional: ['customer'],
    tier: 'small',
    tools: ['find_customer'],
    mayWrite: false,
    // Money is not something to be approximate about.
    escalate: 'always',
  },
  smalltalk: {
    label: 'Small talk',
    required: [],
    optional: [],
    tier: 'nano',
    tools: [],
    mayWrite: false,
    escalate: 'never',
    deterministic: true,
  },
  abuse: {
    label: 'Abuse',
    required: [],
    optional: [],
    tier: 'nano',
    tools: [],
    mayWrite: false,
    escalate: 'always',
    deterministic: true,
  },
  other: {
    label: 'Something else',
    required: [],
    optional: [],
    tier: 'small',
    tools: ['search_knowledge', 'leave_message'],
    mayWrite: false,
    escalate: 'onFailure',
  },
};

const INTENT_NAMES = Object.keys(INTENTS);

/** Intents that never need a model, so the list is honest about the floor. */
const DETERMINISTIC_INTENTS = INTENT_NAMES.filter((name) => INTENTS[name].deterministic);

/** Intents that can end in a change to the database. */
const WRITING_INTENTS = INTENT_NAMES.filter((name) => INTENTS[name].mayWrite);

function intent(name) {
  return INTENTS[name] || INTENTS.other;
}

/** The first slot still missing - only ever one question per turn. */
function nextMissingSlot(name, filled = {}) {
  const spec = intent(name);
  for (const slot of spec.required) {
    const value = filled[slot];
    if (value === undefined || value === null || value === '') {
      return { slot, ...SLOTS[slot] };
    }
  }
  return null;
}

/** Whether this turn has to stop and fetch a person. */
function shouldEscalate(name, { failedAttempts = 0, sameIntentRepeats = 0, hostile = false } = {}) {
  const spec = intent(name);
  if (spec.escalate === 'always') return { escalate: true, reason: `${spec.label} always goes to a person` };
  if (hostile) return { escalate: true, reason: 'the caller is upset' };
  if (spec.escalate === 'onFailure' && failedAttempts >= 2) {
    return { escalate: true, reason: 'asked the same thing twice without getting an answer' };
  }
  // Going round the same loop is a sign the receptionist is stuck, whatever it
  // thinks the intent is.
  if (sameIntentRepeats >= 3) return { escalate: true, reason: 'the same request three times over' };
  return { escalate: false, reason: null };
}

module.exports = {
  INTENTS, INTENT_NAMES, SLOTS, DETERMINISTIC_INTENTS, WRITING_INTENTS,
  intent, nextMissingSlot, shouldEscalate,
};
