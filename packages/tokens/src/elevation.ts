/**
 * Elevation presets.
 *
 * React Native draws shadows differently per platform: iOS reads
 * shadowColor/Offset/Opacity/Radius, Android reads only `elevation`, and
 * react-native-web maps the iOS fields to a CSS box-shadow. Each level carries
 * all of them so one token produces a comparable result on all three, rather
 * than a card that floats on iOS and sits flat on Android.
 *
 * Levels are semantic, not arbitrary: a raised element should say what it is
 * (a card, a sheet) rather than pick a number.
 */

interface ElevationStyle {
  readonly shadowColor: string;
  readonly shadowOffset: { readonly width: number; readonly height: number };
  readonly shadowOpacity: number;
  readonly shadowRadius: number;
  readonly elevation: number;
}

const SHADOW_COLOR = '#0F172A';

export const elevation = {
  /** Flat against the surface. Use to explicitly remove a shadow. */
  none: {
    shadowColor: SHADOW_COLOR,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  /** Resting cards and list rows. */
  card: {
    shadowColor: SHADOW_COLOR,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  /** Map markers and chips that sit above content. */
  raised: {
    shadowColor: SHADOW_COLOR,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  /** Bottom sheets, the preview card, floating action buttons. */
  sheet: {
    shadowColor: SHADOW_COLOR,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  /** Modals and anything that dims the content behind it. */
  modal: {
    shadowColor: SHADOW_COLOR,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 24,
  },
} as const satisfies Record<string, ElevationStyle>;

export type Elevation = typeof elevation;
export type ElevationLevel = keyof Elevation;
