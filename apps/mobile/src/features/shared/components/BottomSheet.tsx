import { colors, duration, easing, radius, spacing } from '@parkease/tokens';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
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
 * still reaches its Submit.
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
          accessibilityRole="button"
          accessibilityLabel={dismissLabel}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
        </KeyboardAvoidingView>
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
