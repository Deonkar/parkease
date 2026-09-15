import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

import type { SearchOrigin } from './useSearchFilters';

/**
 * Where the search is centred, and how we got there.
 *
 * `prompting` is the rationale step: the driver is told why location is wanted
 * before the OS dialog appears. A denial is not a dead end — it routes to
 * Search Manually, which is place search with a typed origin instead of GPS.
 */
export type OriginStatus = 'prompting' | 'locating' | 'ready' | 'denied';

export interface NearbyOrigin {
  readonly status: OriginStatus;
  readonly origin: SearchOrigin | null;
  /** True while the origin came from a typed place rather than the device. */
  readonly isManual: boolean;
  readonly error: string | null;
  readonly requestLocation: () => void;
  readonly setManualOrigin: (origin: SearchOrigin) => void;
  readonly recentre: () => void;
}

export function useNearbyOrigin(): NearbyOrigin {
  const [status, setStatus] = useState<OriginStatus>('prompting');
  const [origin, setOrigin] = useState<SearchOrigin | null>(null);
  const [isManual, setIsManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locate = useCallback(async () => {
    setStatus('locating');
    setError(null);
    try {
      const { status: permission } = await Location.requestForegroundPermissionsAsync();
      if (permission !== Location.PermissionStatus.GRANTED) {
        setStatus('denied');
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setOrigin({ lat: position.coords.latitude, lng: position.coords.longitude });
      setIsManual(false);
      setStatus('ready');
    } catch (cause) {
      // A location failure is reported, never swallowed into a blank map (R-FAIL-01).
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus('denied');
    }
  }, []);

  const requestLocation = useCallback(() => {
    void locate();
  }, [locate]);

  const setManualOrigin = useCallback((next: SearchOrigin) => {
    setOrigin(next);
    setIsManual(true);
    setStatus('ready');
    setError(null);
  }, []);

  const recentre = useCallback(() => {
    void locate();
  }, [locate]);

  // Ask once on mount. On web the browser shows its own prompt, so the
  // rationale state is short-lived there; on native it precedes the OS dialog.
  useEffect(() => {
    void locate();
  }, [locate]);

  return { status, origin, isManual, error, requestLocation, setManualOrigin, recentre };
}
