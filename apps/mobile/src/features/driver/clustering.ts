import type { SpaceSearchItem } from '@parkease/contracts/driver';
import Supercluster, { type PointFeature } from 'supercluster';

/**
 * Marker clustering for the discovery map. Engaged only above the threshold —
 * below it, individual markers are both cheaper and more useful (R-PERF-06).
 *
 * This lives outside <ParkMap /> on purpose: the map reports its viewport, and
 * the screen decides what to draw. That keeps the map library confined to
 * ParkMap (R-FE-13) and leaves this logic directly testable.
 */
export const CLUSTER_THRESHOLD = 50;

const CLUSTER_RADIUS_PX = 60;

/**
 * The highest zoom at which points are still grouped. Above this, supercluster
 * returns every point individually — so a caller that lets the driver zoom into
 * a cluster must be able to pass this, or the last cluster never opens.
 */
export const CLUSTER_MAX_ZOOM = 18;

export interface MapBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface MapViewport {
  readonly zoom: number;
  readonly bounds: MapBounds;
}

export type ClusterPoint =
  | { readonly kind: 'space'; readonly id: string; readonly item: SpaceSearchItem }
  | {
      readonly kind: 'cluster';
      readonly id: string;
      readonly count: number;
      readonly location: { readonly lat: number; readonly lng: number };
    };

interface SpaceProps {
  readonly item: SpaceSearchItem;
}

/**
 * Both generics are pinned. Left at its default, supercluster's cluster
 * properties widen to `AnyProps` (an index signature of `any`), which makes
 * every property read off a returned feature untyped.
 */
type ClusterFeature = PointFeature<Supercluster.ClusterProperties & SpaceProps>;
type AnySpaceFeature = PointFeature<SpaceProps> | ClusterFeature;

/** Narrowing on data this module just produced — not a boundary (R-VAL-01). */
function isCluster(feature: AnySpaceFeature): feature is ClusterFeature {
  return (feature.properties as Partial<Supercluster.ClusterProperties>).cluster === true;
}

export function clusterSpaces(
  items: readonly SpaceSearchItem[],
  viewport: MapViewport,
): ClusterPoint[] {
  if (items.length === 0) return [];

  if (items.length <= CLUSTER_THRESHOLD) {
    return items.map((item) => ({ kind: 'space', id: item.id, item }));
  }

  const index = new Supercluster<SpaceProps, SpaceProps>({
    radius: CLUSTER_RADIUS_PX,
    maxZoom: CLUSTER_MAX_ZOOM,
  });

  index.load(
    items.map((item) => ({
      type: 'Feature',
      properties: { item },
      geometry: { type: 'Point', coordinates: [item.location.lng, item.location.lat] },
    })),
  );

  const { west, south, east, north } = viewport.bounds;
  const features = index.getClusters([west, south, east, north], Math.round(viewport.zoom));

  return features.map((feature): ClusterPoint => {
    const [lng = 0, lat = 0] = feature.geometry.coordinates;

    if (isCluster(feature)) {
      return {
        kind: 'cluster',
        id: `cluster-${String(feature.properties.cluster_id)}`,
        count: feature.properties.point_count,
        location: { lat, lng },
      };
    }

    return { kind: 'space', id: feature.properties.item.id, item: feature.properties.item };
  });
}
