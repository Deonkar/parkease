import { describe, expect, it } from 'vitest';

import { MAPLIBRE_CSS, MAPLIBRE_WORKER_URL, initWebMap } from '../src/web-map.js';

/** Declarations of every rule whose selector list includes `selector`. */
function rules(css: string, selector: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sel]) =>
      sel
        .split(',')
        .map((s) => s.trim())
        .includes(selector),
    )
    .map(([, , body]) => body);
}

function keyframes(css: string, name: string): string {
  const start = css.indexOf(`@keyframes ${name}{`);
  if (start < 0) throw new Error(`no @keyframes ${name}`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error(`unterminated @keyframes ${name}`);
}

describe('ParkMap web CSS', () => {
  // The canvas container only holds absolutely positioned children (canvas, markers),
  // so it has no height of its own; clipping it hides the whole map.
  it('never clips the map canvas container', () => {
    for (const body of rules(MAPLIBRE_CSS, '.maplibregl-canvas-container')) {
      expect(body).not.toMatch(/overflow\s*:\s*hidden/);
    }
  });

  // MapLibre positions each marker by writing `transform` on the marker element, which
  // is the `.parkease-marker` hit area. An animation or transition on `transform`
  // there overrides that, and every marker piles up at the map's top-left corner.
  it('never animates transform on the marker element MapLibre positions', () => {
    expect(keyframes(MAPLIBRE_CSS, 'parkease-marker-in')).not.toMatch(/(^|[{;])\s*transform\s*:/);
  });

  it('never transitions transform on the marker element, so markers keep up with a pan', () => {
    for (const body of rules(MAPLIBRE_CSS, '.parkease-marker')) {
      const transition = /transition\s*:([^;}]*)/.exec(body)?.[1] ?? '';
      expect(transition).not.toMatch(/\btransform\b/);
    }
  });
});

describe('initWebMap', () => {
  const Map = function Map() {};
  const Marker = function Marker() {};

  // Under Metro, MapLibre 6 resolves its worker against the bundle URL and gets the
  // app's HTML fallback page instead, so no style or tile is ever processed.
  it('points MapLibre at the worker the web build serves', () => {
    const calls: string[] = [];
    const init = initWebMap({ Map, Marker, setWorkerUrl: (url: string) => calls.push(url) });
    expect(calls).toEqual([MAPLIBRE_WORKER_URL]);
    expect(MAPLIBRE_WORKER_URL).toBe('/maplibre/maplibre-gl-worker.mjs');
    expect(init.gl).not.toBeNull();
    expect(init.reason).toBe('');
  });

  it('reads the CJS shape, where the module nests under `default`', () => {
    const calls: string[] = [];
    const init = initWebMap({
      default: { Map, Marker, setWorkerUrl: (url: string) => calls.push(url) },
    });
    expect(init.gl).not.toBeNull();
    expect(calls).toHaveLength(1);
  });

  // The map must not count as available unless the worker is configured: otherwise it
  // renders blank with the default worker and the fallback never says why (R-FAIL-01).
  it('reports the map unavailable, with the reason, when the worker cannot be configured', () => {
    const init = initWebMap({
      Map,
      Marker,
      setWorkerUrl: () => {
        throw new Error('setWorkerUrl is gone');
      },
    });
    expect(init.gl).toBeNull();
    expect(init.reason).toContain('setWorkerUrl is gone');
  });

  it('reports the map unavailable when the module has no Map constructor', () => {
    const init = initWebMap({ Marker, setWorkerUrl: () => {} });
    expect(init.gl).toBeNull();
    expect(init.reason).toMatch(/Map constructor/);
  });
});
