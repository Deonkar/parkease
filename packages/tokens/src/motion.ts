/**
 * Motion tokens.
 *
 * Animation is a design system concern, not a per-component decision. Without
 * these, every screen invents its own duration and easing and the app reads as
 * a set of separately-built screens rather than one product.
 *
 * Two rules govern everything here:
 *
 * 1. **Duration scales with distance and size, not with importance.** A chip
 *    press is `instant`; a full sheet travelling the height of the screen is
 *    `deliberate`. A slow animation on a small element feels broken, not
 *    premium.
 * 2. **Anything that can be driven by a spring, is.** Springs carry velocity,
 *    so a gesture that is interrupted mid-flight resolves naturally instead of
 *    snapping. Durations are for things with no physical metaphor — opacity,
 *    colour, shimmer.
 */

/** Milliseconds. For opacity, colour, and other non-physical transitions. */
export const duration = {
  /** Press feedback and state flips the user should not perceive as animated. */
  instant: 90,
  /** Small local changes: chip selection, badge swap, icon cross-fade. */
  fast: 160,
  /** The default for most transitions. */
  base: 240,
  /** Elements crossing a meaningful distance, or entering from off-screen. */
  slow: 360,
  /** Full-screen or sheet-height travel. */
  deliberate: 480,
} as const;

/**
 * Cubic bezier control points, in the order Reanimated's `Easing.bezier` and
 * CSS `cubic-bezier()` both take them.
 */
export const easing = {
  /** Entering the screen: fast out of the gate, settles gently. */
  decelerate: [0.05, 0.7, 0.1, 1] as const,
  /** Leaving the screen: eases in, then exits quickly. */
  accelerate: [0.3, 0, 0.8, 0.15] as const,
  /** Movement that starts and ends on screen. */
  standard: [0.2, 0, 0, 1] as const,
  /** Looping motion such as a skeleton shimmer. Symmetric by construction. */
  linear: [0, 0, 1, 1] as const,
} as const;

/**
 * Reanimated `withSpring` configs. `damping` below ~15 visibly overshoots,
 * which is the point for `bouncy` and a bug for `gentle`.
 */
export const spring = {
  /** Sheets and cards. Settles without overshoot. */
  gentle: { damping: 20, stiffness: 180, mass: 1 },
  /** The default for interactive elements that follow a gesture. */
  responsive: { damping: 16, stiffness: 220, mass: 0.9 },
  /** Deliberate overshoot: the preview card arriving, a marker being selected. */
  bouncy: { damping: 12, stiffness: 260, mass: 0.9 },
  /** Near-instant with no wobble, for press states. */
  snappy: { damping: 26, stiffness: 400, mass: 0.7 },
} as const;

/**
 * Per-item delay for staggered entrances, in milliseconds.
 *
 * Capped deliberately: with a long list, a fixed per-item delay means the last
 * row animates in seconds after the first, which reads as lag rather than
 * polish. Consumers multiply by the item's index and clamp with `staggerMax`.
 */
export const stagger = {
  step: 45,
  /** Beyond this, every remaining item shares the same delay. */
  max: 270,
} as const;

/** The scale a pressable settles to while held. */
export const pressScale = 0.97;

export type Duration = typeof duration;
export type Easing = typeof easing;
export type Spring = typeof spring;
