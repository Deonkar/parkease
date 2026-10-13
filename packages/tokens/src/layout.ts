/**
 * Size and layout tokens.
 *
 * Material's minimum touch target is 48dp, and CLAUDE.md prefers Material over
 * Apple's 44pt where the two conflict (ADR-023: Android only). A target typed as
 * a literal in one component and 44 in the next is two screens disagreeing about
 * what a finger is.
 */
export const touchTarget = 48;

export const layout = {
  /**
   * The widest a column of reading content grows. On a tablet or a landscape
   * phone a job row's label and its amount must not sit a screen apart, so
   * content centres at this width and the ground fills the rest.
   */
  contentMaxWidth: 640,
  /**
   * The bottom navigation bar's content height, before the gesture-bar inset
   * is added. It fits a 28dp icon box and a 12px label on its own 18px line,
   * with the tab item's own padding, so the label is never clipped.
   */
  tabBarHeight: 64,
  /**
   * Skeleton placeholder heights, smallest to largest. A skeleton stands in
   * for the shape of what is loading, so screens pick the step nearest the
   * real content rather than typing a number of their own.
   */
  skeleton: {
    /** A single control: a button, a tab row. */
    line: 48,
    /** A status rail or a one-line notice. */
    row: 56,
    /** A short card: a verification row, a summary's second half. */
    short: 96,
    /** A summary card, one half of the evidence pair. */
    block: 120,
    /** A list card: an earnings line, a menu row. */
    card: 168,
    /** A tall card: an offer. */
    tall: 260,
  },
  /**
   * The shared empty and error states' marks: the empty state's illustration
   * circle and the error state's "!" badge. The badge's radius and line height
   * are derived from its size where it is drawn, never typed beside it.
   */
  state: {
    illustration: 120,
    badge: 56,
  },
} as const;

/**
 * Icon sizes, smallest to largest (S-79). An icon is sized by what it sits
 * beside, so a screen picks the step for its context instead of a number:
 * a check inside a small badge, a glyph beside a caption, a row's leading
 * icon, a chevron, a slot placeholder, an empty state's mark.
 */
export const iconSize = {
  /** Inside a small badge or marker: a step rail's check. */
  xs: 14,
  /** Beside caption-sized text: a chip, a band, an inline failure. */
  sm: 16,
  /** Beside body text in a notice or a locked action. */
  md: 18,
  /** A row's leading icon, a stepper's glyph, a status rail's mark. */
  base: 20,
  /** A trailing chevron, an account or form-field affordance. */
  lg: 24,
  /** A slot placeholder or a picker's lead icon; the tab bar's icon box. */
  xl: 28,
  /** The mark of a full-screen empty or error state. */
  hero: 48,
} as const;

export type IconSize = typeof iconSize;

export type Layout = typeof layout;
