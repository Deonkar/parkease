import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ValetLocationView } from '@parkease/contracts/valet';
import { colors, fontSize, radius, spacing } from '@parkease/tokens';
import { ParkMap } from '@parkease/ui-native';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fixFreshness, staleFixLabel } from '../valet-tracking';

/** How often the freshness is re-judged. The banner is in seconds, not frames. */
const FRESHNESS_TICK_MS = 5_000;

interface ValetMapProps {
  readonly fix: ValetLocationView | null;
  /** Injected so a test can stand at a fixed moment. */
  readonly now?: () => number;
}

/**
 * Where the valet is, with the age of that claim stated once it goes stale.
 *
 * With no fix yet the map is not drawn at all — an empty map centred on nothing
 * says "we are tracking" when nothing has been heard.
 */
export function ValetMap({ fix, now = Date.now }: ValetMapProps) {
  const [tick, setTick] = useState(() => now());

  useEffect(() => {
    const timer = setInterval(() => {
      setTick(now());
    }, FRESHNESS_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [now]);

  if (fix === null) {
    return (
      <Text style={styles.waiting} testID="valet-map-waiting">
        The map appears once your valet starts moving.
      </Text>
    );
  }

  const freshness = fixFreshness(fix, Math.max(tick, now()));

  return (
    <View style={styles.wrap} testID="valet-map">
      <ParkMap
        location={{ lat: fix.lat, lng: fix.lng }}
        interactive
        style={styles.map}
        markers={[
          {
            id: 'valet',
            location: { lat: fix.lat, lng: fix.lng },
            label: 'Valet',
            tone: 'car',
            accessibilityLabel: 'Your valet',
          },
        ]}
      />
      {freshness.kind === 'stale' ? (
        <View style={styles.stale} testID="valet-fix-stale" accessibilityLiveRegion="polite">
          <MaterialCommunityIcons name="signal-off" size={16} color={colors.surge} />
          <Text style={styles.staleText}>
            {staleFixLabel(freshness.secondsAgo)}. Their phone may have lost signal.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  map: { height: 220, borderRadius: radius.md, overflow: 'hidden' },
  waiting: { fontSize: fontSize.sm, color: colors.textSecondary },
  stale: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surgeSoft,
  },
  staleText: { flex: 1, fontSize: fontSize.sm, color: colors.text },
});
