import { useCameraPermissions } from 'expo-camera';
import { useCallback, useState } from 'react';
import { Alert, Linking } from 'react-native';

import { warn } from '@/lib/log';

export interface CameraGate<S extends string> {
  /** What the open camera is photographing; `null` while it is closed. */
  readonly slot: S | null;
  /** Asks for the camera if needed, then opens it. Never rejects. */
  readonly open: (slot: S) => Promise<void>;
  readonly close: () => void;
}

/**
 * Camera permission, then the camera — for the registration photos and the
 * profile's missing ID. Extracted on its second use (R-ARCH-07); the active
 * job screen keeps its own copy, which S-38 already tracks.
 *
 * A refusal is said with a way out (Settings when Android will not ask again),
 * and a request that itself rejects is logged and said, never dropped
 * (R-FAIL-01).
 */
export function useCameraGate<S extends string>(reason: string): CameraGate<S> {
  const [permission, requestPermission] = useCameraPermissions();
  const [slot, setSlot] = useState<S | null>(null);

  const open = useCallback(
    async (next: S) => {
      try {
        if (permission?.granted !== true) {
          const answer = await requestPermission();
          if (!answer.granted) {
            Alert.alert(
              'Camera needed',
              reason,
              answer.canAskAgain
                ? undefined
                : [
                    { text: 'Not now', style: 'cancel' },
                    { text: 'Open Settings', onPress: () => void Linking.openSettings() },
                  ],
            );
            return;
          }
        }
        setSlot(next);
      } catch (error) {
        warn(`washer.useCameraGate: could not open the camera for the ${next} photo`, error);
        Alert.alert("Couldn't open the camera", 'Please try again.');
      }
    },
    [permission, requestPermission, reason],
  );

  const close = useCallback(() => {
    setSlot(null);
  }, []);

  return { slot, open, close };
}
