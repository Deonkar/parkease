import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, duration, fontSize, radius, spacing } from '@parkease/tokens';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

interface SurgeBadgeProps {
  readonly multiplier: number;
}

/**
 * Shown only when the server says this space is surging. The multiplier is
 * displayed, never applied — the client does not compute prices (R-FE-06).
 * Warning-toned, deliberately not the availability green.
 */
export function SurgeBadge({ multiplier }: SurgeBadgeProps) {
  const reduceMotion = useReducedMotion();
  if (multiplier <= 1) return null;

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(duration.fast)}
      style={styles.badge}
    >
      <MaterialCommunityIcons name="lightning-bolt" size={13} color={colors.surge} />
      {/*
        Sentence case, not all-caps. This was the single loudest element on an
        otherwise restrained surface, and shouting at the driver about a price
        rise they did not cause is the wrong tone — the badge needs to inform,
        not alarm. The multiplier still leads, so the magnitude reads first.
      */}
      <Text style={styles.text}>{multiplier.toFixed(1)}x high demand</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.surgeSoft,
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.surge,
  },
});
