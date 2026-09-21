/**
 * Warn-level logging for handled failures (R-FAIL-01).
 *
 * The rule is "rethrow, return a typed failure, or handle and log at warn+ with
 * the trace id". On the client there is no trace id — that is a server concern —
 * so a handled failure here logs what it was and what threw, and the caller
 * still returns a typed failure rather than a silent success.
 *
 * **Errors are summarised through an allow-list, never passed through.**
 * `lib/api.ts` sets `Authorization: Bearer <accessToken>` on every request, and
 * axios attaches that same `config` to the `AxiosError` it throws — so logging
 * the raw object prints a live access token into Logcat on a release build, and
 * into any crash reporter that hooks `console.warn`. Nothing else catches this:
 * the parameter is typed `unknown`, so neither the compiler nor eslint has
 * anything to object to.
 *
 * Deliberately thin. This exists so a swallowed error is a visible decision
 * instead of an empty `catch`, not to become a logging framework.
 *
 * `no-console` is disabled for this file alone, which is the point of having
 * the file: one audited place where a console call is allowed, so every other
 * module reports a handled failure through here instead of reaching for
 * `console.log` on its own — and so redaction has exactly one home.
 */
/* eslint-disable no-console -- the single sanctioned console site; see above. */

/** What is safe to say about a failure. Anything not named here is dropped. */
export interface SafeErrorSummary {
  readonly name?: string;
  readonly message?: string;
  readonly code?: string;
  readonly status?: number;
  readonly url?: string;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reduce an unknown thrown value to the few fields worth logging.
 *
 * Built by picking, never by deleting: a deny-list would have to be updated
 * every time axios adds a field that happens to carry a header, and the first
 * time it was missed the token would ship again.
 */
export function summariseError(error: unknown): SafeErrorSummary | string | undefined {
  if (error === undefined || error === null) return undefined;
  if (typeof error === 'string') return error;

  // Anything thrown that is not an object: number, boolean, bigint, symbol,
  // function. `String(aSymbol)` THROWS, so a logger that used it would crash
  // the very failure path it exists to report.
  if (typeof error !== 'object') {
    if (typeof error === 'symbol') return error.toString();
    if (typeof error === 'function') return 'function';
    return String(error as number | boolean | bigint);
  }

  const source = error as Record<string, unknown>;
  const summary: Record<string, unknown> = {};

  const name = readString(source, 'name');
  const message = readString(source, 'message');
  const code = readString(source, 'code');
  if (name !== undefined) summary['name'] = name;
  if (message !== undefined) summary['message'] = message;
  if (code !== undefined) summary['code'] = code;

  // The HTTP status is the single most useful field for diagnosis, and it is
  // the only thing read out of `response` — never its config, headers or body.
  const response = source['response'];
  if (typeof response === 'object' && response !== null) {
    const status = (response as Record<string, unknown>)['status'];
    if (typeof status === 'number') summary['status'] = status;
  }

  // The path, without query string: a query can carry identifiers, and the
  // route alone is enough to know which call failed.
  const config = source['config'];
  if (typeof config === 'object' && config !== null) {
    const url = readString(config as Record<string, unknown>, 'url');
    if (url !== undefined) summary['url'] = url.split('?')[0];
  }

  return Object.keys(summary).length > 0 ? (summary as SafeErrorSummary) : undefined;
}

export function warn(message: string, error?: unknown): void {
  const summary = summariseError(error);
  if (summary === undefined) {
    console.warn(`[parkease] ${message}`);
    return;
  }
  console.warn(`[parkease] ${message}`, summary);
}
