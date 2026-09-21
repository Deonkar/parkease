import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

export interface ProofCaptureProps {
  /** The captured image, held locally so a retry never means re-shooting. */
  readonly capturedUri: string | null;
  readonly uploading: boolean;
  readonly error: string | null;
  readonly onCapture: () => void;
  readonly onRetry: () => void;
}

/**
 * The gate on `parking → parked`.
 *
 * This is where the platform's liability for a car ends and the record of its
 * condition begins, so the transition is blocked rather than nagged about. The
 * button is disabled with a **visible reason**, never enabled-then-rejected —
 * and the server enforces the same rule with `400 PROOF_PHOTO_REQUIRED`, so the
 * gate exists on both sides: this one is for the valet, that one is the record.
 *
 * On failure the captured image is retained. A valet who has already locked the
 * car cannot retake the same photo from the same angle, so discarding it would
 * mean shipping a different picture than the one that was approved.
 */
export function ProofCapture({
  capturedUri,
  uploading,
  error,
  onCapture,
  onRetry,
}: ProofCaptureProps) {
  if (capturedUri !== null && error === null) {
    return (
      <View style={[styles.root, styles.attached]} testID="proof-capture">
        <Image
          source={{ uri: capturedUri }}
          style={styles.thumb}
          accessibilityIgnoresInvertColors
        />
        <View style={styles.copy}>
          <Text style={styles.attachedTitle}>Proof photo attached</Text>
          <Text style={styles.attachedDetail}>{uploading ? 'Uploading…' : 'Ready to confirm'}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retake the proof photo"
          onPress={onCapture}
          hitSlop={8}
          style={styles.secondary}
        >
          <Text style={styles.secondaryLabel}>Retake</Text>
        </Pressable>
      </View>
    );
  }

  if (error !== null) {
    return (
      <View style={[styles.root, styles.failed]} testID="proof-capture">
        <MaterialCommunityIcons name="cloud-off-outline" size={24} color={colors.errorInk} />
        <View style={styles.copy}>
          <Text style={styles.failedTitle}>{error}</Text>
          <Text style={styles.failedDetail}>Your photo is saved — no need to retake it.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry uploading the proof photo"
          onPress={onRetry}
          hitSlop={8}
          style={styles.secondary}
        >
          <Text style={styles.secondaryLabel}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.empty} testID="proof-capture">
      <MaterialCommunityIcons name="camera-outline" size={30} color={colors.textTertiary} />
      <Text style={styles.emptyTitle}>Photo of the parked car</Text>
      <Text style={styles.emptyDetail}>Required before you can confirm</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Take a photo of the parked car"
        onPress={onCapture}
        style={styles.capture}
      >
        <Text style={styles.captureLabel}>Take Photo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  attached: { backgroundColor: colors.availableSoft, borderColor: colors.available },
  failed: { backgroundColor: colors.errorLight, borderColor: colors.error },
  copy: { flex: 1, gap: 2 },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
  },
  attachedTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.availableInk },
  attachedDetail: { fontSize: fontSize.xs, color: colors.availableInk },
  failedTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.errorInk },
  failedDetail: { fontSize: fontSize.xs, color: colors.errorInk },
  secondary: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  secondaryLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  emptyTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.text },
  emptyDetail: { fontSize: fontSize.xs, color: colors.textTertiary },
  capture: {
    alignSelf: 'stretch',
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.text,
  },
  captureLabel: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.textInverse },
});
