import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { ErrorState, Skeleton } from '@parkease/ui-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveScreenState } from '@/features/shared/screen-state';
import { OnlineStatusBar } from '@/features/valet/components/OnlineStatusBar';
import { ProofCapture } from '@/features/valet/components/ProofCapture';
import { EVENT_LABELS, StageFocus } from '@/features/valet/components/StageFocus';
import { useBackgroundLocation } from '@/features/valet/hooks/useBackgroundLocation';
import { useProofCapture } from '@/features/valet/hooks/useProofCapture';
import { useActiveJob, useAdvanceJob } from '@/features/valet/hooks/useValetQueries';
import { newIntent, type Intent } from '@/lib/api';
import { warn } from '@/lib/log';
import { formatPaise } from '@/lib/money';

/** Events that may not fire until a proof photo is attached. */
const PROOF_GATED = new Set(['confirm_parked']);

/**
 * Hand off to whatever maps app the valet actually uses.
 *
 * `geo:` is the Android intent every navigation app registers, so this does not
 * pick a vendor for them — and ADR-024 keeps us off a paid maps SDK, so the
 * handoff is the whole strategy rather than a fallback.
 */
function openDirections(lat: number, lng: number, label: string): void {
  const point = `${String(lat)},${String(lng)}`;
  const url = `geo:${point}?q=${point}(${encodeURIComponent(label)})`;
  void Linking.openURL(url).catch((error: unknown) => {
    warn('valet.navigate: no app handled the geo intent', error);
    Alert.alert('No maps app', 'Install a maps app to get directions.');
  });
}

function NavigateButton({
  lat,
  lng,
  label,
}: {
  readonly lat: number;
  readonly lng: number;
  readonly label: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Navigate to ${label}`}
      onPress={() => {
        openDirections(lat, lng, label);
      }}
      style={styles.navigate}
    >
      <MaterialCommunityIcons name="navigation-variant-outline" size={18} color={colors.primary} />
      <Text style={styles.navigateLabel}>Navigate</Text>
    </Pressable>
  );
}

export default function ValetActiveScreen() {
  const insets = useSafeAreaInsets();
  const job = useActiveJob();
  const advance = useAdvanceJob();

  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [intent, setIntent] = useState<Intent>(() => newIntent());

  const data = job.data ?? null;
  // A job in hand means High accuracy and the fast cadence.
  const tracking = useBackgroundLocation(data !== null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  // Held above the query boundary on purpose: the error state must not lose a
  // photo the valet already captured after locking the car.
  const proof = useProofCapture(data?.id ?? null);
  const screen = resolveScreenState(job);

  const handleAdvance = useCallback(
    (event: string) => {
      if (data === null) return;
      advance.mutate(
        { jobId: data.id, event, intent },
        {
          onSuccess: () => {
            setIntent(newIntent());
            proof.reset();
          },
          onError: () => {
            Alert.alert('That step is no longer available', 'The job has been refreshed.');
            setIntent(newIntent());
          },
        },
      );
    },
    [advance, data, intent, proof],
  );

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
  // The SERVER holding a photo is what clears the gate — a local capture that
  // has not uploaded yet is not proof of anything.
  const proofReady = data.proofPhotoId !== null || proof.attached;
  const blocked = needsProof && !proofReady;

  const doneCount = [data.acceptedAt, data.arrivedAt, data.parkedAt].filter(
    (stamp) => stamp !== null,
  ).length;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Active job</Text>
      </View>

      {/*
        The task put this on Offers only, which is the screen where it matters
        least. While a valet is actually carrying someone's car, a dead feed is
        the driver watching a pin that stopped moving.
      */}
      <OnlineStatusBar
        isOnline={tracking.state === 'tracking'}
        busy={tracking.state === 'starting'}
        lastFixAt={tracking.lastFixAt}
        granted={tracking.granted}
        now={now}
        onToggle={() => {
          Alert.alert('Finish this job first', 'You can go offline once the car is delivered.');
        }}
        onFix={() => void Linking.openSettings()}
      />

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

        {data.status === 'return_requested' || data.status === 'returning' ? (
          <View style={styles.returnBanner} accessibilityRole="alert">
            <MaterialCommunityIcons name="keyboard-return" size={20} color={colors.primaryDark} />
            <View style={styles.returnCopy}>
              <Text style={styles.returnTitle}>Return requested</Text>
              {data.returnEarningsPaise === null ? null : (
                <Text style={styles.returnEarnings}>
                  {`You earn ${formatPaise(data.returnEarningsPaise, { alwaysDecimals: true })}`}
                </Text>
              )}
            </View>
          </View>
        ) : null}

        <View style={styles.panel}>
          <Text style={styles.panelLabel}>PICKUP</Text>
          <Text style={styles.panelValue}>{data.pickupAddress}</Text>
          <NavigateButton
            lat={data.pickupLocation.lat}
            lng={data.pickupLocation.lng}
            label={data.pickupAddress}
          />
        </View>

        {data.returnDropLocation === null ? null : (
          <View style={styles.panel}>
            <Text style={styles.panelLabel}>DROP AT</Text>
            <Text style={styles.panelValue}>Where the driver asked for the car</Text>
            <NavigateButton
              lat={data.returnDropLocation.lat}
              lng={data.returnDropLocation.lng}
              label="drop point"
            />
          </View>
        )}

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
            capturedUri={proof.uri}
            uploading={proof.uploading}
            error={proof.error}
            onCaptured={(uri) => void proof.attach(uri)}
            onRetry={() => void proof.retry()}
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
              {EVENT_LABELS[nextEvent] ?? nextEvent}
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
  navigate: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  navigateLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary },
  returnBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  returnCopy: { flex: 1, gap: 2 },
  returnTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primaryDark },
  returnEarnings: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.text },
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
