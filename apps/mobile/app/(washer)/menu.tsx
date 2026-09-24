import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { ErrorState, Skeleton } from '@parkease/ui-native';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveScreenState } from '@/features/shared/screen-state';
import { loadFailureCopy } from '@/features/washer/api/errors';
import { ProfileGear } from '@/features/washer/components/ProfileGear';
import { RefreshNotice } from '@/features/washer/components/RefreshNotice';
import { ServiceRow } from '@/features/washer/components/ServiceRow';
import { useServiceSave } from '@/features/washer/hooks/useServiceSave';
import { useServiceMenu } from '@/features/washer/hooks/useWasherQueries';
import { toMenuRows } from '@/features/washer/menu-rows';

function MenuSkeleton() {
  return (
    <View style={styles.body} testID="menu-skeleton">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} width="100%" height={196} borderRadius={radius.lg} />
      ))}
    </View>
  );
}

/**
 * §6.3 — the service menu, direction "Bay".
 *
 * Five rows, one per service, each with a car price and a bike price saved
 * together; the API stores them as two rows the partner never sees. Exactly
 * five, always, so a `ScrollView` rather than a `FlashList` (R-FE-07 is for
 * lists of unknown length).
 *
 * The wireframe's "you earn 80% after the ParkEase fee" footnote is not here:
 * it is a rate in `apps/mobile` (R-FE-06), and every offer card already states
 * the real take-home in rupees.
 */
export default function WasherMenuScreen() {
  const insets = useSafeAreaInsets();
  const menu = useServiceMenu();
  const saver = useServiceSave();

  const content = (): ReactNode => {
    switch (resolveScreenState(menu)) {
      case 'loading':
        return <MenuSkeleton />;
      case 'error':
        return (
          <ErrorState
            title="Couldn't load your menu"
            body={loadFailureCopy(menu.error)}
            onAction={() => void menu.refetch()}
          />
        );
      // `toMenuRows` always yields all five services, priced or not, so a loaded
      // menu is never empty: an unpriced row IS the first-run state.
      case 'empty':
      case 'ready':
        return (
          <>
            {menu.isError ? (
              // The rows stay on screen (ruling T7-I2); this only says the
              // latest refresh failed, and offers another.
              <RefreshNotice
                testID="menu-refresh-notice"
                retryLabel="Refresh the menu"
                onRetry={() => void menu.refetch()}
              />
            ) : null}
            <ScrollView
              contentContainerStyle={styles.body}
              // A tap on Save with the keyboard up saves, rather than only
              // dismissing the keyboard and needing a second tap.
              keyboardShouldPersistTaps="handled"
            >
              {toMenuRows(menu.data?.services ?? []).map((row) => (
                <ServiceRow
                  // One key per service, never over its values: a save updates
                  // the row in place, so TalkBack's focus stays on Save (H6).
                  key={row.serviceName}
                  row={row}
                  saving={saver.isSaving(row.serviceName)}
                  failure={saver.failureFor(row.serviceName)}
                  onSave={(input) => void saver.save(row.serviceName, input)}
                />
              ))}
            </ScrollView>
          </>
        );
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.titleRow}>
          <Text style={styles.title} accessibilityRole="header">
            Service menu
          </Text>
          <ProfileGear />
        </View>
        <Text style={styles.subtitle}>A car price and a bike price for each wash you offer.</Text>
      </View>
      {content()}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    gap: spacing.xs,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.sm, color: colors.textTertiary },
  body: { padding: spacing.base, gap: spacing.base },
});
