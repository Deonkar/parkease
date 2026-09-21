/**
 * Warn-level logging for handled failures (R-FAIL-01).
 *
 * The rule is "rethrow, return a typed failure, or handle and log at warn+ with
 * the trace id". On the client there is no trace id — that is a server concern —
 * so a handled failure here logs what it was and what threw, and the caller
 * still returns a typed failure rather than a silent success.
 *
 * Deliberately thin. This exists so a swallowed error is a visible decision
 * instead of an empty `catch`, not to become a logging framework.
 *
 * `no-console` is disabled for this file alone, which is the point of having
 * the file: one audited place where a console call is allowed, so every other
 * module reports a handled failure through here instead of reaching for
 * `console.log` on its own.
 */
/* eslint-disable no-console -- the single sanctioned console site; see above. */
export function warn(message: string, error?: unknown): void {
  if (error === undefined) {
    console.warn(`[parkease] ${message}`);
    return;
  }
  console.warn(`[parkease] ${message}`, error);
}
