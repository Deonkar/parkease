import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  colors,
  duration,
  easing,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  spacing,
} from '@parkease/tokens';
import { Button } from '@parkease/ui-native';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface PaymentFailedSheetProps {
  readonly visible: boolean;
  /**
   * Whether we know which method failed. When we do, "Try Again" reopens
   * Checkout on it and "Change Method" opens the picker — two buttons that do
   * genuinely different things. When we do not, they would be identical, so
   * only one is rendered.
   */
  readonly canChangeMethod: boolean;
  readonly onTryAgain: () => void;
  readonly onChangeMethod: () => void;
  readonly onDismiss: () => void;
}

/**
 * The failure state, as a sheet over Review & Pay rather than a screen
 * replacing it.
 *
 * The chosen direction's point: the driver keeps the total, the window and the
 * hold countdown in view while deciding what to do. A full screen takes all
 * three away at exactly the moment they are deciding whether to spend money
 * again.
 *
 * Copy is `website.md` §6 verbatim. It does not apologise, does not mention
 * Razorpay, and does not repeat the gateway's own error text — which is written
 * for an integrator, not for someone standing next to their car.
 *
 * Motion comes from tokens — `duration.base` for the scrim, `duration.slow` for
 * the sheet's travel — because a hand-tuned duration is a token that was not
 * written. Both are dropped entirely when the system asks for reduced motion:
 * a sheet that slides in front of someone who has asked things to stop moving is
 * the wrong answer even when it is pretty, and `BookingCard` and
 * `SegmentedChoice` already set this precedent.
 */
export function PaymentFailedSheet({
  visible,
  canChangeMethod,
  onTryAgain,
  onChangeMethod,
  onDismiss,
}: PaymentFailedSheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDismiss}>
      <Animated.View
        entering={
          reduceMotion
            ? undefined
            : FadeIn.duration(duration.base).easing(Easing.bezier(...easing.standard))
        }
        style={styles.scrim}
      >
        {/* Tapping the scrim dismisses. The booking is untouched either way —
            the slot stays held and the driver can pay from the screen behind. */}
        <Pressable
          style={styles.scrimTap}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close and go back to the booking"
        />

        <Animated.View
          entering={
            reduceMotion
              ? undefined
              : FadeInDown.duration(duration.slow).easing(Easing.bezier(...easing.decelerate))
          }
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.base }]}
        >
          <View style={styles.grabber} />

          <View style={styles.icon}>
            <MaterialCommunityIcons name="close-circle-outline" size={28} color={colors.errorInk} />
          </View>

          <View style={styles.copy}>
            <Text style={styles.title}>Payment didn&rsquo;t go through</Text>
            <Text style={styles.body}>Try again or use a different method.</Text>
          </View>

          <View style={styles.actions}>
            <Button label="Try Again" onPress={onTryAgain} />
            {canChangeMethod ? (
              <Button label="Change Method" variant="secondary" onPress={onChangeMethod} />
            ) : null}
            {/*
              "Back to the booking" described where the driver already was.
              This says what the tap does, and leaves the slot held.
            */}
            <Button label="Not now" variant="ghost" onPress={onDismiss} />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    justifyContent: 'flex-end',
  },
  scrimTap: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.base,
    gap: spacing.base,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.errorLight,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  copy: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  body: {
    fontSize: fontSize.base,
    lineHeight: fontSize.base * lineHeight.normal,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  actions: {
    gap: spacing.sm,
  },
});
