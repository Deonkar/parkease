import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, radius, spacing } from '@parkease/tokens';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export interface ProofCaptureProps {
  /** The captured image, held locally so a retry never means re-shooting. */
  readonly capturedUri: string | null;
  readonly uploading: boolean;
  readonly error: string | null;
  /** Called with the file uri of a freshly taken photograph. */
  readonly onCaptured: (uri: string) => void;
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
  onCaptured,
  onRetry,
}: ProofCaptureProps) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);

  const onCapture = async () => {
    if (permission?.granted !== true) {
      const next = await requestPermission();
      if (!next.granted) return;
    }
    setCameraOpen(true);
  };

  const shoot = async () => {
    const shot = await camera.current?.takePictureAsync({ quality: 0.85 });
    setCameraOpen(false);
    if (shot === undefined) return;
    // Compression happens in the caller's hook, which also owns the upload and
    // the retry — this component's job ends at "here is a photograph".
    onCaptured(shot.uri);
  };

  const cameraModal = (
    <Modal
      visible={cameraOpen}
      animationType="slide"
      onRequestClose={() => {
        setCameraOpen(false);
      }}
    >
      <View style={styles.cameraRoot}>
        <CameraView ref={camera} style={styles.camera} facing="back" />
        <View style={styles.cameraBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel taking the photo"
            onPress={() => {
              setCameraOpen(false);
            }}
            style={styles.cameraCancel}
          >
            <Text style={styles.cameraCancelLabel}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take the photo"
            onPress={() => void shoot()}
            style={styles.shutter}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <View style={styles.cameraCancel} />
        </View>
      </View>
    </Modal>
  );
  if (capturedUri !== null && error === null) {
    return (
      <View style={[styles.root, styles.attached]} testID="proof-capture">
        {cameraModal}
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
          onPress={() => void onCapture()}
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
        {cameraModal}
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
      {cameraModal}
      <MaterialCommunityIcons name="camera-outline" size={30} color={colors.textTertiary} />
      <Text style={styles.emptyTitle}>Photo of the parked car</Text>
      <Text style={styles.emptyDetail}>Required before you can confirm</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Take a photo of the parked car"
        onPress={() => void onCapture()}
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
  cameraRoot: { flex: 1, backgroundColor: colors.text },
  camera: { flex: 1 },
  cameraBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    backgroundColor: colors.text,
  },
  cameraCancel: { minWidth: 72, minHeight: 48, justifyContent: 'center' },
  cameraCancelLabel: { fontSize: fontSize.base, color: colors.textInverse },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    borderWidth: 4,
    borderColor: colors.textInverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.textInverse,
  },
});
