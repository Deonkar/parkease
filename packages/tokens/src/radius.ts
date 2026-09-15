export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  '2xl': 28,
  /** Pills and circular affordances — clamped by the consumer's height. */
  full: 9999,
} as const;

export type Radius = typeof radius;
