import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export interface KpiCardProps {
  readonly label: string;
  readonly value: string;
  readonly caption?: string | null;
  readonly testID: string;
  readonly hero?: boolean;
  /**
   * Rendered below the caption, inside the same card surface — never a
   * second bordered box nested inside this one (D1: a card inside a card is
   * never right). Kept OUTSIDE the `accessible` figure below so its own
   * accessibility (e.g. `EarningsBars`' image label) is not swallowed by the
   * figure's single phrase.
   */
  readonly children?: ReactNode;
}

/** A labelled figure, read by TalkBack as one phrase (R-FE-12). */
export function KpiCard({ label, value, caption, testID, hero = false, children }: KpiCardProps) {
  return (
    <View style={[styles.root, hero && styles.hero]}>
      <View
        style={styles.figure}
        accessible
        accessibilityLabel={[label, value, caption].filter(Boolean).join(', ')}
        testID={testID}
      >
        <Text style={styles.label}>{label.toUpperCase()}</Text>
        <Text style={[styles.value, hero && styles.valueHero]}>{value}</Text>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    gap: spacing.base,
    padding: spacing.base,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  hero: { padding: spacing.lg },
  figure: { gap: spacing.xs },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.4,
  },
  value: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  valueHero: { fontSize: fontSize['4xl'] },
  caption: { fontSize: fontSize.sm, color: colors.textSecondary },
});
