import { Linking } from 'react-native';

/** Opens this app's page in Android settings, where a denied permission is re-granted. */
export function openAppSettings(): Promise<void> {
  return Linking.openSettings();
}
