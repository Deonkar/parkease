import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { WashJobView } from '@parkease/contracts/washer';
import {
  colors,
  elevation,
  fontSize,
  fontWeight,
  layout,
  radius,
  spacing,
  touchTarget,
} from '@parkease/tokens';
import { EmptyState, ErrorState, Skeleton } from '@parkease/ui-native';
import { useCameraPermissions } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAnnounce } from '@/features/shared/hooks/useAnnounce';
import { resolveScreenState } from '@/features/shared/screen-state';
import { advanceOutcomeFor } from '@/features/washer/action-outcomes';
import { loadFailureCopy } from '@/features/washer/api/errors';
import { ElapsedBar, elapsedMinutesSince } from '@/features/washer/components/ElapsedBar';
import { EvidencePair, type EvidenceSlotView } from '@/features/washer/components/EvidencePair';
import { JobEndFooter, JobWonNotice } from '@/features/washer/components/JobMoments';
import { ReadableColumn } from '@/features/washer/components/ReadableColumn';
import { RefreshNotice } from '@/features/washer/components/RefreshNotice';
import { StepRail, currentStepFor } from '@/features/washer/components/StepRail';
import { WashActionBar } from '@/features/washer/components/WashActionBar';
import { WashCamera } from '@/features/washer/components/WashCamera';
import { WasherHeader } from '@/features/washer/components/WasherHeader';
import { usesDevCamera } from '@/features/washer/dev-camera';
import { usePhotoSlot, type PhotoSlotCapture } from '@/features/washer/hooks/usePhotoSlot';
import {
  useActiveWash,
  useAdvanceWash,
  useServiceMenu,
} from '@/features/washer/hooks/useWasherQueries';
import { jobEndFor, showsJobWon } from '@/features/washer/job-moments';
import { SERVICE_LABELS, VEHICLE_LABELS } from '@/features/washer/labels';
import {
  canWriteSlot,
  lockReasonFor,
  primaryActionFor,
  slotStateFor,
  type PhotoSlot,
} from '@/features/washer/photo-gate';
import { newIntent, type Intent } from '@/lib/api';
import { assertNever } from '@/lib/assert-never';
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
  // The job the offers screen has just won, for the "It's yours" moment (M9).
  const params = useLocalSearchParams<{ won?: string }>();
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
  /** Why the last status change did not happen, said above the action (G2). */
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  // H4: every notice on this screen is announced when it appears.
  useAnnounce(actionNotice);
  useAnnounce(active.data?.status === 'completed' ? 'Job complete. Nice work.' : null);

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
      // The dev-mock browser preview has no camera to grant; its stand-in needs
      // no permission (ruling T11-W1). Never true on a device.
      if (await usesDevCamera()) {
        setCameraSlot(slot);
        return;
      }
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

  // H7: a double tap on the primary action lands before `isPending` has
  // re-rendered, so the guard is a ref, read through a function because
  // TypeScript cannot see a callback change it.
  const advancing = useRef(false);
  const isAdvancing = () => advancing.current;

  const runAction = useCallback(
    (job: WashJobView) => {
      const action = primaryActionFor(job.availableEvents);
      if (action === null || isAdvancing()) return;
      advancing.current = true;

      const key = `${job.id}:${action.event}`;
      const intent = intents.current.get(key) ?? newIntent();
      intents.current.set(key, intent);
      setActionNotice(null);

      advance.mutate(
        { jobId: job.id, event: action.event, intent },
        {
          onSuccess: () => {
            intents.current.delete(key);
          },
          onSettled: () => {
            advancing.current = false;
          },
          onError: (error: unknown) => {
            // `useAdvanceWash` invalidates the job on a refusal or an unreadable
            // answer, so a stale screen re-renders on the true status by itself.
            // Every refusal but an illegal transition is also TOLD (G2): a photo
            // gate the pair got wrong is not something a refetch explains.
            const outcome = advanceOutcomeFor(error);
            if (!outcome.keepIntent) intents.current.delete(key);
            setActionNotice(outcome.notice);
          },
        },
      );
    },
    [advance],
  );

  const ready = (job: WashJobView): ReactNode => {
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
        error: capture.error,
        retryable: capture.retryable,
        notice: capture.notice,
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
    // M12: on the "On the way" step the partner's next move is to reach the
    // car, so directions sit beside the primary action, labelled and at the
    // touch target, rather than as a small icon in the header.
    const gettingThere = currentStepFor(job.status) === 0;
    // M9: a finished job ends with a footer that says what it paid and where
    // to go next, never a dead end.
    const end = jobEndFor(job.status);
    // The running "You earn" figure; a finished job's footer says it instead,
    // and a cancelled job pays nothing, so the figure would mislead there.
    const showEarn = job.earningsPaise !== null && end === null;

    return (
      <>
        {active.isError ? (
          // The job stays on screen (ruling T7-I2); this only says the latest
          // refresh failed, and offers another.
          <RefreshNotice
            testID="active-refresh-notice"
            retryLabel="Refresh the job"
            onRetry={() => void active.refetch()}
          />
        ) : null}

        <ScrollView contentContainerStyle={[styles.body, styles.column]}>
          {showsJobWon(params.won, job) ? <JobWonNotice /> : null}

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

          {elapsed !== null || showEarn ? (
            <View style={styles.card}>
              {elapsed === null ? null : <ElapsedBar {...elapsed} />}
              {!showEarn || job.earningsPaise === null ? null : (
                <View style={[styles.earnRow, elapsed !== null && styles.earnDivided]}>
                  <Text style={styles.earnLabel}>You earn</Text>
                  <Text style={styles.earnValue}>
                    {formatPaise(job.earningsPaise, { alwaysDecimals: true })}
                  </Text>
                </View>
              )}
            </View>
          ) : null}
        </ScrollView>

        {end === null ? null : (
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.column}>
              <JobEndFooter
                end={end}
                earningsPaise={job.earningsPaise}
                onEarnings={() => {
                  router.navigate('/(washer)/earnings');
                }}
                onOffers={() => {
                  router.navigate('/(washer)/offers');
                }}
              />
            </View>
          </View>
        )}

        {end !== null || action === null ? null : (
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={styles.column}>
              {actionNotice === null ? null : (
                <View style={styles.actionNotice} testID="active-action-notice">
                  <MaterialCommunityIcons
                    name="alert-circle-outline"
                    size={18}
                    color={colors.errorInk}
                  />
                  <Text style={styles.actionNoticeText}>{actionNotice}</Text>
                </View>
              )}
              {gettingThere ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Navigate to the car"
                  onPress={() => {
                    navigateTo(job);
                  }}
                  android_ripple={{ color: colors.primarySoft }}
                  style={styles.navigate}
                  testID="active-navigate"
                >
                  <MaterialCommunityIcons
                    name="navigation-variant-outline"
                    size={20}
                    color={colors.primary}
                  />
                  <Text style={styles.navigateLabel}>Navigate to the car</Text>
                </Pressable>
              ) : null}
              <WashActionBar
                action={action}
                lockReason={lockReasonFor(action, attached)}
                pending={advance.isPending}
                onPress={() => {
                  runAction(job);
                }}
              />
            </View>
          </View>
        )}
      </>
    );
  };

  const shown = active.data;
  const jobTitle =
    shown === undefined || shown === null
      ? null
      : `${SERVICE_LABELS[shown.serviceName]} · ${VEHICLE_LABELS[shown.vehicleType]}`;

  const content = (): ReactNode => {
    const screen = resolveScreenState(active);
    switch (screen) {
      case 'loading':
        return (
          <ReadableColumn>
            <ActiveSkeleton />
          </ReadableColumn>
        );
      case 'error':
        return (
          <ReadableColumn>
            <ErrorState
              title="Couldn't load your job"
              body={loadFailureCopy(active.error)}
              onAction={() => void active.refetch()}
            />
          </ReadableColumn>
        );
      case 'empty':
        return (
          <ReadableColumn>
            <EmptyState
              icon={<EmptyIcon name="car-wash" />}
              title="No active job"
              body="Accept a wash from Offers and it will appear here, with its photos and steps."
              actionLabel="Go to offers"
              onAction={() => {
                router.navigate('/(washer)/offers');
              }}
            />
          </ReadableColumn>
        );
      case 'ready':
        return active.data ? ready(active.data) : null;
      default:
        return assertNever(screen);
    }
  };

  return (
    <View style={styles.root}>
      {/* The tab's own name (M13); the job is the subtitle once there is one. */}
      <WasherHeader title="Active" {...(jobTitle === null ? {} : { subtitle: jobTitle })} />
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
  navigate: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  navigateLabel: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.primary },
  // M6: the job reads at a readable width on a tablet or a landscape phone.
  column: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center' },
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
  actionNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.errorLight,
  },
  actionNoticeText: { flex: 1, fontSize: fontSize.sm, color: colors.errorInk },
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
