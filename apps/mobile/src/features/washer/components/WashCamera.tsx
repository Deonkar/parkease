import { colors, fontSize, radius, spacing } from '@parkease/tokens';
import { CameraView } from 'expo-camera';
import { useRef } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { warn } from '@/lib/log';

export interface WashCameraProps<S extends string> {
  /**
   * What is being photographed — a job's `before`/`after`, or a registration
   * photo — named in the shutter's label. `null` keeps the camera closed.
   */
  readonly slot: S | null;
  readonly onCaptured: (slot: S, uri: string) => void;
  readonly onClose: () => void;
}

/**
 * The full-screen camera for one half of the evidence pair.
 *
 * Valet's `ProofCapture` modal is the pattern, copied rather than imported
 * (R-ARCH-01). Permission is the caller's job, before it opens this; this
 * component's job ends at "here is a photograph" — compression, upload and the
 * retry live in `usePhotoSlot`.
 */
export function WashCamera<S extends string>({ slot, onCaptured, onClose }: WashCameraProps<S>) {
  const camera = useRef<CameraView>(null);

  const shoot = async () => {
    if (slot === null) return;
    try {
      const shot = await camera.current?.takePictureAsync({ quality: 0.85 });
      onClose();
      if (shot === undefined) {
        warn(`washer.WashCamera: the camera returned no ${slot} photo`);
        return;
      }
      onCaptured(slot, shot.uri);
    } catch (error) {
      warn(`washer.WashCamera: could not take the ${slot} photo`, error);
      onClose();
      Alert.alert("Couldn't take the photo", 'Please try again.');
    }
  };

  return (
    <Modal visible={slot !== null} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <CameraView ref={camera} style={styles.camera} facing="back" />
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel taking the photo"
            onPress={onClose}
            style={styles.side}
          >
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Take the ${slot ?? ''} photo`}
            onPress={() => void shoot()}
            style={styles.shutter}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <View style={styles.side} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.text },
  camera: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    backgroundColor: colors.text,
  },
  side: { minWidth: 72, minHeight: 48, justifyContent: 'center' },
  cancel: { fontSize: fontSize.base, color: colors.textInverse },
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
