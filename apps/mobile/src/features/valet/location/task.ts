import type * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { warn } from '@/lib/log';

import { recordFixFailure, recordLastFixAt, valetLocationQueue } from './store';

/**
 * Looked up BY STRING by the OS. Never inline this literal at a call site.
 *
 * When Android wakes the process to deliver a location, it finds the handler by
 * this name. Nothing is mounted at that moment, which is why the definition
 * below runs at module scope rather than inside a hook — see the regression
 * test in `__tests__/location-task.test.ts`.
 */
export const VALET_LOCATION_TASK = 'parkease.valet.location';

interface LocationTaskData {
  readonly locations: Location.LocationObject[];
}

TaskManager.defineTask(VALET_LOCATION_TASK, async ({ data, error }) => {
  // Nothing awaits this callback, so a rejection escaping it is an unhandled
  // promise rejection in a headless process: the fix vanishes, no failure is
  // recorded, and the valet's screen still claims to be tracking. Every path
  // below is therefore guarded (R-FAIL-01).
  try {
    if (error) {
      // The OS revoked location, killed the service, or the device lost its
      // fix. Recorded so the UI can say so, instead of showing a pin that
      // quietly stopped moving — which looks identical to a valet standing still.
      await recordFixFailure(error.message);
      return;
    }

    const { locations } = (data ?? { locations: [] }) as LocationTaskData;
    const latest = locations.at(-1);
    if (latest === undefined) return;

    // Enqueue, do not send. This runs in a headless context where the socket
    // may not be connected. A fire-and-forget emit here loses fixes silently.
    await valetLocationQueue.enqueue({
      lat: latest.coords.latitude,
      lng: latest.coords.longitude,
      headingDeg: latest.coords.heading ?? null,
      accuracyM: latest.coords.accuracy ?? null,
      recordedAt: latest.timestamp,
    });

    // Written after the enqueue so the banner never claims a fix we failed to
    // keep. Carries the fix's own timestamp, not the time of this write.
    await recordLastFixAt(latest.timestamp);
  } catch (thrown) {
    warn('valet.locationTask: could not record a fix', thrown);
    // Best-effort: if even this write fails there is nothing left to try, and
    // the health banner will report the feed as stale on its own.
    try {
      await recordFixFailure(thrown instanceof Error ? thrown.message : 'unknown task failure');
    } catch (nested) {
      warn('valet.locationTask: could not record the failure either', nested);
    }
  }
});
