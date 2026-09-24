import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { WasherProfileView } from '@parkease/contracts/washer';
import {
  colors,
  elevation,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  spacing,
} from '@parkease/tokens';
import { EmptyState, ErrorState, Skeleton } from '@parkease/ui-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { loadFailureCopy } from '@/features/washer/api/errors';
import { FieldError } from '@/features/washer/components/FieldError';
import { SubmitBlock } from '@/features/washer/components/FormFields';
import { PhotoField } from '@/features/washer/components/PhotoField';
import { RefreshNotice } from '@/features/washer/components/RefreshNotice';
import { VerificationNotice } from '@/features/washer/components/VerificationNotice';
import { WashCamera } from '@/features/washer/components/WashCamera';
import { useCameraGate } from '@/features/washer/hooks/useCameraGate';
import { useHeldUploads } from '@/features/washer/hooks/useHeldUploads';
import { useRegistration } from '@/features/washer/hooks/useRegistration';
import { useWasherProfile } from '@/features/washer/hooks/useWasherQueries';
import { profileScreenState, registrationNotice } from '@/features/washer/profile-state';
import { describeHours } from '@/features/washer/registration';
import { describeWasherVerification } from '@/features/washer/verification-copy';

const CAMERA_REASON = 'ParkEase needs the camera to photograph your ID.';

function ProfileSkeleton() {
  return (
    <View style={styles.skeleton} testID="profile-skeleton">
      <Skeleton width="100%" height={72} borderRadius={radius.md} />
      <Skeleton width="100%" height={140} borderRadius={radius.lg} />
      <Skeleton width="100%" height={96} borderRadius={radius.lg} />
    </View>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/**
 * The washer's profile (§6.5), and the default entry for one who has not
 * registered: `404 WASHER_PROFILE_NOT_FOUND` is a set-up state with a next
 * step, never an error. A registered partner sees where verification stands,
 * their documents — with an upload for a missing ID — and their business
 * details, then the account rows every role's profile carries.
 */
export default function WasherProfileScreen() {
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const profile = useWasherProfile();
  const params = useLocalSearchParams<{ notice?: string }>();
  const noticeKind = typeof params.notice === 'string' ? params.notice : undefined;

  // At the top, unconditionally: a photo in hand must outlive the screen
  // dropping into its error state and back.
  const idPhoto = useHeldUploads('documents', 1);
  const camera = useCameraGate<'ID'>(CAMERA_REASON);
  const registration = useRegistration();
  const [sendFailure, setSendFailure] = useState<string | null>(null);

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => void auth.signOut() },
    ]);
  };

  const sendId = async () => {
    const idDocumentId = idPhoto.uploadIds[0];
    if (idDocumentId === undefined) return;
    setSendFailure(null);
    // One intent per image, replayed if this same image is retried (R-FE-05).
    const failure = await registration.sendDocument({ idDocumentId });
    setSendFailure(failure);
  };

  const idDocument = (view: WasherProfileView): ReactNode => {
    if (view.idDocumentId !== null) {
      return (
        <View style={styles.docRow} testID="id-document-present">
          <MaterialCommunityIcons name="check-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.docText}>ID proof added</Text>
        </View>
      );
    }
    return (
      <View style={styles.docMissing} testID="id-document-missing">
        <PhotoField
          id="idDocument"
          label="ID proof: not added yet"
          hint="One clear photo of the side with your photo on it. We verify your identity, not your number."
          uploads={idPhoto}
          max={1}
          wide
          addLabel="Take photo"
          onAdd={() => void camera.open('ID')}
        />
        {idPhoto.uploadIds.length > 0 || idPhoto.busy ? (
          <SubmitBlock
            label="Send for review"
            waitingForUploads={idPhoto.busy}
            submitting={registration.submitting}
            failure={sendFailure}
            onPress={() => void sendId()}
          />
        ) : sendFailure === null ? null : (
          <FieldError testID="send-failure" message={sendFailure} />
        )}
      </View>
    );
  };

  const ready = (view: WasherProfileView): ReactNode => {
    const { banner } = describeWasherVerification(view.verificationStatus);
    const notice = registrationNotice(noticeKind, view.verificationStatus, view.partnerType);
    const isBusiness = view.partnerType === 'business';

    return (
      <>
        {notice === null ? null : (
          <View style={styles.notice} accessibilityLiveRegion="polite" testID="registration-notice">
            <MaterialCommunityIcons
              name="information-outline"
              size={18}
              color={colors.primaryDark}
            />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}

        {profile.isError ? (
          <RefreshNotice
            testID="profile-refresh-failed"
            retryLabel="Refresh your profile"
            onRetry={() => void profile.refetch()}
          />
        ) : null}

        {banner === null ? (
          <View style={styles.verified}>
            <MaterialCommunityIcons
              name="check-decagram-outline"
              size={20}
              color={colors.primary}
            />
            <Text style={styles.verifiedText}>Verified. You can accept jobs.</Text>
          </View>
        ) : (
          // No action: the documents it would point at are right below.
          <VerificationNotice banner={banner} />
        )}

        <View style={styles.card}>
          <Text style={styles.section} accessibilityRole="header">
            {isBusiness ? 'YOUR BUSINESS' : 'ABOUT YOU'}
          </Text>
          <Row
            label="Partner type"
            value={isBusiness ? 'Car wash business' : 'Individual washer'}
          />
          <Row
            label={isBusiness ? 'Business name' : 'Name'}
            value={view.businessName ?? 'Not added'}
          />
          {isBusiness ? (
            <>
              <Row label="GSTIN" value={view.gstin ?? 'Not added'} />
              <Row label="Operating hours" value={describeHours(view.operatingHours)} />
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.section} accessibilityRole="header">
            DOCUMENTS
          </Text>
          {/* A business is reviewed on its photos (ruling T10-C1) and is never
              asked for an ID; a gig partner's review material is the ID. */}
          {isBusiness ? (
            <View style={styles.docRow}>
              <MaterialCommunityIcons
                name={
                  view.businessPhotoIds.length > 0 ? 'check-circle-outline' : 'image-off-outline'
                }
                size={20}
                color={view.businessPhotoIds.length > 0 ? colors.primary : colors.textTertiary}
              />
              <Text style={styles.docText}>
                {view.businessPhotoIds.length === 0
                  ? 'No business photos'
                  : `${String(view.businessPhotoIds.length)} business ${
                      view.businessPhotoIds.length === 1 ? 'photo' : 'photos'
                    }`}
              </Text>
            </View>
          ) : (
            idDocument(view)
          )}
        </View>
      </>
    );
  };

  const content = (): ReactNode => {
    switch (profileScreenState(profile)) {
      case 'loading':
        return <ProfileSkeleton />;
      case 'unregistered':
        return (
          <EmptyState
            icon={
              <MaterialCommunityIcons
                name="account-plus-outline"
                size={48}
                color={colors.textTertiary}
              />
            }
            title="Set up your partner profile"
            body="Tell us whether you run a car wash business or wash on your own, and which services you offer."
            actionLabel="Set up profile"
            onAction={() => {
              router.push('/(washer)/profile/register');
            }}
          />
        );
      case 'error':
      case 'empty':
        // `empty` cannot come from this endpoint (a partner has a profile or a
        // 404); if it ever does, "nothing here" is unknown, so it is an error.
        return (
          <ErrorState
            title="Couldn't load your profile"
            body={loadFailureCopy(profile.error)}
            onAction={() => void profile.refetch()}
          />
        );
      case 'ready':
        return profile.data === undefined ? null : ready(profile.data);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingTop: insets.top + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title} accessibilityRole="header">
          Profile
        </Text>

        {content()}

        <View style={styles.account}>
          <Pressable
            onPress={() => {
              router.push('/(shared)/switch-role');
            }}
            style={styles.item}
            accessibilityRole="button"
            accessibilityLabel="Switch role"
          >
            <Text style={styles.itemText}>Switch Role</Text>
            <Text style={styles.chevron}>{'›'}</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              router.push('/(shared)/settings');
            }}
            style={styles.item}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Text style={styles.itemText}>Settings</Text>
            <Text style={styles.chevron}>{'›'}</Text>
          </Pressable>

          <Pressable
            onPress={handleSignOut}
            style={[styles.item, styles.signOut]}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Outside the state switch, so a refetch cannot tear the camera down mid-shot. */}
      <WashCamera
        slot={camera.slot}
        onCaptured={(_slot, uri) => {
          setSendFailure(null);
          void idPhoto.add(uri);
        }}
        onClose={camera.close}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  body: { paddingHorizontal: spacing.base, paddingBottom: spacing['2xl'], gap: spacing.base },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.text },
  skeleton: { gap: spacing.md },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  noticeText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.primaryDark,
  },
  verified: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  verifiedText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  card: {
    gap: spacing.md,
    padding: spacing.base,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...elevation.card,
  },
  section: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.4,
  },
  row: { gap: spacing.xs },
  rowLabel: { fontSize: fontSize.xs, color: colors.textTertiary },
  rowValue: { fontSize: fontSize.base, color: colors.text },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  docText: { flex: 1, fontSize: fontSize.base, color: colors.text },
  docMissing: { gap: spacing.md },
  account: { marginTop: spacing.base },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 48,
  },
  itemText: {
    fontSize: fontSize.base,
    color: colors.text,
  },
  chevron: {
    fontSize: fontSize.xl,
    color: colors.textTertiary,
  },
  signOut: {
    marginTop: spacing['2xl'],
    borderBottomWidth: 0,
    justifyContent: 'center',
  },
  signOutText: {
    fontSize: fontSize.base,
    color: colors.error,
    fontWeight: '500',
  },
});
