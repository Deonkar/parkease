import {
  WASHER_EARNINGS_PERIOD_VALUES,
  type WasherEarningsPeriod,
} from '@parkease/contracts/washer';
import { colors, fontSize, fontWeight, spacing } from '@parkease/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PERIOD_LABELS } from '../labels';

export interface PeriodTabsProps {
  readonly value: WasherEarningsPeriod;
  readonly onChange: (period: WasherEarningsPeriod) => void;
}

/**
 * Today · This week · This month · All — one figure at a time (spec §4.3),
 * rather than the wireframe's three side by side.
 *
 * Real tabs: a `tablist` of `tab`s with `selected` state, so TalkBack says
 * "This week, tab, selected, 2 of 4". The selection is marked by an indicator
 * bar and a heavier weight as well as colour (R-FE-12). The order comes from
 * the contract's own tuple, so a new period cannot be silently left off.
 */
export function PeriodTabs({ value, onChange }: PeriodTabsProps) {
  return (
    <View style={styles.root} accessibilityRole="tablist">
      {WASHER_EARNINGS_PERIOD_VALUES.map((period) => {
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
              {PERIOD_LABELS[period].tab}
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

/** Material's minimum tab height; the indicator sits inside it, not below. */
const TAB_HEIGHT = 48;
const INDICATOR_HEIGHT = 3;

const styles = StyleSheet.create({
  root: { flexDirection: 'row' },
  tab: {
    flex: 1,
    minHeight: TAB_HEIGHT,
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
