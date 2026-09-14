import { describe, expect, it } from 'vitest';

import { CLUSTER_THRESHOLD, clusterSpaces } from '../clustering';

import { makeItem } from './fixtures';

const VIEW = { zoom: 13, bounds: { west: 77.5, south: 12.85, east: 77.75, north: 13.05 } };

function manyItems(count: number) {
  return Array.from({ length: count }, (_, i) =>
    makeItem({
      id: `0192f1b3-0000-7000-8000-${String(i).padStart(12, '0')}`,
      // Spread over a small patch so they genuinely collide at low zoom.
      location: { lat: 12.93 + (i % 10) * 0.0005, lng: 77.62 + Math.floor(i / 10) * 0.0005 },
    }),
  );
}

describe('clusterSpaces', () => {
  it('returns every space individually below the threshold', () => {
    const items = manyItems(CLUSTER_THRESHOLD);
    const result = clusterSpaces(items, VIEW);
    expect(result).toHaveLength(CLUSTER_THRESHOLD);
    expect(result.every((point) => point.kind === 'space')).toBe(true);
  });

  it('clusters once above the threshold', () => {
    const items = manyItems(CLUSTER_THRESHOLD + 80);
    const result = clusterSpaces(items, VIEW);
    expect(result.length).toBeLessThan(items.length);
    expect(result.some((point) => point.kind === 'cluster')).toBe(true);
  });

  it('keeps every space accounted for across clusters', () => {
    const items = manyItems(CLUSTER_THRESHOLD + 80);
    const total = clusterSpaces(items, VIEW).reduce(
      (sum, point) => sum + (point.kind === 'cluster' ? point.count : 1),
      0,
    );
    expect(total).toBe(items.length);
  });

  it('separates again when zoomed in far enough', () => {
    const items = manyItems(CLUSTER_THRESHOLD + 80);
    const zoomedOut = clusterSpaces(items, { ...VIEW, zoom: 11 });
    const zoomedIn = clusterSpaces(items, { ...VIEW, zoom: 20 });
    expect(zoomedIn.length).toBeGreaterThan(zoomedOut.length);
  });

  it('returns nothing for no results', () => {
    expect(clusterSpaces([], VIEW)).toEqual([]);
  });
});
