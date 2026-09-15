/**
 * Direction "Wayfinder", chosen 2026-09-14.
 *
 * Cobalt carries the map and interaction; green is reserved for one meaning
 * only — a slot that is free right now. It is not a general-purpose success
 * colour, because on this product availability IS the thing the driver came
 * for, and spending the same green on "saved successfully" would dilute it.
 *
 * Two tiers per hue, and the reason matters. The vivid tones (`primaryVivid`,
 * `availableVivid`) are what the direction was picked for, but measured against
 * white they land at 4.10:1 and 3.77:1 — under the 4.5:1 AA floor for normal
 * text. A 14px semibold button label is not "large text", so a vivid fill
 * behind white type is a real failure, not a technicality. The base tones are
 * darkened to clear AA (5.93:1 and 5.48:1) and carry anything with text on it;
 * the vivid tones are for map markers and large decorative fills, which always
 * carry their own label as well (R-FE-12: colour is never the only signal).
 */
export const colors = {
  /** Interactive fills and links. Safe behind white text. */
  primary: '#0369A1',
  /** Map markers and large decorative fills only — fails AA behind small text. */
  primaryVivid: '#0284C7',
  primaryLight: '#38BDF8',
  primaryDark: '#075985',
  /** Tinted background for selected chips and subtle primary surfaces. */
  primarySoft: '#E0F2FE',

  /** Availability: a slot free right now. Safe behind white text. */
  available: '#047857',
  /** Availability markers and badges — pair with a label, never colour alone. */
  availableVivid: '#059669',
  availableSoft: '#D1FAE5',
  /** Text on availableSoft. */
  availableInk: '#065F46',

  surface: '#FFFFFF',
  surfaceSecondary: '#F8FAFC',
  surfaceTertiary: '#F1F5F9',

  text: '#0F172A',
  textSecondary: '#475569',
  /** Clears AA on all three surfaces: 5.41 white, 5.17 secondary, 4.94 tertiary. */
  textTertiary: '#5D6B80',
  textInverse: '#FFFFFF',

  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  borderFocused: '#0369A1',

  /** Borders, icons and text on white. 4.83:1 — clears AA, but only on white. */
  error: '#DC2626',
  errorLight: '#FEF2F2',
  /**
   * Text on `errorLight`. The same two-tier split the availability green uses,
   * and for the same reason: `error` on `errorLight` measures 4.41:1, under the
   * 4.5:1 AA floor, so the tinted error panels the booking flow renders needed a
   * darker ink rather than a slightly-too-light one nobody measured. 5.91:1.
   */
  errorInk: '#B91C1C',
  success: '#16A34A',
  successLight: '#F0FDF4',
  warning: '#B45309',
  warningLight: '#FFFBEB',
  info: '#0369A1',
  infoLight: '#EFF6FF',

  /** Surge. Warning-toned, never the availability green. */
  surge: '#9A3412',
  surgeSoft: '#FFEDD5',

  /**
   * A space that is closed or has no free slots. Muted, never red — unavailable
   * is not an error. Dark enough that a white price label on the marker still
   * clears AA (4.76:1), which #94A3B8 did not.
   */
  muted: '#64748B',
  mutedSoft: '#F1F5F9',

  skeleton: '#E2E8F0',
  skeletonHighlight: '#F1F5F9',

  tabActive: '#0369A1',
  tabInactive: '#5D6B80',

  overlay: 'rgba(15, 23, 42, 0.5)',
} as const;

export type Colors = typeof colors;
