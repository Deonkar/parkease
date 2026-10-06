const INDIAN_MOBILE = /^\+91(\d{5})\d{3}(\d{2})$/;

/**
 * An E.164 Indian mobile with its middle three digits hidden, for admin screens
 * that need to tell two people apart but must not hold a callable number.
 * Anything that is not `+91` plus ten digits becomes `***` rather than being
 * passed through, so a malformed value can never leak by being unparseable.
 */
export function maskPhone(e164: string): string {
  const match = INDIAN_MOBILE.exec(e164);
  if (match === null) return '***';
  return `+91 ${match[1] ?? ''}***${match[2] ?? ''}`;
}
