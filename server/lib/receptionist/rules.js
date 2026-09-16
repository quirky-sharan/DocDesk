const { INTENT_NAMES } = require('./intents');
const { detectEmergency, detectAdviceRequest, detectHostility } = require('./emergency');
const { parse: parseWhen } = require('./parse/datetime');
const { parsePhone } = require('./parse/phone');

/**
 * Working out what somebody wants, without a model.
 *
 * This exists for two reasons, and the second is the one people forget.
 *
 * 1. It is the floor. With no key, no credit and no internet, the receptionist
 *    still knows that "what time do you close" is a question about opening
 *    hours and can answer it from the database. "Completely free" is only true
 *    if something works when everything paid-for is gone.
 *
 * 2. It is a correctness check on the model. It runs on EVERY turn regardless
 *    of which tier handled it, and disagreement is recorded. When the rules and
 *    the model start disagreeing about obvious requests, the prompt has
 *    drifted - and you find out from a chart rather than from a customer. The
 *    same argument the NLQ fallback was built on in Phase 4, where it was
 *    right.
 *
 * Scores are deliberately crude. This is not trying to beat the model; it is
 * trying to be independently right about the easy half.
 */

/**
 * Each intent gets patterns worth points. `strong` means the phrase is close to
 * conclusive on its own; `weak` contributes but will not win alone.
 */
const RULES = {
  emergency: { strong: [], weak: [] }, // handled before this, in emergency.js

  book_appointment: {
    strong: [
      /\b(book|make|fix|schedule|set up|arrange)\b.{0,20}\b(appointment|slot|booking|session|visit|consultation)\b/i,
      /\b(appointment|slot|booking)\b.{0,15}\bfor\b.{0,20}\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      /\bcan i (come in|see someone|get an appointment)\b/i,
      /\b(put|pencil|squeeze)\b.{0,20}\b(in|down)\b.{0,20}\b(for|at)\b/i,
    ],
    weak: [/\bappointment\b/i, /\bbook\b/i, /\bavailable\b/i, /\bfree (slot|time)\b/i],
  },
  reschedule: {
    strong: [
      /\b(move|change|shift|push|postpone|reschedul\w*|bring forward)\b.{0,25}\b(appointment|booking|slot|it)\b/i,
      /\b(appointment|booking)\b.{0,20}\b(to|for)\b.{0,20}\b(another|different|later|earlier)\b/i,
      /\bcan (i|we|they) come (in )?(a bit )?(later|earlier|another day)\b/i,
    ],
    weak: [/\breschedul/i, /\bmove\b/i, /\bchange the time\b/i],
  },
  cancel: {
    strong: [
      /\b(cancel|call off|scrap|drop)\b.{0,25}\b(appointment|booking|slot|it)\b/i,
      /\b(can'?t|cannot|won'?t be able to) (make|come|attend)\b/i,
      /\bnot coming\b/i,
    ],
    weak: [/\bcancel\b/i],
  },
  check_appointment: {
    strong: [
      /\b(when|what time) (is|was)\b.{0,20}\b(appointment|booking|slot)\b/i,
      /\b(do i|does \w+) have (an )?(appointment|booking)\b/i,
      /\b(confirm|check)\b.{0,20}\b(appointment|booking)\b/i,
      /\bwho('s| is) (coming|booked|in)\b/i,
      /\bwhat('s| is) (on|in the diary|the schedule)\b/i,
    ],
    weak: [/\bappointment\b/i, /\bdiary\b/i, /\bschedule\b/i],
  },
  opening_hours: {
    strong: [
      /\b(what time|when)\b.{0,20}\b(do you |are you |you )?(open|close|shut)\b/i,
      /\b(opening|closing|business) (hours|times?)\b/i,
      /\b(are|r) (you|we) open\b/i,
      /\bopen (on|this|tomorrow|today|sunday|saturday)\b/i,
      /\bwhat are (your|our) hours\b/i,
    ],
    weak: [/\bopen\b/i, /\bclosed?\b/i, /\bhours\b/i],
  },
  location_directions: {
    strong: [
      /\b(where are you|where is the (shop|clinic|office|place)|how do i (get|find)|what'?s the address)\b/i,
      /\b(directions|located|location|address|parking)\b/i,
    ],
    weak: [/\bwhere\b/i, /\bmap\b/i],
  },
  service_enquiry: {
    strong: [
      /\b(what|which)\b.{0,15}\b(services?|treatments?|do you (do|offer|provide))\b/i,
      /\bdo you (do|offer|provide|sell)\b/i,
      /\bhow long does\b.{0,25}\btake\b/i,
    ],
    weak: [/\bservice\b/i, /\boffer\b/i],
  },
  price_enquiry: {
    strong: [
      /\bhow much\b/i,
      /\b(what|whats|what's)\b.{0,15}\b(the )?(price|cost|charge|fee|rate)\b/i,
      /\b(price|cost) (of|for)\b/i,
      /\bdo you charge\b/i,
    ],
    weak: [/\bprice\b/i, /\bcost\b/i, /\bcharges?\b/i],
  },
  product_availability: {
    strong: [
      /\b(do you have|have you got|is there|got any|in stock|available)\b.{0,30}\b(left|in stock|available)?\b/i,
      /\b(stock|stocked)\b.{0,15}\b(of|any)\b/i,
    ],
    weak: [/\bstock\b/i, /\bavailable\b/i, /\bhave any\b/i],
  },
  order_status: {
    strong: [
      /\b(where (is|are)|status of|any news on|has .{0,20} arrived)\b.{0,25}\b(order|delivery|parcel|item)\b/i,
      /\bmy order\b/i,
    ],
    weak: [/\border\b/i, /\bdelivery\b/i],
  },
  complaint: {
    strong: [
      /\b(complain|complaint|unhappy|not happy|disappointed|terrible|awful|appalling|unacceptable)\b/i,
      /\b(want|would like) (a )?refund\b/i,
      /\b(this is|that was) (a )?(disgrace|joke|shambles)\b/i,
    ],
    weak: [/\bwrong\b/i, /\bbad\b/i, /\bpoor\b/i],
  },
  speak_to_human: {
    strong: [
      /\b(speak|talk) to (a|an|someone|somebody|a real|a human|the (owner|manager|doctor))\b/i,
      /\b(real person|human being|not (a|an) (bot|ai|robot))\b/i,
      /\bput me through\b/i,
      /\bare you (a )?(bot|robot|ai|human|real)\b/i,
    ],
    weak: [/\bhuman\b/i, /\bmanager\b/i],
  },
  leave_message: {
    strong: [
      /\b(leave|take|pass on) (a )?(message|note)\b/i,
      /\b(tell|let) (him|her|them|the (owner|doctor|manager))\b.{0,25}\bthat\b/i,
    ],
    weak: [/\bmessage\b/i],
  },
  callback_request: {
    strong: [
      /\b(call|ring|phone) (me|us|him|her|them) back\b/i,
      /\b(can|could) (someone|somebody|you) (call|ring|phone)\b/i,
      /\bcallback\b/i,
    ],
    weak: [/\bcall me\b/i],
  },
  payment_question: {
    strong: [
      /\b(how much do (i|we|they) owe|outstanding|balance due|unpaid|invoice|bill)\b/i,
      /\b(payment|paid)\b.{0,20}\b(not|missing|failed|didn'?t go through)\b/i,
    ],
    weak: [/\bpayment\b/i, /\binvoice\b/i, /\bowe\b/i],
  },
  smalltalk: {
    strong: [
      /^\s*(hi|hello|hey|good (morning|afternoon|evening)|namaste|vanakkam)\b[\s!.?]*$/i,
      /^\s*(thanks|thank you|thx|ok|okay|great|perfect|bye|goodbye|see you)\b[\s!.?]*$/i,
      /\bhow are you\b/i,
    ],
    weak: [],
  },
};

const STRONG_SCORE = 10;
const WEAK_SCORE = 3;

/**
 * Classifies a message without any model.
 *
 * @returns {{ intent: string, confidence: number, scores: object, signals: object }}
 */
function classify(text, { now = new Date(), timezone = 'UTC', openHour = 9, closeHour = 18 } = {}) {
  const input = String(text || '').trim();
  const signals = extractSignals(input, { now, timezone, openHour, closeHour });

  // Safety first, always, and before anything that could cost a round trip.
  if (signals.emergency) {
    return { intent: 'emergency', confidence: 1, scores: { emergency: 100 }, signals };
  }
  if (signals.hostile) {
    return { intent: 'abuse', confidence: 0.9, scores: { abuse: 90 }, signals };
  }

  const scores = {};
  for (const [name, rule] of Object.entries(RULES)) {
    let score = 0;
    for (const pattern of rule.strong || []) if (pattern.test(input)) score += STRONG_SCORE;
    for (const pattern of rule.weak || []) if (pattern.test(input)) score += WEAK_SCORE;
    if (score) scores[name] = score;
  }

  // A time in the message is evidence for the intents that need one, and
  // evidence against the ones that never do.
  if (signals.when) {
    for (const name of ['book_appointment', 'reschedule', 'check_appointment', 'callback_request']) {
      if (scores[name]) scores[name] += 4;
    }
  }
  if (signals.phone && scores.callback_request) scores.callback_request += 4;

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { intent: 'other', confidence: 0, scores, signals };

  const [best, bestScore] = ranked[0];
  const runnerUp = ranked[1]?.[1] || 0;

  // Confidence is how far ahead the winner is, not how high it scored. Two
  // intents on 10 apiece is a coin toss however strong each looked alone.
  const margin = (bestScore - runnerUp) / bestScore;
  const confidence = Math.min(1, (bestScore / 14) * 0.6 + margin * 0.4);

  return { intent: best, confidence: Number(confidence.toFixed(2)), scores, signals };
}

/** The facts a parser can pull out with certainty, before anything fuzzy. */
function extractSignals(text, { now, timezone, openHour, closeHour }) {
  const emergency = detectEmergency(text);
  const advice = detectAdviceRequest(text);
  const when = parseWhen(text, { now, timezone, openHour, closeHour });
  const phone = parsePhone(text);

  return {
    emergency: emergency || null,
    advice: advice || null,
    hostile: detectHostility(text),
    when: when ? { start: when.start, end: when.end, allDay: when.allDay, needsConfirmation: when.needsConfirmation, assumptions: when.assumptions } : null,
    phone: phone ? phone.e164 : null,
    question: /\?\s*$/.test(String(text || '').trim()) || /^(what|when|where|who|why|how|do|does|is|are|can|could|will|would)\b/i.test(String(text || '').trim()),
  };
}

/**
 * Compares what the rules thought with what the model said.
 *
 * Only counts as a disagreement when the rules were confident. The rules being
 * unsure and the model deciding is the system working, not drifting.
 */
function compare(ruleResult, modelIntent) {
  if (!modelIntent || !INTENT_NAMES.includes(modelIntent)) {
    return { agree: false, meaningful: false, reason: 'the model did not pick a known intent' };
  }
  if (ruleResult.intent === modelIntent) return { agree: true, meaningful: true, reason: null };
  const meaningful = ruleResult.confidence >= 0.6;
  return {
    agree: false,
    meaningful,
    reason: meaningful
      ? `rules said ${ruleResult.intent} (confidence ${ruleResult.confidence}), model said ${modelIntent}`
      : 'the rules were not confident enough to disagree',
  };
}

module.exports = { classify, compare, extractSignals, RULES };
