import { colors, fontSize, fontWeight } from '@parkease/tokens';
import { StyleSheet, Text, View } from 'react-native';

export interface AmountRowProps {
  readonly label: string;
  readonly value: string;
  readonly testID: string;
  readonly emphasis?: boolean;
}

/**
 * One labelled amount, read by TalkBack as one phrase ("ParkEase fee, −₹79.80").
 *
 * Shared since task 15: the washer's earnings line and the owner's earnings
 * screen are its two users (R-ARCH-07), and a labelled amount is the same
 * control whichever role is looking at it.
 */
export function AmountRow({ label, value, testID, emphasis = false }: AmountRowProps) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}, ${value}`}>
      <Text style={[styles.label, emphasis && styles.labelEmphasis]}>{label}</Text>
      <Text style={[styles.amount, emphasis && styles.amountEmphasis]} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontSize: fontSize.sm, color: colors.textSecondary },
  labelEmphasis: { fontWeight: fontWeight.semibold, color: colors.text },
  // Tabular figures, so amounts align down their right edge.
  amount: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  amountEmphasis: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.text },
});
