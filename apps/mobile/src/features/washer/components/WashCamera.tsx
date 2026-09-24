import { colors, fontSize, radius, spacing } from '@parkease/tokens';
import { CameraView } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { warn } from '@/lib/log';

import { DEV_PLACEHOLDER_PHOTO_URI } from '../api/dev-fixtures';
import { usesDevCamera } from '../dev-camera';

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

  // The browser preview under a dev-mock session has no camera to open, so a
  // placeholder photo stands in (ruling T11-W1). Never on a device.
  //
  // Three states (J4): `null` until the answer is in, when NEITHER camera is
  // mounted and the shutter does nothing — defaulting to `false` mounted the
  // real camera for the first frame under the dev mock.
  const [standIn, setStandIn] = useState<boolean | null>(null);
  // H7: one photo per press, however fast the second tap lands. Read through a
  // function, because TypeScript cannot see an await change a ref.
  const shooting = useRef(false);
  const isShooting = () => shooting.current;
  useEffect(() => {
    if (slot === null) return undefined;
    setStandIn(null);
    let current = true;
    // Never rejects: `isWasherDevMock()` logs and answers false instead.
    void usesDevCamera().then((answer) => {
      if (current) setStandIn(answer);
    });
    return () => {
      current = false;
    };
  }, [slot]);

  const shoot = async () => {
    if (slot === null || standIn === null || isShooting()) return;
    if (standIn) {
      onClose();
      onCaptured(slot, DEV_PLACEHOLDER_PHOTO_URI);
      return;
    }
    shooting.current = true;
    try {
      const shot = await camera.current?.takePictureAsync({ quality: 0.85 });
      onClose();
      if (shot === undefined) {
        // Said, not only logged (G9): the camera closed and nothing arrived.
        warn(`washer.WashCamera: the camera returned no ${slot} photo`);
        Alert.alert('No photo was taken', 'The camera did not return a photo. Please try again.');
        return;
      }
      onCaptured(slot, shot.uri);
    } catch (error) {
      warn(`washer.WashCamera: could not take the ${slot} photo`, error);
      onClose();
      Alert.alert("Couldn't take the photo", 'Please try again.');
    } finally {
      shooting.current = false;
    }
  };

  return (
    <Modal visible={slot !== null} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {standIn === null ? (
          <View style={styles.camera} />
        ) : standIn ? (
          <View style={[styles.camera, styles.standIn]}>
            <Text style={styles.standInText}>
              Dev preview: no camera here. The shutter takes a placeholder photo.
            </Text>
          </View>
        ) : (
          <CameraView ref={camera} style={styles.camera} facing="back" />
        )}
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
            testID="wash-camera-shutter"
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
  standIn: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  standInText: { fontSize: fontSize.base, color: colors.textInverse, textAlign: 'center' },
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
