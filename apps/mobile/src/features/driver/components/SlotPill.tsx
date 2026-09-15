import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors, fontSize, radius, spacing, spring } from '@parkease/tokens';
import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

interface SlotPillProps {
  readonly icon: 'car' | 'motorbike';
  readonly count: number;
  readonly open: boolean;
}

/**
 * Free-slot count for one vehicle type.
 *
 * Green here means exactly one thing: a slot free right now. A space that is
 * closed, or has nothing free, goes muted — never red, because unavailable is
 * not an error.
 */
export function SlotPill({ icon, count, open }: SlotPillProps) {
  const free = open && count > 0;
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);

  // A changed count is the one number on this screen that can cost the driver
  // the spot, so it gets a beat of motion rather than swapping silently.
  useEffect(() => {
    if (reduceMotion) return;
    scale.value = withSequence(withSpring(1.12, spring.snappy), withSpring(1, spring.responsive));
  }, [count, reduceMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.pill, free ? styles.pillFree : styles.pillEmpty, animatedStyle]}>
      <MaterialCommunityIcons
        name={icon}
        size={14}
        color={free ? colors.availableInk : colors.textTertiary}
      />
      <Text style={[styles.text, free ? styles.textFree : styles.textEmpty]}>
        {String(count)} free
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  pillFree: {
    backgroundColor: colors.availableSoft,
  },
  pillEmpty: {
    backgroundColor: colors.mutedSoft,
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  textFree: {
    color: colors.availableInk,
  },
  textEmpty: {
    color: colors.textTertiary,
  },
});
