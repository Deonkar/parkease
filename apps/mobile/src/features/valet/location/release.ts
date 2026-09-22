import { warn } from '@/lib/log';

import { trackingDeps } from './platform';
import { stopTracking } from './tracking';

/**
 * Release background tracking on sign-out.
 *
 * Its own module, and deliberately not an import of the valet feature from
 * `AuthContext`: sign-out is a cross-cutting concern that must reach whatever a
 * role left running, and this is the one seam the auth layer needs.
 *
 * Never throws. A sign-out that fails because the availability PATCH timed out
 * would strand the user signed in, which is worse than a stale `is_online` row
 * the next heartbeat corrects.
 */
export async function releaseBackgroundTracking(): Promise<void> {
  try {
    await stopTracking(trackingDeps);
  } catch (error) {
    warn('valet.signOut: could not release background tracking', error);
  }
}
