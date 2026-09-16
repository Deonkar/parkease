import { SURGE_BADGE_LABELS, type SurgeBadge } from '@parkease/contracts/enums';
import { colors, fontSize, lineHeight, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  formatSurgeMultiplier,
  SurgeMeter,
  surgeSpokenLabel,
} from '../../shared/components/SurgeBadge';

interface SurgeBannerProps {
  readonly badge: SurgeBadge | null;
  /** Displayed, never applied. The client does not compute prices (R-FE-06). */
  readonly multiplier: number;
  /**
   * Layout only, merged last. The screen owns where the banner sits; the banner
   * owns what it looks like. It matters that this is a prop rather than a
   * wrapper `View`: a wrapper would still occupy its margin on the far more
   * common 1.0x screen, where this component renders nothing.
   */
  readonly style?: StyleProp<ViewStyle>;
}

/**
 * The space detail banner, sitting directly above the rate card it qualifies.
 *
 * A chip would be wrong here. On a list row the driver is comparing spaces and
 * the tier is one attribute among several; on this screen they have already
 * chosen, and the next thing they read is a rate card that does not include the
 * surge. This banner is the sentence that stops them being surprised at
 * Review & Pay.
 *
 * The copy is `website.md` §2.6 verbatim, minus its ⚡ — an emoji is not an icon,
 * and the meter beside it carries the same signal with a magnitude attached.
 * The meter keeps the outlined treatment at every tier here: a full-width panel
 * is already loud enough without the chip's inversion.
 */
export function SurgeBanner({ badge, multiplier, style }: SurgeBannerProps) {
  if (badge === null) return null;

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={surgeSpokenLabel(badge, multiplier)}
      style={[styles.banner, style]}
    >
      <SurgeMeter badge={badge} />
      <Text style={styles.copy}>
        {formatSurgeMultiplier(multiplier)}x {titleCase(SURGE_BADGE_LABELS[badge])} — prices may be
        higher than usual
      </Text>
    </View>
  );
}

/**
 * Title case here and sentence case on the chip is not drift: `website.md` §2.6
 * fixes this sentence word for word, and it is the one place the tier reads as a
 * name rather than as a description.
 */
const titleCase = (label: string): string =>
  label.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surgeSoft,
  },
  copy: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.surge,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
});
