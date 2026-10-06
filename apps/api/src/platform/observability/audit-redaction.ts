import { maskPhone } from '@parkease/contracts/primitives';

/** An E.164 number as stored on `users.phone`: `+` and 10 to 15 digits, nothing else in the string. */
const PHONE = /^\+\d{10,15}$/;

/**
 * Keys that hold a credential or a bank identifier. Matched anywhere in the key, any case, so
 * `refreshToken`, `client_secret`, `razorpaySignature` and `IFSC_CODE` are all caught.
 */
const SECRET_KEY = /token|secret|password|account_?number|ifsc|signature|otp/i;

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
  if (typeof value === 'string') return PHONE.test(value) ? maskPhone(value) : value;
  if (typeof value !== 'object' || value === null) return value;
  if (depth > MAX_DEPTH) return TRUNCATED;

  if (Array.isArray(value)) return value.map((item: unknown) => redactAuditValue(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = redactAuditValue(child, depth + 1);
  }
  return out;
}
