import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Paise } from '@parkease/contracts/primitives';
import {
  colors,
  duration,
  easing,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  spacing,
  touchTarget,
} from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, useReducedMotion } from 'react-native-reanimated';

import { useAnnounce } from '@/features/shared/hooks/useAnnounce';
import { formatPaise } from '@/lib/money';

import type { JobEnd } from '../job-moments';

const WON = "It's yours. Tap On my way when you set off for the car.";

/**
 * The peak of the flow (M9, impeccable P3): the partner just won a job. A brief
 * confirmation in cobalt (green means availability only), faded in with the
 * tokens' motion, or not at all under reduced motion, and announced.
 */
export function JobWonNotice() {
  const reduceMotion = useReducedMotion();
  useAnnounce(WON);
  const entering = reduceMotion
    ? undefined
    : FadeIn.duration(duration.base).easing(Easing.bezier(...easing.decelerate));

  return (
    <Animated.View entering={entering}>
      <View style={styles.won} testID="job-won-notice">
        <MaterialCommunityIcons
          name="check-decagram-outline"
          size={20}
          color={colors.primaryDark}
        />
        <Text style={styles.wonText}>{WON}</Text>
      </View>
    </Animated.View>
  );
}

export interface JobEndFooterProps {
  readonly end: JobEnd;
  /** The server's figure for this job, formatted and nothing else (R-FE-06). */
  readonly earningsPaise: Paise | null;
  readonly onEarnings: () => void;
  readonly onOffers: () => void;
}

/**
 * The end of a job is never a dead end (M9). Completed says what was earned
 * and links to Earnings; cancelled says what happens to the pay. Both lead back
 * to Offers, where the next job is.
 *
 * A job can only be cancelled before washing starts (the machine has no cancel
 * edge from `washing`), and a cancellation reverses the job's ledger entries,
 * so a cancelled job pays nothing.
 */
export function JobEndFooter({ end, earningsPaise, onEarnings, onOffers }: JobEndFooterProps) {
  return (
    <View style={styles.end} testID={`job-end-${end}`}>
      {end === 'completed' ? (
        <>
          <View style={styles.endHead}>
            <MaterialCommunityIcons
              name="check-circle-outline"
              size={20}
              color={colors.primaryDark}
            />
            <Text style={styles.endTitle}>Job complete. Nice work.</Text>
          </View>
          {earningsPaise === null ? null : (
            <Text style={styles.endBody}>
              {'You earned '}
              <Text style={styles.endAmount}>
                {formatPaise(earningsPaise, { alwaysDecimals: true })}
              </Text>
              {' on this job.'}
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="See your earnings"
            onPress={onEarnings}
            style={styles.link}
            testID="job-end-earnings"
          >
            <Text style={styles.linkLabel}>See your earnings</Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.endBody}>
          The driver cancelled before washing started, so this job pays nothing and will not appear
          in your earnings.
        </Text>
      )}
      <View style={styles.clip}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to offers"
          onPress={onOffers}
          android_ripple={{ color: colors.primaryDark }}
          style={styles.primary}
          testID="job-end-offers"
        >
          <Text style={styles.primaryLabel}>Back to offers</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  won: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  wonText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.primaryDark,
  },
  end: { gap: spacing.sm },
  endHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  endTitle: { flex: 1, fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.text },
  endBody: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.textSecondary,
  },
  endAmount: { fontWeight: fontWeight.bold, color: colors.text },
  link: { minHeight: touchTarget, justifyContent: 'center', alignSelf: 'flex-start' },
  linkLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary },
  // The ripple is clipped by its parent on Android, not by its own radius.
  clip: { borderRadius: radius.md, overflow: 'hidden' },
  primary: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  primaryLabel: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textInverse },
});
