// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const EXCESS_WHITESPACE = /\s{3,}/g;

/**
 * Normalise, do not escape (task 17 §17.5). The comment is stored as the user typed it, minus
 * characters that exist only to break a renderer or hide text. Escaping at write time is how
 * `&amp;amp;` reaches production: React Native and React both escape on render. SQL injection is
 * closed by parameterisation everywhere (R-SEC-02), not by filtering input.
 */
export function sanitiseComment(raw: string | null): string | null {
  if (raw === null) return null;

  const cleaned = raw
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    .replace(ZERO_WIDTH, '')
    .replace(EXCESS_WHITESPACE, '  ')
    .trim();

  return cleaned.length === 0 ? null : cleaned;
}
