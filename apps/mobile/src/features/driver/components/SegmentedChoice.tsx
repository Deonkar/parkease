import { colors, fontSize, fontWeight, radius, spacing, spring } from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
}

interface SegmentedChoiceProps<T extends string> {
  readonly label: string;
  readonly choices: readonly Choice<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}

/** Material's floor for a touch target, and the floor for these too. */
const MIN_TARGET = 48;

/**
 * A row of mutually exclusive options.
 *
 * A disabled choice stays visible rather than disappearing: "this space has no
 * two-wheeler slots" is information, and a silently missing option reads as a
 * bug. It is announced as disabled rather than just dimmed, because dimming is
 * a colour signal and colour is never the only signal (R-FE-12).
 */
export function SegmentedChoice<T extends string>({
  label,
  choices,
  value,
  onChange,
}: SegmentedChoiceProps<T>) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel} accessibilityRole="header">
        {label}
      </Text>
      <View style={styles.row} accessibilityRole="radiogroup">
        {choices.map((choice) => (
          <Segment
            key={choice.value}
            choice={choice}
            selected={choice.value === value}
            onPress={() => {
              onChange(choice.value);
            }}
          />
        ))}
      </View>
    </View>
  );
}

function Segment<T extends string>({
  choice,
  selected,
  onPress,
}: {
  readonly choice: Choice<T>;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const disabled = choice.disabled === true;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => {
        if (!reduceMotion && !disabled) scale.value = withSpring(0.96, spring.snappy);
      }}
      onPressOut={() => {
        if (!reduceMotion && !disabled) scale.value = withSpring(1, spring.responsive);
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={choice.label}
      style={styles.segmentWrap}
    >
      <Animated.View
        style={[
          styles.segment,
          selected && styles.segmentSelected,
          disabled && styles.segmentDisabled,
          animatedStyle,
        ]}
      >
        <Text
          style={[
            styles.segmentText,
            selected && styles.segmentTextSelected,
            disabled && styles.segmentTextDisabled,
          ]}
        >
          {choice.label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.sm,
  },
  groupLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  segmentWrap: {
    flexGrow: 1,
    flexBasis: '30%',
  },
  segment: {
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segmentSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  segmentDisabled: {
    backgroundColor: colors.mutedSoft,
    borderColor: colors.border,
  },
  segmentText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
  },
  segmentTextSelected: {
    color: colors.primaryDark,
    fontWeight: fontWeight.semibold,
  },
  segmentTextDisabled: {
    color: colors.textTertiary,
  },
});
