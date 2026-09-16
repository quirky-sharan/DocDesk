/**
 * Emergencies, detected before a model is ever asked.
 *
 * This is the one path that must work when every provider is down, the key has
 * been revoked and the internet is off. So it is string matching against a list
 * the owner controls, running before anything is sent anywhere, with a fixed
 * reply the owner wrote. No model is consulted and none is needed.
 *
 * What it deliberately does not do: decide whether something IS an emergency.
 * It matches phrases and then gets out of the way - tells the person to call
 * the emergency services, raises the alarm in the front desk, and stops. It
 * never reassures, never triages, never suggests waiting. Getting that wrong is
 * the failure that ends a business, and no phrasing of a prompt is worth
 * betting on.
 */

/**
 * The starting list. Deliberately blunt - a false positive here costs someone a
 * moment's confusion, a false negative costs much more. Owners add to it in
 * Settings; this is what a fresh install has.
 */
const DEFAULT_PHRASES = [
  'chest pain', 'chest is hurting', 'heart attack', 'cardiac',
  "can't breathe", 'cant breathe', 'not breathing', 'trouble breathing', 'choking',
  'bleeding', 'blood loss', 'haemorrhage', 'hemorrhage',
  'unconscious', 'passed out', 'collapsed', 'not responding', 'unresponsive',
  'seizure', 'fitting', 'convulsion',
  'stroke', 'face drooping', 'slurred speech',
  'overdose', 'poisoned', 'poisoning', 'swallowed',
  'accident', 'crash', 'fell from', 'severe burn',
  'suicide', 'kill myself', 'end my life', 'harm myself',
  'anaphylaxis', 'allergic reaction', 'swelling up',
  'emergency', 'ambulance', 'urgent help',
  'labour pain', 'labor pain', 'water broke',
];

/**
 * Phrases that look urgent but are not, and would otherwise fire constantly in
 * a shop. "I need this urgently" is a delivery question.
 */
const EXCLUSIONS = [
  'urgently need', 'need it urgently', 'urgent order', 'urgent delivery',
  'emergency exit', 'emergency contact', 'in case of emergency',
];

const DEFAULT_RESPONSE =
  'If this is a medical emergency, please call 108 for an ambulance now, or go to your nearest '
  + 'emergency department. I am not able to help with a medical problem, and waiting for a reply '
  + 'here could cost time.';

function normalise(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} text
 * @param {object} [options]
 * @param {string[]} [options.phrases]  from settings, replacing the defaults
 * @param {string}   [options.response] from settings
 * @returns {null | { matched: string, response: string }}
 */
function detectEmergency(text, { phrases = null, response = null } = {}) {
  const input = normalise(text);
  if (!input) return null;

  for (const exclusion of EXCLUSIONS) {
    if (input.includes(normalise(exclusion))) return null;
  }

  const list = (phrases && phrases.length ? phrases : DEFAULT_PHRASES).map(normalise).filter(Boolean);
  for (const phrase of list) {
    if (input.includes(phrase)) {
      return {
        matched: phrase,
        response: response || DEFAULT_RESPONSE,
      };
    }
  }
  return null;
}

/**
 * Subjects the receptionist must never give an opinion on, whatever it is
 * asked. Separate from emergencies: this is not urgent, it is simply not ours
 * to answer. It offers the earliest appointment and a person instead.
 */
const ADVICE_PATTERNS = [
  // Medical
  /\b(should i|do i need to|is it (safe|normal|serious|ok))\b/i,
  /\b(diagnos|symptom|prescri|dosage|dose of|medicine for|treatment for|side effect)/i,
  /\b(is this (cancer|infected|broken|serious))\b/i,
  // Legal
  /\b(sue|lawsuit|legal advice|my rights|liable|liability|contract says)\b/i,
  // Financial
  /\b(should i invest|tax advice|claim (on )?insurance|financial advice)\b/i,
];

/**
 * @returns {null | { kind: 'medical'|'legal'|'financial', response: string }}
 */
function detectAdviceRequest(text) {
  const input = String(text || '');
  for (const pattern of ADVICE_PATTERNS) {
    if (pattern.test(input)) {
      const kind = /sue|lawsuit|legal|rights|liab|contract/i.test(input) ? 'legal'
        : /invest|tax|insurance|financial/i.test(input) ? 'financial'
        : 'medical';
      return {
        kind,
        response: kind === 'medical'
          ? "I am not able to give advice on a medical question - I would be guessing, and that is not something to guess about. I can book you the earliest appointment, or pass this to someone now."
          : `I am not able to give ${kind} advice. I can take a message and have someone get back to you.`,
      };
    }
  }
  return null;
}

/** Abuse and hostility: one attempt to calm it, then a person. */
const HOSTILE = /\b(fuck|f\*ck|shit|bastard|idiot|stupid|useless|bloody hell|shut up|scam|fraud|cheat)\b/i;

function detectHostility(text) {
  return HOSTILE.test(String(text || ''));
}

module.exports = {
  detectEmergency, detectAdviceRequest, detectHostility,
  DEFAULT_PHRASES, DEFAULT_RESPONSE, EXCLUSIONS,
};
