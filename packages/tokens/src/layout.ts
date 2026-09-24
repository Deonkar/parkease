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
} as const;

export type Layout = typeof layout;
