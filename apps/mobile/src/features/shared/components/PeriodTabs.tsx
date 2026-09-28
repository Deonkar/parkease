import { colors, fontSize, fontWeight, spacing, touchTarget } from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface PeriodTabsProps<P extends string> {
  readonly values: readonly P[];
  readonly label: (period: P) => string;
  readonly value: P;
  readonly onChange: (period: P) => void;
}

/**
 * One period at a time (spec §4.3), rather than the wireframe's three side
 * by side.
 *
 * Real tabs: a `tablist` of `tab`s with `selected` state, so TalkBack
 * announces the label, that it is selected, and its position among the rest
 * (e.g. "Week, tab, selected, 2 of 4"). The selection is marked by an indicator
 * bar and a heavier weight as well as colour (R-FE-12). The order comes from
 * the caller's own tuple, so a new period cannot be silently left off.
 *
 * Shared since task 15: the owner's earnings screen is its second user
 * (R-ARCH-07), and a tab that looks different per role is two controls to
 * learn.
 */
export function PeriodTabs<P extends string>({
  values,
  label,
  value,
  onChange,
}: PeriodTabsProps<P>) {
  return (
    <View style={styles.root} accessibilityRole="tablist">
      {values.map((period) => {
        const selected = period === value;
        return (
          <Pressable
            key={period}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) onChange(period);
            }}
            android_ripple={{ color: colors.primarySoft }}
            style={styles.tab}
            testID={`period-tab-${period}`}
          >
            <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={1}>
              {label(period)}
            </Text>
            {selected ? (
              <View style={styles.indicator} testID={`period-tab-${period}-indicator`} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const INDICATOR_HEIGHT = 3;

const styles = StyleSheet.create({
  root: { flexDirection: 'row' },
  tab: {
    flex: 1,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.tabInactive },
  labelSelected: { fontWeight: fontWeight.bold, color: colors.tabActive },
  indicator: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: 0,
    height: INDICATOR_HEIGHT,
    borderTopLeftRadius: INDICATOR_HEIGHT,
    borderTopRightRadius: INDICATOR_HEIGHT,
    backgroundColor: colors.tabActive,
  },
});
