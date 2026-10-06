import { maskPhone } from '@parkease/contracts/primitives';

/**
 * An E.164 number as stored on `users.phone`: `+` and 10 to 15 digits. Matched anywhere in a
 * string, because an admin's own words land in the log too ("customer called from +91...").
 * There is deliberately no bare ten-digit pattern: it would mask order numbers and ids.
 */
const PHONE = /\+\d{10,15}/g;

/**
 * Keys that hold a credential or a bank identifier. Matched anywhere in the key, any case, so
 * `refreshToken`, `client_secret`, `razorpaySignature` and `IFSC_CODE` are all caught.
 */
const SECRET_KEY = /token|secret|password|account_?number|ifsc|signature|otp/i;

const API_KEY = /api[_-]?key/i;

/**
 * Short identifiers that would over-match as substrings (`pan` is inside `company` and `span`,
 * `card` inside `cardinality`), so a key is split into words (on `_`, `-`, `.` and camelCase
 * humps) and dropped only when a whole word is one of these: `panNumber`, `PAN`, `upi_id` and
 * `payerVpa` go; `company`, `panel` and `cardinality` stay.
 */
const SECRET_WORDS: ReadonlySet<string> = new Set([
  'pan',
  'aadhaar',
  'upi',
  'vpa',
  'cvv',
  'card',
  'authorization',
]);

const wordsOf = (key: string): string[] =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);

const isSecretKey = (key: string): boolean =>
  SECRET_KEY.test(key) || API_KEY.test(key) || wordsOf(key).some((word) => SECRET_WORDS.has(word));

const MAX_DEPTH = 8;
const TRUNCATED = '[truncated]';

/**
 * The audit log keeps whatever a command put in `before` and `after`, which is the truth an
 * investigator needs and a liability on screen. Redaction happens here, on the way out, and
 * never on the way in: the row stays complete, and the policy can tighten without a backfill.
 *
 * Returns a new value; the input is not touched. A container nested past `MAX_DEPTH` is replaced
 * rather than walked, so a hostile or accidental cycle-shaped payload cannot cost unbounded work.
 */
export function redactAuditValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.replace(PHONE, (match) => maskPhone(match));
  if (typeof value !== 'object' || value === null) return value;
  if (depth > MAX_DEPTH) return TRUNCATED;

  if (Array.isArray(value)) return value.map((item: unknown) => redactAuditValue(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSecretKey(key)) continue;
    out[key] = redactAuditValue(child, depth + 1);
  }
  return out;
}
