import { Platform } from 'react-native';

import { isWasherDevMock } from './dev-mock';

/**
 * Whether the camera is a stand-in: the browser preview under a dev-mock
 * session (ruling T11-W1), which may have no camera and cannot grant one — so
 * no permission is asked and the shutter "takes" `DEV_PLACEHOLDER_PHOTO_URI`.
 *
 * Web only. An Android device always gets the real camera, dev-mock or not,
 * and a release build never reaches past `isWasherDevMock()`.
 */
export async function usesDevCamera(): Promise<boolean> {
  return Platform.OS === 'web' && (await isWasherDevMock());
}
