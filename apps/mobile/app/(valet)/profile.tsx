import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, lineHeight, radius, spacing } from '@parkease/tokens';
import { ErrorState, Skeleton } from '@parkease/ui-native';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { resolveScreenState } from '@/features/shared/screen-state';
import { VerificationGate } from '@/features/valet/components/VerificationGate';
import { useValetProfile } from '@/features/valet/hooks/useValetQueries';
import {
  type DocumentState,
  describeVerification,
  documentStateFor,
  licenceWarning,
} from '@/features/valet/profile-status';

/** Documents the server tracks, and the words a valet uses for them. */
const DOCUMENT_LABELS = {
  licence: 'Driving licence',
  background: 'Background check',
} as const;

const DOCUMENT_PRESENTATION: Record<
  DocumentState,
  { icon: keyof typeof MaterialCommunityIcons.glyphMap; tint: string; label: string }
> = {
  verified: { icon: 'check-circle', tint: colors.available, label: 'Verified' },
  pending: { icon: 'clock-outline', tint: colors.warning, label: 'In progress' },
  failed: { icon: 'close-circle', tint: colors.error, label: 'Not approved' },
  missing: { icon: 'plus-circle-outline', tint: colors.muted, label: 'Not uploaded' },
};

function DocumentRow({ label, state }: { readonly label: string; readonly state: DocumentState }) {
  const view = DOCUMENT_PRESENTATION[state];
  return (
    // The state is read as text, never as colour alone (R-FE-12).
    //
    // `accessible` is what makes the container a single TalkBack stop; without
    // it Android descends into the children and the composed label is dead
    // code, announcing the row as two or three separate stops instead of one.
    <View accessible accessibilityLabel={`${label}: ${view.label}`} style={styles.docRow}>
      <MaterialCommunityIcons name={view.icon} size={20} color={view.tint} />
      <Text style={styles.docLabel}>{label}</Text>
      <Text style={[styles.docState, { color: view.tint }]}>{view.label}</Text>
    </View>
  );
}

export default function ValetProfileScreen() {
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const profile = useValetProfile();
  const screen = resolveScreenState(profile);

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void auth.signOut() },
    ]);
  };

  const body = (() => {
    if (screen === 'loading') {
      return (
        <View style={styles.skeletons} testID="profile-skeleton">
          <Skeleton height={72} width="100%" />
          <Skeleton height={140} width="100%" />
          <Skeleton height={96} width="100%" />
        </View>
      );
    }

    if (screen === 'error' || profile.data === undefined) {
      return (
        <ErrorState
          title="Couldn't load your profile"
          body="Check your connection and try again."
          onAction={() => void profile.refetch()}
        />
      );
    }

    const data = profile.data;
    const verification = describeVerification(data.verificationStatus);
    const licence = licenceWarning(data.licenceExpiresAt, Date.now());

    const licenceState = documentStateFor(data.verificationStatus, data.licenceDocumentId !== null);

    const backgroundState: DocumentState =
      data.backgroundCheckStatus === 'passed'
        ? 'verified'
        : data.backgroundCheckStatus === 'failed'
          ? 'failed'
          : 'pending';

    // `ratingAvgBp` is basis points — 460 is 4.6. Display only: the number is
    // computed server-side and is never derived here.
    const rating = data.ratingAvgBp === null ? null : (data.ratingAvgBp / 100).toFixed(1);

    return (
      <>
        {verification.banner === null ? null : (
          <VerificationGate
            banner={verification.banner}
            onAction={() => {
              // Document upload is not built yet (S-12); say so rather than
              // rendering a button that silently does nothing.
              Alert.alert(
                'Coming soon',
                'Uploading documents from the app is not available yet. Contact support to submit them.',
              );
            }}
          />
        )}

        <View style={styles.identity}>
          <View style={styles.avatar}>
            <MaterialCommunityIcons name="account" size={30} color={colors.textSecondary} />
          </View>
          <View style={styles.identityCopy}>
            {rating === null ? (
              <Text style={styles.ratingNone}>No ratings yet</Text>
            ) : (
              <View style={styles.ratingRow}>
                <MaterialCommunityIcons name="star" size={16} color={colors.warning} />
                <Text style={styles.rating}>{rating}</Text>
                <Text style={styles.ratingCount}>
                  {`(${String(data.ratingCount)} ${data.ratingCount === 1 ? 'rating' : 'ratings'})`}
                </Text>
              </View>
            )}
            <Text style={styles.vehicle}>
              {data.vehicleMake === null && data.vehicleNumber === null
                ? 'No vehicle on file'
                : [data.vehicleMake, data.vehicleNumber].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>DOCUMENTS</Text>
          <DocumentRow label={DOCUMENT_LABELS.licence} state={licenceState} />
          <DocumentRow label={DOCUMENT_LABELS.background} state={backgroundState} />
        </View>

        {licence === null ? null : (
          <View
            accessibilityRole="alert"
            style={[styles.licence, licence.expired ? styles.licenceExpired : styles.licenceSoon]}
            testID="licence-warning"
          >
            <MaterialCommunityIcons
              name="card-account-details-outline"
              size={20}
              color={licence.expired ? colors.errorInk : colors.warning}
            />
            <Text
              style={[
                styles.licenceText,
                { color: licence.expired ? colors.errorInk : colors.warning },
              ]}
            >
              {licence.message}
            </Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ACCOUNT</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch to another role"
            onPress={() => {
              router.push('/(shared)/switch-role');
            }}
            style={styles.rowButton}
          >
            <MaterialCommunityIcons name="swap-horizontal" size={20} color={colors.textSecondary} />
            <Text style={styles.rowLabel}>Switch role</Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out of ParkEase"
            onPress={handleSignOut}
            style={styles.rowButton}
          >
            <MaterialCommunityIcons name="logout" size={20} color={colors.error} />
            <Text style={[styles.rowLabel, { color: colors.error }]}>Sign out</Text>
          </Pressable>
        </View>
      </>
    );
  })();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>{body}</ScrollView>
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
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityCopy: { flex: 1, gap: spacing.xs },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rating: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  ratingCount: { fontSize: fontSize.xs, color: colors.textTertiary },
  ratingNone: { fontSize: fontSize.sm, color: colors.textTertiary },
  vehicle: { fontSize: fontSize.sm, color: colors.textSecondary },
  section: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  sectionTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.textTertiary,
    letterSpacing: 0.4,
    paddingVertical: spacing.sm,
  },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
  docLabel: { flex: 1, fontSize: fontSize.sm, color: colors.text },
  docState: { fontSize: fontSize.xs, fontWeight: fontWeight.bold },
  licence: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  licenceSoon: { backgroundColor: colors.warningLight, borderColor: colors.warning },
  licenceExpired: { backgroundColor: colors.errorLight, borderColor: colors.error },
  licenceText: {
    flex: 1,
    fontSize: fontSize.sm,
    lineHeight: fontSize.sm * lineHeight.normal,
  },
  rowButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
  rowLabel: { flex: 1, fontSize: fontSize.base, color: colors.text },
});
