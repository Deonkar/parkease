import type {
  CreateWasherProfile,
  SubmitWasherDocuments,
  WasherPartnerType,
} from '@parkease/contracts/washer';
import { colors, fontSize, lineHeight, spacing } from '@parkease/tokens';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/features/shared/components/ScreenHeader';
import { BusinessForm, MAX_BUSINESS_PHOTOS } from '@/features/washer/components/BusinessForm';
import { GigForm } from '@/features/washer/components/GigForm';
import { PartnerTypePicker } from '@/features/washer/components/PartnerTypePicker';
import { WashCamera } from '@/features/washer/components/WashCamera';
import { useCameraGate } from '@/features/washer/hooks/useCameraGate';
import { useHeldUploads } from '@/features/washer/hooks/useHeldUploads';
import { useRegistration } from '@/features/washer/hooks/useRegistration';
import { useHeldIdUpload } from '@/features/washer/hooks/useWasherQueries';

/** What the camera is photographing here, named in its shutter label. */
type RegistrationPhoto = 'business' | 'ID';

const CAMERA_REASON = 'ParkEase needs the camera to photograph your business or your ID.';

const TITLES: Readonly<Record<WasherPartnerType, string>> = {
  business: 'Business profile',
  gig: 'Individual profile',
};

/**
 * Registration (§14.2): the type picker, then the business or the gig form.
 *
 * Photos and the registration calls live here, not in the forms, so they
 * outlive a switch between the picker and a form. A business is ONE call
 * carrying its photo ids; a gig partner is two — the profile, then the ID —
 * and if only the ID fails the partner is registered, so they land on their
 * profile where the missing ID has its own upload action.
 */
export default function WasherRegisterScreen() {
  const insets = useSafeAreaInsets();
  const [type, setType] = useState<WasherPartnerType | null>(null);
  const photos = useHeldUploads('spaces', MAX_BUSINESS_PHOTOS);
  const idPhoto = useHeldUploads('documents', 1);
  const camera = useCameraGate<RegistrationPhoto>(CAMERA_REASON);
  const registration = useRegistration();
  const heldId = useHeldIdUpload();
  const [failure, setFailure] = useState<string | null>(null);

  // Android's back from a form returns to the picker, as the header's does,
  // instead of leaving registration with the photos taken so far — but only
  // while this screen is in front (H2). A listener that outlived focus
  // swallowed the back press on whichever tab the partner had moved to.
  useFocusEffect(
    useCallback(() => {
      if (type === null) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setType(null);
        return true;
      });
      return () => {
        subscription.remove();
      };
    }, [type]),
  );

  const submit = async (profile: CreateWasherProfile, documents: SubmitWasherDocuments | null) => {
    setFailure(null);
    const outcome = await registration.register(profile, documents);
    if (outcome.kind === 'failed') {
      setFailure(outcome.message);
      return;
    }
    // The ID image is on Cloudinary; only its call failed. Held, so the
    // profile re-sends the call rather than asking for a second photo (G9).
    const uploaded = documents?.idDocumentId;
    if (outcome.kind === 'document-not-sent' && uploaded !== undefined) {
      heldId.hold(uploaded);
    }
    router.dismissTo({
      pathname: '/(washer)/profile',
      params: { notice: outcome.kind },
    });
  };

  const form = () => {
    switch (type) {
      case null:
        return <PartnerTypePicker onPick={setType} />;
      case 'business':
        return (
          <BusinessForm
            photos={photos}
            onTakePhoto={() => void camera.open('business')}
            submitting={registration.submitting}
            failure={failure}
            onSubmit={(profile) => void submit(profile, null)}
          />
        );
      case 'gig':
        return (
          <GigForm
            idPhoto={idPhoto}
            onTakeIdPhoto={() => void camera.open('ID')}
            submitting={registration.submitting}
            failure={failure}
            onSubmit={({ profile, documents }) => void submit(profile, documents)}
          />
        );
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={type === null ? 'Set up your profile' : TITLES[type]}
        {...(type === null
          ? {}
          : {
              onBack: () => {
                setFailure(null);
                setType(null);
              },
            })}
      />
      <KeyboardAvoidingView style={styles.root} behavior="height">
        <ScrollView
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing['2xl'] }]}
          keyboardShouldPersistTaps="handled"
        >
          {type === null ? (
            <Text style={styles.lead}>
              Both kinds of partner get jobs the same way. We check every profile before its first
              job.
            </Text>
          ) : null}
          {form()}
        </ScrollView>
      </KeyboardAvoidingView>

      <WashCamera
        slot={camera.slot}
        onCaptured={(slot, uri) => {
          void (slot === 'ID' ? idPhoto : photos).add(uri);
        }}
        onClose={camera.close}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceSecondary },
  body: { padding: spacing.base, gap: spacing.lg },
  lead: {
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
    color: colors.textSecondary,
  },
});
