import { colors } from '@parkease/tokens';

/**
 * A washer switch's colours, from the tokens (M4). Extracted on its second use
 * (R-ARCH-07): the online rail and each menu row must not disagree about what
 * a switch looks like.
 *
 * `activeThumbColor` is react-native-web's prop for the thumb while on; without
 * it the preview draws its own teal (#009688), a colour from no palette.
 * Android reads `thumbColor` for both states and ignores the web prop.
 */
export function switchColors(on: string): {
  readonly trackColor: { readonly false: string; readonly true: string };
  readonly thumbColor: string;
  readonly activeThumbColor: string;
} {
  return {
    trackColor: { false: colors.borderStrong, true: on },
    thumbColor: colors.surface,
    activeThumbColor: colors.surface,
  };
}
