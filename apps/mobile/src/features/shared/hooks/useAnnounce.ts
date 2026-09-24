import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Says a message to TalkBack the moment it appears (H4).
 *
 * One approach for every washer message, chosen over `accessibilityLiveRegion`:
 * a live region is only read when content CHANGES inside a view that already
 * exists, and most of these messages mount together with their view — a
 * notice, a field error, a failed slot — so the region was silent exactly when
 * it mattered. An announcement does not depend on what was mounted before.
 *
 * `null` says nothing. The same text again says nothing either, until a
 * different message (or `null`) has come in between.
 */
export function useAnnounce(message: string | null): void {
  useEffect(() => {
    if (message !== null) announce(message);
  }, [message]);
}

/** For an event rather than a state, such as a save landing. */
export function announce(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}
