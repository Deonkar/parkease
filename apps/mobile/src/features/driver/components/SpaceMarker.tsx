import type { DurationType } from '@parkease/contracts/enums';
import type { ParkMapMarker } from '@parkease/ui-native';

import type { ClusterPoint } from '../clustering';
import { markerPriceLabel, markerTone, spaceAccessibilityLabel } from '../space-display';

/**
 * Turns search results into the marker models <ParkMap /> draws.
 *
 * There is no marker *component* here on purpose: `packages/ui-native/ParkMap`
 * is the only file allowed to touch the map library (R-FE-13), so markers are
 * described as data and rendered there. This module owns what a marker says.
 */
export function toMarkerModels(
  points: readonly ClusterPoint[],
  selectedId: string | null,
  duration: DurationType,
): ParkMapMarker[] {
  return points.map((point) => {
    if (point.kind === 'cluster') {
      return {
        id: point.id,
        location: point.location,
        label: String(point.count),
        tone: 'cluster',
        accessibilityLabel: `${String(point.count)} parking spaces in this area, zoom in to see them`,
      };
    }

    const { item } = point;
    return {
      id: item.id,
      location: item.location,
      // Price label on every marker — colour is never the only signal (R-FE-12).
      label: markerPriceLabel(item),
      tone: markerTone(item),
      accessibilityLabel: spaceAccessibilityLabel(item, duration),
      selected: selectedId === item.id,
    };
  });
}
