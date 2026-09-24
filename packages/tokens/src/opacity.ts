/**
 * Opacity tokens.
 *
 * For something that is present but not in play — never for hiding (that is
 * layout's job) and never as the only signal: whatever is dimmed also says so
 * in words or shape (R-FE-12).
 */
export const opacity = {
  /**
   * Present but not active: a disabled control, an inactive carousel dot, a
   * photo held on the phone that the server does not have yet.
   */
  dimmed: 0.5,
  /** A lighter step, for a label inside an element that is already dimmed. */
  muted: 0.7,
} as const;

export type Opacity = typeof opacity;
