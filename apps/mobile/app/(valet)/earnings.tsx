import { colors, fontSize, fontWeight, spacing } from '@parkease/tokens';
import { ErrorState, Skeleton } from '@parkease/ui-native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveScreenState } from '@/features/shared/screen-state';
import { EarningsSummary } from '@/features/valet/components/EarningsSummary';
import { useValetEarnings } from '@/features/valet/hooks/useValetQueries';

/**
 * Earnings, read from the ledger.
 *
 * `GET /valet/earnings` answers from `owner_payable` for this valet's
 * counterparty id (R-MONEY-05) and returns four numbers. There is deliberately
 * no per-job fee breakdown here: the endpoint does not return one, and deriving
 * it would mean putting the commission rate into `apps/mobile`, which R-FE-06
 * bans and a CI grep catches.
 */
export default function ValetEarningsScreen() {
  const insets = useSafeAreaInsets();
  const earnings = useValetEarnings();
  const screen = resolveScreenState(earnings);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Earnings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {screen === 'loading' ? (
          <View style={styles.skeletons} testID="earnings-skeleton">
            <Skeleton height={150} width="100%" />
          </View>
        ) : screen === 'error' ? (
          <ErrorState
            title="Couldn't load earnings"
            body="Check your connection and try again."
            onAction={() => void earnings.refetch()}
          />
        ) : screen === 'empty' ||
          earnings.data === undefined ||
          earnings.data.jobsCompleted === 0 ? (
          <View style={styles.centered} testID="earnings-empty">
            <Text style={styles.emptyTitle}>No earnings yet</Text>
            <Text style={styles.emptyBody}>
              Complete a valet job and what you earned appears here.
            </Text>
          </View>
        ) : (
          <>
            <EarningsSummary summary={earnings.data} />
            <Text style={styles.footnote}>
              These figures come from the ParkEase ledger. If something looks wrong, contact support
              — the ledger is the record.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  scroll: { padding: spacing.base, gap: spacing.base },
  skeletons: { gap: spacing.base },
  centered: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing['3xl'] },
  emptyTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  emptyBody: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  footnote: {
    fontSize: fontSize.xs,
    color: colors.textTertiary,
    paddingHorizontal: spacing.xs,
    lineHeight: fontSize.xs * 1.5,
  },
});
