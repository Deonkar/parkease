import {
  VALET_TRACKING_NAMESPACE,
  type ValetLocationView,
  valetLocationViewSchema,
  ValetSocketEvent,
} from '@parkease/contracts/valet';
import { useEffect, useState } from 'react';

import { warn } from '@/lib/log';
import { connectNamespace } from '@/lib/socket';

/**
 * The valet's live position for one job, over `/valet-tracking`.
 *
 * The gateway checks that this driver owns the job before joining the room, and
 * replays the last fix on join, so a map opened mid-journey is not empty. A
 * status frame calls `onStatus`, which the screen uses to re-read the job
 * rather than wait for the next poll.
 *
 * Every frame is parsed (R-VAL-01): a socket payload skipped every HTTP pipe.
 */
export function useValetTracking(
  jobId: string,
  enabled: boolean,
  onStatus: () => void,
): ValetLocationView | null {
  const [fix, setFix] = useState<ValetLocationView | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let detach: (() => void) | null = null;

    void connectNamespace(VALET_TRACKING_NAMESPACE)
      .then((connection) => {
        if (cancelled) return;
        const onLocation = (payload: unknown) => {
          const parsed = valetLocationViewSchema.safeParse(payload);
          if (parsed.success) setFix(parsed.data);
          else warn('driver.valetTracking: dropped a malformed location frame');
        };
        connection.socket.on(ValetSocketEvent.LOCATION, onLocation);
        connection.socket.on(ValetSocketEvent.STATUS, onStatus);
        connection.subscribe(ValetSocketEvent.SUBSCRIBE, { jobId });
        detach = () => {
          connection.socket.off(ValetSocketEvent.LOCATION, onLocation);
          connection.socket.off(ValetSocketEvent.STATUS, onStatus);
          connection.unsubscribe(ValetSocketEvent.SUBSCRIBE, { jobId });
        };
      })
      .catch((error: unknown) => {
        // The polled job still carries the last fix, so the map degrades to
        // ten-second updates rather than going blank — but never silently.
        warn('driver.valetTracking: could not open the tracking socket', error);
      });

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [enabled, jobId, onStatus]);

  return fix;
}
