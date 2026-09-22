import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { ErrorState, Skeleton } from '@parkease/ui-native';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';

import { resolveScreenState } from '@/features/shared/screen-state';
import { OfferFocusCard } from '@/features/valet/components/OfferFocusCard';
import { OnlineStatusBar } from '@/features/valet/components/OnlineStatusBar';
import { VerificationGate } from '@/features/valet/components/VerificationGate';
import { useBackgroundLocation } from '@/features/valet/hooks/useBackgroundLocation';
import { useAcceptOffer, useOffers, useValetProfile } from '@/features/valet/hooks/useValetQueries';
import { describeVerification } from '@/features/valet/profile-status';
import { newIntent, type Intent } from '@/lib/api';

/**
 * The API's error envelope is `{error: {code, message, traceId}}`, but an error
 * reaching here may also be a transport failure with no body at all. R-VAL-01
 * forbids asserting a shape on data from outside the process, so it is parsed.
 */
const errorEnvelopeSchema = z.object({
  response: z.object({
    data: z.object({
      error: z.object({ code: z.string() }),
    }),
  }),
});

function errorCodeOf(error: unknown): string | null {
  const parsed = errorEnvelopeSchema.safeParse(error);
  return parsed.success ? parsed.data.response.data.error.code : null;
}

/**
 * The two empty states are NOT the same state, and were shipping the same copy.
 *
 * Telling a valet who is offline to "stay online" names no action they can take;
 * the thing they need is the switch directly above. Telling a valet who IS
 * online that there is nothing nearby needs the opposite tone — reassurance that
 * they do not have to keep staring at the screen.
 */
function OffersEmpty({
  icon,
  title,
  body,
  testID,
}: {
  readonly icon: keyof typeof MaterialCommunityIcons.glyphMap;
  readonly title: string;
  readonly body: string;
  readonly testID: string;
}) {
  return (
    <View style={styles.centered} testID={testID}>
      <View style={styles.emptyIcon}>
        <MaterialCommunityIcons name={icon} size={30} color={colors.muted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const DENIAL_COPY: Record<string, string> = {
  foreground_denied: 'ParkEase needs your location to find nearby spots.',
  background_denied:
    'ParkEase needs location in the background so drivers can track their car while you ride.',
  unsupported_platform: 'Background location needs the Android app — this preview cannot track.',
  availability_failed: "Couldn't reach ParkEase to put you online. Check your connection.",
};

export default function ValetOffersScreen() {
  const insets = useSafeAreaInsets();
  const tracking = useBackgroundLocation();
  const profile = useValetProfile();

  const isOnline = tracking.state === 'tracking';
  const offers = useOffers(isOnline);
  const accept = useAcceptOffer();

  const [cursor, setCursor] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  // One key per user intent, not per HTTP attempt (R-FE-05): minted when the
  // valet lands on an offer, reused if the accept has to be retried.
  const [intent, setIntent] = useState<Intent>(() => newIntent());
  // Losing the accept race is an ordinary outcome shown inline, never a red
  // banner — one happens several times a day, and the other teaches valets to
  // ignore banners. §12.3.
  const [takenNotice, setTakenNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const items = offers.data ?? [];
  const current = items[cursor];

  const profileScreen = resolveScreenState(profile);
  const verificationStatus = profile.data?.verificationStatus;
  // §12.7 puts the banner HERE, not only on Profile: showing a pending valet
  // the jobs and the money within reach is what gives them a reason to finish
  // their document upload. An empty locked screen gives them nothing.
  const verificationBanner = useMemo(() => {
    if (profileScreen === 'loading' || verificationStatus === undefined) return null;
    return describeVerification(verificationStatus).banner;
  }, [profileScreen, verificationStatus]);

  const lockedReason = useMemo(() => {
    // `isLoading` would go false in the retry backoff gap, and with no data yet
    // a VERIFIED valet would be told to verify and locked out of accepting —
    // a UI state bug wearing the costume of a 403.
    if (profileScreen === 'loading' || verificationStatus === undefined) return undefined;
    // One source of truth with the profile screen, which fails closed on an
    // unrecognised status. The server independently rejects the accept with
    // 403 VALET_NOT_VERIFIED, so this lock is a courtesy and never the control.
    if (describeVerification(verificationStatus).canAccept) return undefined;
    return 'Verify your documents to accept jobs';
  }, [profileScreen, verificationStatus]);

  const handleToggle = useCallback(
    async (next: boolean) => {
      if (!next) {
        await tracking.stop();
        return;
      }
      const result = await tracking.start();
      if (!result.ok) {
        Alert.alert(
          'Location needed',
          DENIAL_COPY[result.reason] ?? 'ParkEase needs your location to send you jobs.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Enable in Settings', onPress: () => void Linking.openSettings() },
          ],
        );
      }
    },
    [tracking],
  );

  const handleAccept = useCallback(() => {
    if (current === undefined) return;

    accept.mutate(
      { jobId: current.jobId, intent },
      {
        onSuccess: () => {
          setIntent(newIntent());
        },
        onError: (error: unknown) => {
          const code = errorCodeOf(error);
          // Losing a race happens several times a day. A red banner for it
          // trains valets to ignore banners, so it reads as an ordinary outcome.
          if (code === 'VALET_JOB_TAKEN') {
            setTakenNotice('This job was taken by another valet. More jobs coming!');
            setCursor(0);
            setIntent(newIntent());
            void offers.refetch();
            return;
          }
          Alert.alert('Could not accept', 'Please try again.');
        },
      },
    );
  }, [accept, current, intent, offers]);

  const handleSkip = useCallback(() => {
    setCursor((index) => (index + 1) % Math.max(items.length, 1));
    setIntent(newIntent());
    setTakenNotice(null);
  }, [items.length]);

  const body = (() => {
    if (!isOnline) {
      return (
        <OffersEmpty
          icon="map-marker-radius-outline"
          // The rail directly above already says "You are offline". Repeating it
          // here spends the largest area on the screen restating a status the
          // valet has just read, so this says what they are missing instead.
          title="Nothing to show yet"
          body="Jobs near you appear here as soon as you go online."
          testID="offers-offline"
        />
      );
    }

    if (resolveScreenState(offers) === 'loading') {
      return (
        <View style={styles.skeletons} testID="offers-skeleton">
          <Skeleton height={28} width="55%" />
          <Skeleton height={120} width="100%" />
          <Skeleton height={68} width="100%" />
        </View>
      );
    }

    if (resolveScreenState(offers) === 'error') {
      return (
        <ErrorState
          title="Couldn't load jobs"
          body="Check your connection and try again."
          onAction={() => void offers.refetch()}
        />
      );
    }

    if (current === undefined) {
      return (
        <OffersEmpty
          icon="map-marker-radius-outline"
          title="No jobs right now"
          // They are already doing the right thing; say so, and free them from
          // watching the screen.
          body="You're online. We'll alert you the moment a job appears nearby."
          testID="offers-empty"
        />
      );
    }

    const msLeft = Math.max(0, new Date(current.expiresAt).getTime() - now);
    const seconds = Math.floor(msLeft / 1000);

    return (
      <>
        {takenNotice === null ? null : (
          // A live region because the sighted cue is the card swapping to a
          // different address; without this a screen reader user just hears
          // silence after pressing Accept.
          <View
            accessibilityLiveRegion="polite"
            style={styles.takenNotice}
            testID="offer-taken-notice"
          >
            <MaterialCommunityIcons
              name="information-outline"
              size={18}
              color={colors.primaryDark}
            />
            <Text style={styles.takenNoticeText}>{takenNotice}</Text>
          </View>
        )}
        <OfferFocusCard
          offer={current}
          position={cursor + 1}
          total={items.length}
          onAccept={handleAccept}
          onSkip={handleSkip}
          lockedReason={lockedReason}
          expiresInLabel={`${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`}
        />
      </>
    );
  })();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.brand}>ParkEase Valet</Text>
      </View>

      {verificationBanner === null ? null : (
        <View style={styles.gate}>
          <VerificationGate
            banner={verificationBanner}
            onAction={() => {
              router.push('/(valet)/profile');
            }}
          />
        </View>
      )}

      <OnlineStatusBar
        isOnline={isOnline}
        busy={tracking.state === 'starting'}
        lastFixAt={tracking.lastFixAt}
        granted={tracking.granted}
        now={now}
        onToggle={(next) => void handleToggle(next)}
        onFix={() => void Linking.openSettings()}
      />

      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  brand: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  skeletons: { padding: spacing.lg, gap: spacing.base },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing['2xl'],
    gap: spacing.sm,
  },
  gate: { paddingHorizontal: spacing.base, paddingTop: spacing.md },
  takenNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  takenNoticeText: { flex: 1, fontSize: fontSize.sm, color: colors.primaryDark },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.mutedSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  emptyBody: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
});
