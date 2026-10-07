import { NOTIFICATION_CATEGORIES, type NotificationCategory } from '@parkease/contracts/shared';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { warn } from '@/lib/log';

import { deactivatePushToken, registerPushToken } from './api';

/**
 * Time-sensitive categories interrupt; promotions never do. One Android channel per category (the
 * worker sends `channelId: category`), so a user can silence one in system settings.
 */
const IMPORTANCE: Record<NotificationCategory, Notifications.AndroidImportance> = {
  bookings: Notifications.AndroidImportance.DEFAULT,
  valet: Notifications.AndroidImportance.HIGH,
  carwash: Notifications.AndroidImportance.DEFAULT,
  jobs: Notifications.AndroidImportance.HIGH,
  spaces: Notifications.AndroidImportance.DEFAULT,
  payouts: Notifications.AndroidImportance.DEFAULT,
  reviews: Notifications.AndroidImportance.LOW,
  account: Notifications.AndroidImportance.DEFAULT,
  promotions: Notifications.AndroidImportance.LOW,
};

const CHANNEL_NAMES: Record<NotificationCategory, string> = {
  bookings: 'Bookings',
  valet: 'Valet',
  carwash: 'Car wash',
  jobs: 'Job offers',
  spaces: 'Spaces',
  payouts: 'Payouts',
  reviews: 'Reviews',
  account: 'Account',
  promotions: 'Offers and tips',
};

/** The token this install registered, kept so sign-out can retire exactly that one. */
let registeredToken: string | null = null;

async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const category of NOTIFICATION_CATEGORIES) {
    await Notifications.setNotificationChannelAsync(category, {
      name: CHANNEL_NAMES[category],
      importance: IMPORTANCE[category],
    });
  }
}

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * Registers this device's Expo push token with the API. Returns whether a token is now on file.
 *
 * Every refusal is a logged decision, not a silent skip (R-FAIL-01): an emulator has no push
 * token, a build without an EAS project id cannot ask for one, and a user may say no. None of
 * them stops the app; the in-app feed still works without push.
 */
export async function registerForPush(): Promise<boolean> {
  if (!Device.isDevice) {
    warn('push: not a physical device; no push token');
    return false;
  }
  await ensureChannels();
  if (!(await ensurePermission())) {
    warn('push: notification permission not granted');
    return false;
  }
  // `eas init` writes the project id to `extra.eas.projectId`; without it Expo cannot mint a token.
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const resolved = extra?.eas?.projectId;
  if (resolved === undefined) {
    warn('push: no EAS project id in the app config; cannot request a push token');
    return false;
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: resolved });
  await registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
  registeredToken = token;
  return true;
}

/**
 * Retires this install's token on sign-out, so the next person on the phone is not sent the last
 * one's notifications. Best effort and never throws: a failure here must not trap the user in a
 * signed-in session. The server also moves a token to whoever registers it next.
 */
export async function deactivateRegisteredPushToken(): Promise<void> {
  const token = registeredToken;
  if (token === null) return;
  registeredToken = null;
  try {
    await deactivatePushToken(token);
  } catch (error) {
    warn('push: could not retire the push token on sign-out', error);
  }
}
