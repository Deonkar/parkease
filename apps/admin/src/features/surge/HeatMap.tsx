import { BASIS_POINTS, surgeHeatCellSchema, type SurgeHeatCell } from '@parkease/contracts/admin';
import { colors } from '@parkease/tokens';
import { Card, Space, Table, Tag, Typography } from 'antd';
import type { FeatureCollection } from 'geojson';
import {
  Map as MapLibre,
  setWorkerUrl,
  type MapLayerMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import { PageState } from '../../components/data';
import { useApi } from '../../lib/api';

// MapLibre 6 finds its worker via `new URL(..., import.meta.url)`, which Vite's dependency
// pre-bundling rewrites to a URL that does not exist: the worker never starts, nothing is drawn and
// nothing logs (learnings: "The web map was blank since task 6"). Bundle the worker ourselves.
setWorkerUrl(workerUrl);

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** A geohash cell's bounding box: [west, south, east, north]. Bits alternate, longitude first. */
export function geohashBounds(hash: string): [number, number, number, number] {
  let [west, east, south, north] = [-180, 180, -90, 90];
  let lon = true;
  for (const char of hash) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error(`not a geohash: ${hash}`);
    for (let bit = 4; bit >= 0; bit -= 1) {
      const on = ((value >> bit) & 1) === 1;
      if (lon) {
        const mid = (west + east) / 2;
        if (on) west = mid;
        else east = mid;
      } else {
        const mid = (south + north) / 2;
        if (on) south = mid;
        else north = mid;
      }
      lon = !lon;
    }
  }
  return [west, south, east, north];
}

/** Steps match the default ladder's tiers; the number is always shown beside the colour. */
const STEPS: [number, string][] = [
  [10_000, '#E0F2FE'],
  [12_500, '#7DD3FC'],
  [15_000, '#F59E0B'],
  [20_000, colors.surge],
];
/** Ink for a legend chip: the darkest step takes white, the rest the body ink (AA, tested). */
export const inkFor = (fill: string): string =>
  fill === colors.surge ? colors.textInverse : colors.text;
export { STEPS as HEAT_STEPS };
const colourFor = (bp: number): string =>
  STEPS.filter(([min]) => bp >= min).at(-1)?.[1] ?? '#E0F2FE';
const x = (bp: number): string => `${(bp / BASIS_POINTS).toFixed(2)}×`;

const OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

function toGeoJson(cells: readonly SurgeHeatCell[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: cells.map((c) => {
      const [w, s, e, n] = geohashBounds(c.zoneId);
      return {
        type: 'Feature',
        properties: {
          zoneId: c.zoneId,
          fill: colourFor(c.live.multiplierBp),
          overridden: c.overridden,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [w, s],
              [e, s],
              [e, n],
              [w, n],
              [w, s],
            ],
          ],
        },
      };
    }),
  };
}

export function HeatMap() {
  const q = useApi(z.array(surgeHeatCellSchema), '/admin/surge/heatmap');
  const container = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const cells = q.data?.data ?? [];

  useEffect(() => {
    if (container.current === null || cells.length === 0) return;
    const first = geohashBounds(cells[0]?.zoneId ?? 'tdr1');
    const map = new MapLibre({
      container: container.current,
      style: OSM_STYLE,
      center: [(first[0] + first[2]) / 2, (first[1] + first[3]) / 2],
      zoom: 12,
    });
    map.on('load', () => {
      const boxes = cells.map((c) => geohashBounds(c.zoneId));
      map.fitBounds(
        [
          [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1]))],
          [Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))],
        ],
        { padding: 40, duration: 0 },
      );
      map.addSource('cells', { type: 'geojson', data: toGeoJson(cells) });
      map.addLayer({
        id: 'fill',
        type: 'fill',
        source: 'cells',
        paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.55 },
      });
      // Overridden cells get a dashed outline: status is never carried by colour alone.
      map.addLayer({
        id: 'edge',
        type: 'line',
        source: 'cells',
        paint: {
          'line-color': colors.text,
          'line-width': ['case', ['get', 'overridden'], 2.5, 0.5],
          'line-dasharray': [2, 1],
        },
      });
      map.on('mousemove', 'fill', (e: MapLayerMouseEvent) => {
        setHover(String(e.features?.[0]?.properties.zoneId ?? ''));
      });
      map.on('mouseleave', 'fill', () => {
        setHover(null);
      });
    });
    return () => {
      map.remove();
    };
  }, [cells]);

  const hovered = cells.find((c) => c.zoneId === hover);

  return (
    <Card
      title="Heat map"
      extra={
        <Space>
          {STEPS.map(([bp, fill]) => (
            <Tag key={bp} color={fill} style={{ color: inkFor(fill) }}>
              {x(bp)}+
            </Tag>
          ))}
          <Tag>dashed = override</Tag>
        </Space>
      }
    >
      <PageState
        isLoading={q.isLoading}
        error={q.error}
        isEmpty={cells.length === 0}
        emptyText="No zone has an active space yet."
        onRetry={() => void q.refetch()}
      >
        {
          <div
            ref={container}
            style={{ height: 360, borderRadius: 10, overflow: 'hidden' }}
            aria-label="Surge heat map"
          />
        }
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
          {hovered
            ? `${hovered.zoneId} · ${x(hovered.live.multiplierBp)} · occupancy ${(hovered.live.occupancyBp / 100).toFixed(0)}% · ${String(hovered.activeSpaces)} active spaces${hovered.overridden ? ' · override' : ''}`
            : 'Hover a cell for its numbers; every cell is also listed below.'}
        </Typography.Paragraph>
        <Table<SurgeHeatCell>
          rowKey="zoneId"
          size="small"
          pagination={{ pageSize: 10 }}
          dataSource={cells}
          columns={[
            {
              title: 'Zone',
              dataIndex: 'zoneId',
              render: (zone: string) => <Typography.Text code>{zone}</Typography.Text>,
            },
            {
              title: 'Multiplier',
              render: (_, c) => (
                <Tag
                  color={colourFor(c.live.multiplierBp)}
                  style={{ color: inkFor(colourFor(c.live.multiplierBp)) }}
                >
                  {x(c.live.multiplierBp)}
                </Tag>
              ),
            },
            { title: 'Occupancy', render: (_, c) => `${(c.live.occupancyBp / 100).toFixed(0)}%` },
            { title: 'Active spaces', dataIndex: 'activeSpaces' },
            { title: '', render: (_, c) => (c.overridden ? <Tag>override</Tag> : null) },
          ]}
        />
      </PageState>
    </Card>
  );
}
