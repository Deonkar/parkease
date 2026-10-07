import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { warn } from '@/lib/log';

import { registerForPush } from './push';
import { resolveTap } from './routing';

// expo-notifications has no web implementation; some of its methods throw there, so on web (the
// preview) every call is skipped. The product is Android-only (ADR-023).
const PUSH_SUPPORTED = Platform.OS !== 'web';

if (PUSH_SUPPORTED) {
  Notifications.setNotificationHandler({
    // eslint-disable-next-line @typescript-eslint/require-await -- the handler must return a promise
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Mounted once, under the auth provider, renders nothing. While signed in it registers the push
 * token and routes a tapped notification — one received while the app was closed included.
 *
 * Authorisation is the destination screen's. This only picks where to land, and refuses a link
 * into a role the user does not hold (see `resolveTap`).
 */
export function PushRegistration() {
  const auth = useAuth();
  const roles = auth.status === 'authenticated' ? auth.roles : null;
  const activeRole = auth.status === 'authenticated' ? auth.activeRole : null;
  const switchRole = auth.switchRole;
  const signedIn = roles !== null;
  // getLastNotificationResponse() keeps answering with the same tap; without this, switching
  // role (which changes activeRole and re-runs the effect) would open the notification again.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!signedIn || !PUSH_SUPPORTED) return;
    registerForPush().catch((error: unknown) => {
      warn('push: registration failed', error);
    });
  }, [signedIn]);

  useEffect(() => {
    if (roles === null || !PUSH_SUPPORTED) return;

    const open = (response: Notifications.NotificationResponse | null): void => {
      if (response === null) return;
      const key = `${response.notification.request.identifier}:${String(response.notification.date)}`;
      if (handled.current === key) return;
      handled.current = key;
      const target = resolveTap(
        response.notification.request.content.data?.['deepLink'],
        roles,
        activeRole,
      );
      if (target === null) {
        router.push('/(shared)/notifications');
        return;
      }
      const go = async (): Promise<void> => {
        if (target.switchTo !== null) await switchRole(target.switchTo);
        router.push(target.href as never);
      };
      go().catch((error: unknown) => {
        warn('push: could not open the notification target', error);
        router.push('/(shared)/notifications');
      });
    };

    // A tap that launched the app arrives before any listener could be attached.
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      subscription.remove();
    };
  }, [roles, activeRole, switchRole]);

  return null;
}
