import { colors, fontSize, fontWeight, layout, spacing, touchTarget } from '@parkease/tokens';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AccountButton } from './AccountButton';

export interface WasherHeaderProps {
  /** The tab's own name, so the bar and the header agree (M13). */
  readonly title: string;
  readonly subtitle?: string;
  /** False on the Profile screen itself, which the button would open. */
  readonly account?: boolean;
  /** Under the title row, inside the header: the earnings period tabs. */
  readonly children?: ReactNode;
}

/**
 * The one header of the washer screens (M7, M13): one title scale everywhere,
 * the account button on every tab, and its content in the readable column (M6).
 * Before, each screen drew its own header, and Profile's title was a size
 * larger than the other four.
 */
export function WasherHeader({ title, subtitle, account = true, children }: WasherHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + spacing.sm },
        children === undefined && styles.rootPadded,
      ]}
    >
      <View style={styles.content} testID="washer-header-content">
        <View style={styles.row}>
          <View style={styles.text}>
            <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
              {title}
            </Text>
            {subtitle === undefined ? null : <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
          {account ? <AccountButton /> : null}
        </View>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: spacing.base,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rootPadded: { paddingBottom: spacing.sm },
  content: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center' },
  // The account button's 48dp target sets the row's height; a header without
  // one keeps the same height, so titles sit at one baseline on every screen.
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget },
  text: { flex: 1, gap: spacing.xs },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.sm, color: colors.textTertiary },
});
