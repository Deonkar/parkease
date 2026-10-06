/**
 * Where a handled client-side failure is surfaced (R-FAIL-01). The browser console for now; this
 * is the one place to point at Sentry when the admin panel gets it.
 */
export function reportError(context: string, error: unknown): void {
  // eslint-disable-next-line no-console -- the single sink for handled errors, by design
  console.error(`[admin] ${context}`, error);
}
