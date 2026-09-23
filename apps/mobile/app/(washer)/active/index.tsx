import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { WashJobView } from '@parkease/contracts/washer';
import { colors, elevation, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { EmptyState, ErrorState, Skeleton } from '@parkease/ui-native';
import { useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveScreenState } from '@/features/shared/screen-state';
import { apiErrorCodeOf, isDefiniteRefusal } from '@/features/washer/api/errors';
import { ElapsedBar, elapsedMinutesSince } from '@/features/washer/components/ElapsedBar';
import { EvidencePair, type EvidenceSlotView } from '@/features/washer/components/EvidencePair';
import { RefreshNotice } from '@/features/washer/components/RefreshNotice';
import { StepRail } from '@/features/washer/components/StepRail';
import { WashActionBar } from '@/features/washer/components/WashActionBar';
import { WashCamera } from '@/features/washer/components/WashCamera';
import { usePhotoSlot, type PhotoSlotCapture } from '@/features/washer/hooks/usePhotoSlot';
import {
  useActiveWash,
  useAdvanceWash,
  useServiceMenu,
} from '@/features/washer/hooks/useWasherQueries';
import { SERVICE_LABELS, VEHICLE_LABELS } from '@/features/washer/labels';
import {
  canWriteSlot,
  lockReasonFor,
  primaryActionFor,
  slotStateFor,
  type PhotoSlot,
} from '@/features/washer/photo-gate';
import { newIntent, type Intent } from '@/lib/api';
import { warn } from '@/lib/log';
import { formatPaise } from '@/lib/money';

/** How often the elapsed bar re-reads the clock. It shows whole minutes. */
const ELAPSED_TICK_MS = 30_000;

function EmptyIcon({ name }: { readonly name: keyof typeof MaterialCommunityIcons.glyphMap }) {
  return <MaterialCommunityIcons name={name} size={48} color={colors.textTertiary} />;
}

function ActiveSkeleton() {
  return (
    <View style={styles.skeleton} testID="active-skeleton">
      <View style={styles.skeletonPair}>
        <View style={styles.skeletonHalf}>
          <Skeleton width="100%" height={120} borderRadius={radius.lg} />
        </View>
        <View style={styles.skeletonHalf}>
          <Skeleton width="100%" height={120} borderRadius={radius.lg} />
        </View>
      </View>
      <Skeleton width="100%" height={48} borderRadius={radius.md} />
      <Skeleton width="100%" height={96} borderRadius={radius.lg} />
    </View>
  );
}

/**
 * §6.2 — the active wash, direction "Bay".
 *
 * The evidence pair at the top from the moment of accept, then the step rail,
 * then time and earnings, then one primary action the server's
 * `availableEvents` chose. Nothing here keeps a transition table, and nothing
 * here computes money (R-FE-06).
 */
export default function WasherActiveScreen() {
  const insets = useSafeAreaInsets();
  const active = useActiveWash();
  const menu = useServiceMenu();
  const advance = useAdvanceWash();
  const [permission, requestPermission] = useCameraPermissions();

  // Unconditionally, before any state is chosen: a capture must outlive the
  // screen dropping into its error state and back (spec §6.2).
  const jobId = active.data?.id ?? null;
  const beforeSlot = usePhotoSlot(jobId, 'before');
  const afterSlot = usePhotoSlot(jobId, 'after');
  const slots: Readonly<Record<PhotoSlot, PhotoSlotCapture>> = {
    before: beforeSlot,
    after: afterSlot,
  };

  const [cameraSlot, setCameraSlot] = useState<PhotoSlot | null>(null);

  // R-FE-05: one intent per status change the partner asks for, reused when
  // that change is retried so a retry after a timeout replays it rather than
  // sending a second. Dropped once the server has answered for good.
  const intents = useRef(new Map<string, Intent>());

  const washing = active.data?.status === 'washing';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!washing) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, ELAPSED_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [washing]);

  const askForCamera = useCallback(
    async (slot: PhotoSlot) => {
      if (permission?.granted !== true) {
        const next = await requestPermission();
        if (!next.granted) {
          Alert.alert(
            'Camera needed',
            'ParkEase needs the camera to take the before and after photos.',
            next.canAskAgain
              ? undefined
              : [
                  { text: 'Not now', style: 'cancel' },
                  { text: 'Open Settings', onPress: () => void Linking.openSettings() },
                ],
          );
          return;
        }
      }
      setCameraSlot(slot);
    },
    [permission, requestPermission],
  );

  // The permission request can itself reject (the native module failing, an
  // activity gone mid-prompt). Handled and said, never dropped (R-FAIL-01).
  const openCamera = useCallback(
    async (slot: PhotoSlot) => {
      try {
        await askForCamera(slot);
      } catch (error) {
        warn(`washer.active: could not open the camera for the ${slot} photo`, error);
        Alert.alert("Couldn't open the camera", 'Please try again.');
      }
    },
    [askForCamera],
  );

  const navigateTo = useCallback((job: WashJobView) => {
    const { lat, lng } = job.spaceLocation;
    // Android's geo: URI — iOS is out of scope (ADR-023).
    const uri = `geo:${String(lat)},${String(lng)}?q=${String(lat)},${String(lng)}`;
    Linking.openURL(uri).catch((error: unknown) => {
      warn('washer.active: could not open maps', error);
      Alert.alert("Couldn't open maps", 'Install a maps app to get directions to the car.');
    });
  }, []);

  const runAction = useCallback(
    (job: WashJobView) => {
      const action = primaryActionFor(job.availableEvents);
      if (action === null || advance.isPending) return;

      const key = `${job.id}:${action.event}`;
      const intent = intents.current.get(key) ?? newIntent();
      intents.current.set(key, intent);

      advance.mutate(
        { jobId: job.id, event: action.event, intent },
        {
          onSuccess: () => {
            intents.current.delete(key);
          },
          onError: (error: unknown) => {
            // `useAdvanceWash` invalidates the job on every error, so a stale
            // screen — ILLEGAL_CARWASH_TRANSITION, or a photo gate the pair got
            // wrong — re-renders on the true status by itself.
            if (isDefiniteRefusal(error)) {
              intents.current.delete(key);
              warn(
                `washer.active: ${action.event} refused (${apiErrorCodeOf(error) ?? 'no code'})`,
                error,
              );
              return;
            }
            warn(`washer.active: ${action.event} did not reach the server`, error);
            Alert.alert("Couldn't update the job", 'Check your connection and try again.');
          },
        },
      );
    },
    [advance],
  );

  const ready = (job: WashJobView): ReactNode => {
    const service = SERVICE_LABELS[job.serviceName];
    const durationMinutes =
      menu.data?.services.find(
        (row) => row.serviceName === job.serviceName && row.vehicleType === job.vehicleType,
      )?.durationMinutes ?? null;

    // The gate's truth is the SERVER view (T7-T1); local state only says what
    // is in flight or failed.
    const attached = {
      before: job.beforePhotoId !== null,
      after: job.afterPhotoId !== null,
    };
    const slotView = (slot: PhotoSlot): EvidenceSlotView => {
      const capture = slots[slot];
      const writable = canWriteSlot(slot, job.status);
      return {
        state: slotStateFor(attached[slot], capture, { writable }),
        uri: capture.uri,
        writable: writable && !capture.uploading,
      };
    };

    const action = primaryActionFor(job.availableEvents);
    // Only once washing has started, and only with the partner's own estimate
    // to measure against; without one the bar is dropped rather than guessed.
    const elapsed =
      job.startedAt === null || durationMinutes === null
        ? null
        : {
            elapsedMinutes: elapsedMinutesSince(
              job.startedAt,
              job.completedAt === null ? now : Date.parse(job.completedAt),
            ),
            durationMinutes,
          };
    const finished = job.status === 'completed' || job.status === 'cancelled';

    return (
      <>
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.headerText}>
            <Text style={styles.title} accessibilityRole="header">
              {`${service} · ${VEHICLE_LABELS[job.vehicleType]}`}
            </Text>
            <Text style={styles.subtitle}>Your active job</Text>
          </View>
          {finished ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Navigate to the car"
              onPress={() => {
                navigateTo(job);
              }}
              style={styles.navigate}
              testID="active-navigate"
            >
              <MaterialCommunityIcons
                name="navigation-variant-outline"
                size={20}
                color={colors.primary}
              />
            </Pressable>
          )}
        </View>

        {active.isError ? (
          // The job stays on screen (ruling T7-I2); this only says the latest
          // refresh failed, and offers another.
          <RefreshNotice
            testID="active-refresh-notice"
            retryLabel="Refresh the job"
            onRetry={() => void active.refetch()}
          />
        ) : null}

        <ScrollView contentContainerStyle={styles.body}>
          <EvidencePair
            before={slotView('before')}
            after={slotView('after')}
            onCapture={(slot) => {
              openCamera(slot).catch((error: unknown) => {
                warn('washer.active: the camera flow failed unexpectedly', error);
              });
            }}
            onRetry={(slot) => void slots[slot].retry()}
          />

          <StepRail status={job.status} />

          {elapsed !== null || job.earningsPaise !== null ? (
            <View style={styles.card}>
              {elapsed === null ? null : <ElapsedBar {...elapsed} />}
              {job.earningsPaise === null ? null : (
                <View style={[styles.earnRow, elapsed !== null && styles.earnDivided]}>
                  <Text style={styles.earnLabel}>You earn</Text>
                  <Text style={styles.earnValue}>
                    {formatPaise(job.earningsPaise, { alwaysDecimals: true })}
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          {job.status === 'completed' ? (
            <View style={styles.done} accessibilityLiveRegion="polite">
              <MaterialCommunityIcons
                name="check-circle-outline"
                size={20}
                color={colors.availableInk}
              />
              <Text style={styles.doneText}>Job complete. Nice work.</Text>
            </View>
          ) : null}
        </ScrollView>

        {action === null ? null : (
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            <WashActionBar
              action={action}
              lockReason={lockReasonFor(action, attached)}
              pending={advance.isPending}
              onPress={() => {
                runAction(job);
              }}
            />
          </View>
        )}
      </>
    );
  };

  const content = (): ReactNode => {
    switch (resolveScreenState(active)) {
      case 'loading':
        return (
          <View style={{ paddingTop: insets.top }}>
            <ActiveSkeleton />
          </View>
        );
      case 'error':
        return (
          <ErrorState
            title="Couldn't load your job"
            body="Check your connection and try again."
            onAction={() => void active.refetch()}
          />
        );
      case 'empty':
        return (
          <EmptyState
            icon={<EmptyIcon name="car-wash" />}
            title="No active job"
            body="Accept a wash from Offers and it will appear here, with its photos and steps."
            actionLabel="Go to offers"
            onAction={() => {
              router.navigate('/(washer)/offers');
            }}
          />
        );
      case 'ready':
        return active.data ? ready(active.data) : null;
    }
  };

  return (
    <View style={styles.root}>
      {content()}
      {/* Outside the state switch, so a refetch that errors while the camera is
          open cannot tear the camera down mid-shot. */}
      <WashCamera
        slot={cameraSlot}
        onCaptured={(slot, uri) => void slots[slot].capture(uri)}
        onClose={() => {
          setCameraSlot(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerText: { flex: 1, gap: spacing.xs },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  subtitle: { fontSize: fontSize.sm, color: colors.textTertiary },
  navigate: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  body: { padding: spacing.base, gap: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    ...elevation.card,
  },
  earnRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  earnDivided: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  earnLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  earnValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  done: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.availableSoft,
  },
  doneText: { flex: 1, fontSize: fontSize.sm, color: colors.availableInk },
  footer: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  skeleton: { padding: spacing.base, gap: spacing.lg },
  skeletonPair: { flexDirection: 'row', gap: spacing.md },
  skeletonHalf: { flexGrow: 1, flexBasis: 0 },
});
