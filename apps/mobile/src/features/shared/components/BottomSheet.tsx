import { colors, duration, easing, radius, spacing } from '@parkease/tokens';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface BottomSheetProps {
  readonly visible: boolean;
  readonly onDismiss: () => void;
  /** Spoken for the scrim, which dismisses: say what closing does. */
  readonly dismissLabel: string;
  readonly children: ReactNode;
}

/**
 * The sheet shell the review flows share (rating, report): scrim, grabber, safe area, keyboard.
 * Motion is `PaymentFailedSheet`'s — `duration.base` for the scrim, `duration.slow` for the travel —
 * and none at all under reduced motion. Content scrolls, so a tall sheet with the keyboard up
 * still reaches its Submit. No KeyboardAvoidingView: Android (the only platform, ADR-023) resizes
 * the window for the keyboard itself, and on web the wrapper left a 64px gap under the sheet.
 */
export function BottomSheet({ visible, onDismiss, dismissLabel, children }: BottomSheetProps) {
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
        <Pressable
          style={styles.scrimTap}
          onPress={onDismiss}
          accessibilityLabel={dismissLabel}
          // Out of TalkBack's order, so focus lands on the sheet's title, not "Close". Back and the
          // sheet's own Cancel / Maybe later still dismiss it.
          accessible={false}
          importantForAccessibility="no"
        />
        <Animated.View
          entering={
            reduceMotion
              ? undefined
              : FadeInDown.duration(duration.slow).easing(Easing.bezier(...easing.decelerate))
          }
          style={styles.sheet}
        >
          <View style={styles.grabber} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.content,
              { paddingBottom: insets.bottom + spacing.base },
            ]}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  scrimTap: { flex: 1 },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  content: { paddingHorizontal: spacing.base, gap: spacing.base },
});
