// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/**
 * Characters that exist to hide or reorder text: zero-width space, soft hyphen, word joiner, BOM
 * and the bidi overrides. NOT the zero-width joiner and non-joiner (U+200C/D): Devanagari and
 * other Indic scripts need them to form conjuncts, and emoji sequences need the joiner.
 */
const INVISIBLE = /[\u00AD\u180E\u200B\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
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
    .replace(INVISIBLE, '')
    .replace(EXCESS_WHITESPACE, '  ')
    .trim();

  return cleaned.length === 0 ? null : cleaned;
}
