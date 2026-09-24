import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { WashJobOffer } from '@parkease/contracts/washer';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { EmptyState, ErrorState, Skeleton } from '@parkease/ui-native';
import { FlashList } from '@shopify/flash-list';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAnnounce } from '@/features/shared/hooks/useAnnounce';
import { resolveScreenState } from '@/features/shared/screen-state';
import { acceptOutcomeFor } from '@/features/washer/action-outcomes';
import { isUnregisteredWasher, loadFailureCopy } from '@/features/washer/api/errors';
import { OnlineRail } from '@/features/washer/components/OnlineRail';
import { ProfileGear } from '@/features/washer/components/ProfileGear';
import { VerificationNotice } from '@/features/washer/components/VerificationNotice';
import { WashOfferCard } from '@/features/washer/components/WashOfferCard';
import {
  useAcceptWash,
  useActiveWash,
  useServiceMenu,
  useWasherOffers,
  useWasherProfile,
  washerKeys,
} from '@/features/washer/hooks/useWasherQueries';
import type { PresenceError } from '@/features/washer/presence';
import { usePresence } from '@/features/washer/presence-context';
import { describeWasherVerification } from '@/features/washer/verification-copy';
import { newIntent, type Intent } from '@/lib/api';

const VERIFY_LOCK = 'Verify your documents to accept jobs';

interface GoOnlineCopy {
  readonly title: string;
  readonly body: string;
  /** Only a permission problem is fixable from the app's settings page. */
  readonly settings: boolean;
}

const GO_ONLINE_COPY: Readonly<Record<PresenceError, GoOnlineCopy>> = {
  permission_denied: {
    title: 'Location needed',
    body: 'ParkEase needs your location to send you wash jobs nearby.',
    settings: true,
  },
  location_failed: {
    title: 'No location yet',
    body: "We couldn't find your location. Check that location is switched on, then try again.",
    settings: false,
  },
  not_verified: {
    title: 'Not verified yet',
    body: 'Your documents are still being checked. You can go online once they clear.',
    settings: false,
  },
  not_registered: {
    title: 'Finish setting up',
    body: 'Finish setting up your partner profile before going online.',
    settings: false,
  },
  refused: {
    title: "Couldn't go online",
    body: "ParkEase didn't accept going online. Check your profile, then try again.",
    settings: false,
  },
  unreachable: {
    title: "Couldn't go online",
    body: "Couldn't reach ParkEase. Check your connection and try again.",
    settings: false,
  },
};

function formatCountdown(msLeft: number): string {
  const seconds = Math.floor(Math.max(0, msLeft) / 1000);
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

const durationKey = (offer: Pick<WashJobOffer, 'serviceName' | 'vehicleType'>) =>
  `${offer.serviceName}:${offer.vehicleType}`;

function EmptyIcon({ name }: { readonly name: keyof typeof MaterialCommunityIcons.glyphMap }) {
  return <MaterialCommunityIcons name={name} size={48} color={colors.textTertiary} />;
}

function OfferSkeletons() {
  return (
    <View style={styles.skeletons} testID="offers-skeleton">
      <Skeleton width="100%" height={260} borderRadius={radius.lg} />
      <Skeleton width="100%" height={260} borderRadius={radius.lg} />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

/**
 * §6.1 — the washer's offers feed, direction "Bay".
 *
 * Presence (the online switch and its heartbeat) is owned by the `(washer)`
 * layout; this screen reads it and never starts a second one.
 */
export default function WasherOffersScreen() {
  const insets = useSafeAreaInsets();
  const presence = usePresence();
  const profile = useWasherProfile();
  const active = useActiveWash();
  const offers = useWasherOffers(presence.isOnline);
  const menu = useServiceMenu();
  const accept = useAcceptWash();
  const client = useQueryClient();

  // R-FE-05: one intent per offer, minted the first time the partner presses
  // Accept on it and REUSED if that accept is retried — so a retry after a
  // timeout replays the first attempt instead of racing a second one. Dropped
  // once the offer's outcome is settled: won, or taken by somebody else.
  const intents = useRef(new Map<string, Intent>());
  const intentFor = useCallback((jobId: string): Intent => {
    const existing = intents.current.get(jobId);
    if (existing !== undefined) return existing;
    const minted = newIntent();
    intents.current.set(jobId, minted);
    return minted;
  }, []);

  // Every failed Accept reads inline, never as an alert: losing the race is an
  // ordinary outcome — two of every three partners offered a job see it — and
  // react-native-web's Alert is a no-op. It is pinned to the list it was shown
  // with and disappears once that list changes (T6-M4). Structural sharing
  // keeps the reference when a refetch returns the same offers, so the notice
  // outlives a no-op refetch.
  const [acceptNotice, setAcceptNotice] = useState<{
    readonly text: string;
    readonly shownWith: WashJobOffer[] | undefined;
  } | null>(null);
  const visibleNotice =
    acceptNotice !== null && acceptNotice.shownWith === offers.data ? acceptNotice.text : null;
  // H4: the sighted cue is a card disappearing; TalkBack hears the words.
  useAnnounce(visibleNotice);

  // A job that can no longer be accepted leaves the list NOW, not when the
  // refetch lands — until then it would still be tappable.
  const removeOffer = useCallback(
    (jobId: string) =>
      client.setQueryData<WashJobOffer[]>(washerKeys.offers, (current) =>
        current?.filter((offer) => offer.jobId !== jobId),
      ),
    [client],
  );

  const items = useMemo(
    () => (presence.isOnline ? (offers.data ?? []) : []),
    [presence.isOnline, offers.data],
  );

  const [now, setNow] = useState(() => Date.now());
  const ticking = items.length > 0;
  useEffect(() => {
    if (!ticking) return undefined;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [ticking]);

  // The duration a partner quoted on their OWN menu row for this service and
  // vehicle — the row the server priced the earnings from. A lookup, never a
  // calculation; a missing row drops the chip.
  const durations = useMemo(
    () =>
      new Map((menu.data?.services ?? []).map((row) => [durationKey(row), row.durationMinutes])),
    [menu.data],
  );

  const verificationStatus = profile.data?.verificationStatus;
  const verification = useMemo(
    () =>
      verificationStatus === undefined ? null : describeWasherVerification(verificationStatus),
    [verificationStatus],
  );
  // A courtesy, never the control: the server refuses with 403 regardless.
  const verifyLock = verification !== null && !verification.canAccept ? VERIFY_LOCK : undefined;

  const handleToggle = useCallback(
    async (next: boolean) => {
      if (!next) {
        const stopped = await presence.goOffline();
        if (!stopped.ok) {
          // The heartbeat has stopped, so dispatch drops them within the
          // window regardless; this only says so honestly.
          Alert.alert(
            'Offline on this phone',
            "We couldn't tell ParkEase you went offline, so a job may still reach you for the next minute or so.",
          );
        }
        return;
      }

      const started = await presence.goOnline();
      if (started.ok) return;
      const copy = GO_ONLINE_COPY[started.reason];
      Alert.alert(
        copy.title,
        copy.body,
        copy.settings
          ? [
              { text: 'Not now', style: 'cancel' },
              { text: 'Enable in Settings', onPress: () => void Linking.openSettings() },
            ]
          : undefined,
      );
    },
    [presence],
  );

  const handleAccept = useCallback(
    (jobId: string) => {
      if (accept.isPending) return;
      setAcceptNotice(null);

      accept.mutate(
        { jobId, intent: intentFor(jobId) },
        {
          onSuccess: () => {
            intents.current.delete(jobId);
            router.push('/(washer)/active');
          },
          onError: (error: unknown) => {
            // `useAcceptWash` invalidates offers and the active job on settle,
            // and the profile on a refusal, so nothing here refetches (G3).
            const outcome = acceptOutcomeFor(error);
            if (!outcome.keepIntent) intents.current.delete(jobId);
            const shownWith = outcome.removeCard ? removeOffer(jobId) : offers.data;
            setAcceptNotice({ text: outcome.notice, shownWith });
          },
        },
      );
    },
    [accept, intentFor, offers.data, removeOffer],
  );

  const acceptingId = accept.isPending ? accept.variables.jobId : null;

  const renderOffer = useCallback(
    ({ item }: { item: WashJobOffer }) => {
      const expiresAt = Date.parse(item.expiresAt);
      const window = expiresAt - Date.parse(item.offeredAt);
      const msLeft = Math.max(0, expiresAt - now);

      return (
        <WashOfferCard
          offer={item}
          expiresInLabel={formatCountdown(msLeft)}
          expiresFraction={window > 0 ? msLeft / window : 0}
          durationMinutes={durations.get(durationKey(item)) ?? null}
          lockedReason={verifyLock ?? (msLeft === 0 ? 'This offer has expired' : undefined)}
          accepting={acceptingId === item.jobId}
          onAccept={() => {
            handleAccept(item.jobId);
          }}
        />
      );
    },
    [now, durations, verifyLock, acceptingId, handleAccept],
  );

  const offersBody = (): ReactNode => {
    // Offers only once we KNOW there is no active job: `active.data` alone is
    // undefined while pending or errored, which would list offers to a
    // partner who may already be mid-wash.
    const activeState = resolveScreenState(active);
    if (activeState === 'loading') return <OfferSkeletons />;
    if (activeState === 'error') {
      return (
        <ErrorState
          title="Couldn't check your current job"
          body={loadFailureCopy(active.error)}
          onAction={() => void active.refetch()}
        />
      );
    }
    if (activeState === 'ready') {
      return (
        <EmptyState
          icon={<EmptyIcon name="car-wash" />}
          title="You're on a job"
          body="Finish your current job to see new offers."
          actionLabel="Go to active job"
          onAction={() => {
            router.push('/(washer)/active');
          }}
        />
      );
    }

    if (!presence.isOnline) {
      return (
        <EmptyState
          icon={<EmptyIcon name="map-marker-radius-outline" />}
          // The rail directly above already says Offline; this says what they
          // are missing instead of repeating it.
          title="Nothing to show yet"
          body="Wash jobs near you appear here as soon as you go online."
        />
      );
    }

    const notice =
      visibleNotice === null ? null : (
        // Announced by `useAnnounce(visibleNotice)` above (H4).
        <View style={styles.notice} testID="offer-taken-notice">
          <MaterialCommunityIcons name="information-outline" size={18} color={colors.primaryDark} />
          <Text style={styles.noticeText}>{visibleNotice}</Text>
        </View>
      );

    switch (resolveScreenState(offers)) {
      case 'loading':
        return <OfferSkeletons />;
      case 'error':
        return (
          <ErrorState
            title="Couldn't load jobs"
            body={loadFailureCopy(offers.error)}
            onAction={() => void offers.refetch()}
          />
        );
      case 'empty':
        return (
          <>
            {notice}
            <EmptyState
              icon={<EmptyIcon name="map-marker-radius-outline" />}
              title="No jobs right now"
              // Reassurance, and the truth about the foreground-only heartbeat:
              // they need not watch the screen, but the app must stay open.
              body="You're online. Keep ParkEase open and we'll notify you when a job comes in nearby."
            />
          </>
        );
      case 'ready':
        return (
          <>
            {notice}
            <FlashList
              data={items}
              keyExtractor={(item) => item.jobId}
              renderItem={renderOffer}
              extraData={renderOffer}
              ItemSeparatorComponent={Separator}
              contentContainerStyle={styles.list}
              ListHeaderComponent={
                <Text style={styles.section} accessibilityRole="header">
                  {`${String(items.length)} ${items.length === 1 ? 'JOB' : 'JOBS'} NEARBY`}
                </Text>
              }
            />
          </>
        );
    }
  };

  const content = (): ReactNode => {
    // Not registered yet: a first-run state with a next step, never an error.
    if (profile.isError && isUnregisteredWasher(profile.error)) {
      return (
        <EmptyState
          icon={<EmptyIcon name="account-plus-outline" />}
          title="Finish setting up your partner profile"
          body="Tell us about your car wash and add your ID proof to start getting jobs."
          actionLabel="Set up profile"
          onAction={() => {
            router.push('/(washer)/profile');
          }}
        />
      );
    }

    if (resolveScreenState(profile) === 'loading') {
      return (
        <View style={styles.skeletons}>
          <Skeleton width="100%" height={56} borderRadius={radius.lg} />
          <Skeleton width="100%" height={260} borderRadius={radius.lg} />
        </View>
      );
    }

    if (profile.data === undefined) {
      return (
        <ErrorState
          title="Couldn't load your profile"
          body={loadFailureCopy(profile.error)}
          onAction={() => void profile.refetch()}
        />
      );
    }

    return (
      <>
        {verification?.banner ? (
          <VerificationNotice
            banner={verification.banner}
            onAction={() => {
              router.push('/(washer)/profile');
            }}
          />
        ) : null}

        <OnlineRail
          isOnline={presence.isOnline}
          busy={presence.busy}
          problem={presence.error}
          // Going online is refused server-side until verified, so the switch
          // says so instead of letting the partner find out from an alert.
          disabledReason={
            !presence.isOnline && verifyLock !== undefined
              ? 'You can go online once your documents are approved'
              : undefined
          }
          onToggle={(next) => void handleToggle(next)}
        />

        <View style={styles.body}>{offersBody()}</View>
      </>
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.brand} accessibilityRole="header">
          Car Wash
        </Text>
        <ProfileGear />
      </View>
      {content()}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    // The gear's 48dp target carries its own vertical room.
    paddingBottom: spacing.xs,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  brand: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  body: { flex: 1 },
  skeletons: { padding: spacing.base, gap: spacing.md },
  list: { paddingHorizontal: spacing.base, paddingBottom: spacing.xl },
  section: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.4,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  separator: { height: spacing.md },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.base,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  noticeText: { flex: 1, fontSize: fontSize.sm, color: colors.primaryDark },
});
