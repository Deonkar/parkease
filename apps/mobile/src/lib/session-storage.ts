import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Everything a signed-in session leaves in unencrypted storage.
 *
 * Tokens live in `expo-secure-store` and are cleared by `secureStorage.clear()`
 * (R-FE-10). This is the other half: the AsyncStorage a feature writes while
 * someone is signed in — today the valet's location queue, its last-fix
 * timestamp and its failure record.
 *
 * Those are correctly NOT in secure storage, because they are not secrets. But
 * a queue of up to 200 GPS fixes is a readable record of where a person drove,
 * and it was surviving logout on a device that may be shared or handed back.
 * The miss was retention, not storage class.
 */

/**
 * Cleared on logout. Everything the app writes under this prefix belongs to
 * whoever was signed in.
 *
 * Matched by prefix rather than by an enumerated list on purpose: a list has to
 * be updated by whoever adds the next feature key, and the first time that is
 * forgotten the data silently outlives the session again. Keys that outlive a
 * session — `hasOnboarded` is a property of the device, not of a user — simply
 * do not carry the prefix.
 */
const SESSION_KEY_PREFIX = 'parkease.';

export async function clearSessionScopedStorage(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const sessionKeys = keys.filter((key) => key.startsWith(SESSION_KEY_PREFIX));
  if (sessionKeys.length === 0) return;
  // `removeMany`, not `multiRemove`: AsyncStorage v3 renamed the batch APIs
  // (`multiGet`/`multiSet`/`multiRemove` became `getMany`/`setMany`/`removeMany`,
  // with the old names surviving only as `legacy_*`).
  await AsyncStorage.removeMany(sessionKeys);
}
