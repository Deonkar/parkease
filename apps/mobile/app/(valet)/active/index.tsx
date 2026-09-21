import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { ErrorState, Skeleton } from '@parkease/ui-native';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveScreenState } from '@/features/shared/screen-state';
import { ProofCapture } from '@/features/valet/components/ProofCapture';
import { EVENT_LABELS, STAGE_LABELS, StageFocus } from '@/features/valet/components/StageFocus';
import { useActiveJob, useAdvanceJob } from '@/features/valet/hooks/useValetQueries';
import { newIntent, type Intent } from '@/lib/api';
import { formatPaise } from '@/lib/money';

/** Events that may not fire until a proof photo is attached. */
const PROOF_GATED = new Set(['confirm_parked']);

export default function ValetActiveScreen() {
  const insets = useSafeAreaInsets();
  const job = useActiveJob();
  const advance = useAdvanceJob();

  const [expanded, setExpanded] = useState(false);
  // Held above the query boundary on purpose: the error state must not lose a
  // photo the valet already captured after locking the car.
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [intent, setIntent] = useState<Intent>(() => newIntent());

  const data = job.data ?? null;
  const screen = resolveScreenState(job);

  const handleAdvance = useCallback(
    (event: string) => {
      if (data === null) return;
      advance.mutate(
        { jobId: data.id, event, intent },
        {
          onSuccess: () => {
            setIntent(newIntent());
            setProofUri(null);
            setProofError(null);
          },
          onError: () => {
            Alert.alert('That step is no longer available', 'The job has been refreshed.');
            setIntent(newIntent());
          },
        },
      );
    },
    [advance, data, intent],
  );

  const handleCapture = useCallback(() => {
    // The camera is a native module; the browser preview cannot open one.
    Alert.alert(
      'Camera unavailable here',
      'Proof capture needs the Android build. This preview cannot open a camera.',
    );
    setProofError(null);
  }, []);

  if (screen === 'loading') {
    return (
      <View style={[styles.root, { paddingTop: insets.top + spacing.base }]}>
        <View style={styles.skeletons} testID="active-skeleton">
          <Skeleton height={22} width="40%" />
          <Skeleton height={44} width="70%" />
          <Skeleton height={110} width="100%" />
          <Skeleton height={68} width="100%" />
        </View>
      </View>
    );
  }

  if (screen === 'error') {
    return (
      <View style={[styles.root, { paddingTop: insets.top + spacing.base }]}>
        <ErrorState
          title="Couldn't load your job"
          body="Check your connection and try again."
          onAction={() => void job.refetch()}
        />
      </View>
    );
  }

  if (screen === 'empty' || data === null) {
    return (
      <View
        style={[styles.root, styles.centered, { paddingTop: insets.top }]}
        testID="active-empty"
      >
        <Text style={styles.emptyTitle}>No active job</Text>
        <Text style={styles.emptyBody}>Accept an offer and it will appear here.</Text>
      </View>
    );
  }

  // Which events are legal comes from the server's state machine, never from a
  // table this app maintains a second copy of.
  const [nextEvent] = data.availableEvents;
  const needsProof = nextEvent !== undefined && PROOF_GATED.has(nextEvent);
  const proofReady = data.proofPhotoId !== null || proofUri !== null;
  const blocked = needsProof && !proofReady;

  const doneCount = [data.acceptedAt, data.arrivedAt, data.parkedAt].filter(
    (stamp) => stamp !== null,
  ).length;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Active job</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <StageFocus
          status={data.status}
          historyLabel={doneCount === 0 ? null : `${String(doneCount)} steps done`}
          expanded={expanded}
          onToggleHistory={() => {
            setExpanded((open) => !open);
          }}
        />

        {expanded ? (
          <View style={styles.historyPanel}>
            {(
              [
                ['Accepted', data.acceptedAt],
                ['Arrived', data.arrivedAt],
                ['Parked', data.parkedAt],
              ] as const
            )
              .filter(([, stamp]) => stamp !== null)
              .map(([label, stamp]) => (
                <View key={label} style={styles.historyRow}>
                  <Text style={styles.historyLabel}>{label}</Text>
                  <Text style={styles.historyTime}>
                    {new Date(stamp as string).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
              ))}
          </View>
        ) : null}

        <View style={styles.panel}>
          <Text style={styles.panelLabel}>PICKUP</Text>
          <Text style={styles.panelValue}>{data.pickupAddress}</Text>
        </View>

        {data.earningsPaise === null ? null : (
          <View style={styles.earnings}>
            <Text style={styles.earningsLabel}>You earn</Text>
            <Text style={styles.earningsValue}>
              {formatPaise(data.earningsPaise, { alwaysDecimals: true })}
            </Text>
          </View>
        )}

        {needsProof ? (
          <ProofCapture
            capturedUri={proofUri}
            uploading={false}
            error={proofError}
            onCapture={handleCapture}
            onRetry={handleCapture}
          />
        ) : null}
      </ScrollView>

      {nextEvent === undefined ? null : (
        <View style={styles.dock}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              blocked
                ? `${EVENT_LABELS[nextEvent] ?? nextEvent}, locked until a proof photo is attached`
                : (EVENT_LABELS[nextEvent] ?? nextEvent)
            }
            accessibilityState={{ disabled: blocked || advance.isPending }}
            disabled={blocked || advance.isPending}
            onPress={() => {
              handleAdvance(nextEvent);
            }}
            style={[styles.primary, blocked && styles.primaryLocked]}
          >
            <Text style={[styles.primaryLabel, blocked && styles.primaryLabelLocked]}>
              {EVENT_LABELS[nextEvent] ?? STAGE_LABELS[nextEvent] ?? nextEvent}
            </Text>
          </Pressable>
          {blocked ? (
            <Text style={styles.blockedReason}>Unlocks once the photo is attached</Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  centered: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  header: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  scroll: { padding: spacing.base, gap: spacing.base },
  skeletons: { padding: spacing.lg, gap: spacing.base },
  historyPanel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between' },
  historyLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  historyTime: { fontSize: fontSize.xs, color: colors.textTertiary },
  panel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  panelLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.4,
  },
  panelValue: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text },
  earnings: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  earningsLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  earningsValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  dock: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.base,
    gap: spacing.sm,
  },
  primary: {
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLocked: { backgroundColor: colors.border },
  primaryLabel: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.textInverse },
  primaryLabelLocked: { color: colors.muted },
  blockedReason: { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'center' },
  emptyTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  emptyBody: { fontSize: fontSize.sm, color: colors.textSecondary },
});
