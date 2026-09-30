import { duration } from '@parkease/tokens';

/**
 * The CSS ParkMap injects on web in place of MapLibre's own stylesheet, which this
 * app does not load. Pure — no react-native import — so Node tests can read it.
 */
export const MAPLIBRE_CSS: string = [
  '.maplibregl-map{font:12px/20px Helvetica,Arial,sans-serif;overflow:hidden;position:relative;-webkit-tap-highlight-color:rgba(0,0,0,0)}',
  '.maplibregl-canvas{position:absolute;left:0;top:0}',
  '.maplibregl-ctrl-bottom-left,.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-top-left,.maplibregl-ctrl-top-right{position:absolute;pointer-events:none;z-index:2}',
  '.maplibregl-ctrl-top-left{top:0;left:0}.maplibregl-ctrl-top-right{top:0;right:0}',
  '.maplibregl-ctrl-bottom-left{bottom:0;left:0}.maplibregl-ctrl-bottom-right{bottom:0;right:0}',
  '.maplibregl-ctrl{pointer-events:auto}',
  '.maplibregl-ctrl-attrib{background-color:hsla(0,0%,100%,.5);font-size:10px;padding:0 5px}',
  '.maplibregl-marker{position:absolute;top:0;left:0;will-change:transform;opacity:1;transition:opacity .2s}',
  // Marker entrance: compositor-only (opacity + the individual `scale`/`translate`
  // properties), staggered by the per-marker animation-delay. Never `transform`:
  // `.parkease-marker` is the element MapLibre positions by writing `transform`,
  // and an animation or transition on it would pin every marker to the top-left.
  `@keyframes parkease-marker-in{from{opacity:0;scale:0.6;translate:0 6px}to{opacity:1;scale:1;translate:0 0}}`,
  `.parkease-marker{animation:parkease-marker-in ${String(duration.base)}ms cubic-bezier(0.05,0.7,0.1,1) both}`,
  // No transition here: a selection change rebuilds the markers (markerSignature), so
  // there is no previous state to transition from, and a transition on `transform`
  // would drag every marker behind the map during a pan.
  // Reduced motion: state changes instantly, nothing moves.
  '@media (prefers-reduced-motion: reduce){.parkease-marker{animation:none!important}}',
].join('\n');

/**
 * Where the web build serves MapLibre's worker (copied into `apps/mobile/public/maplibre/`
 * by `apps/mobile/scripts/copy-maplibre-worker.mjs` on install). Without it, MapLibre 6
 * resolves the worker against the Metro bundle's URL, gets the app's HTML fallback page,
 * and never processes a style or a tile — the map stays blank.
 */
export const MAPLIBRE_WORKER_URL = '/maplibre/maplibre-gl-worker.mjs';

/** The part of maplibre-gl that ParkMap needs before creating a map. */
export interface WebMapModule {
  Map: unknown;
  setWorkerUrl(url: string): void;
}

/**
 * Picks the maplibre-gl export (it ships dual ESM/CJS; the CJS path nests under
 * `default`) and points it at the served worker. The map counts as available only
 * once that succeeds; otherwise `reason` says why, for the fallback UI (R-FAIL-01).
 */
export function initWebMap(mod: unknown): { gl: WebMapModule | null; reason: string } {
  const candidate = (
    typeof (mod as Partial<WebMapModule> | null)?.Map === 'function'
      ? mod
      : (mod as { default?: unknown } | null)?.default
  ) as Partial<WebMapModule> | undefined;
  if (typeof candidate?.Map !== 'function') {
    return { gl: null, reason: 'maplibre-gl loaded but the Map constructor is missing' };
  }
  try {
    // Before any Map is created: MapLibre spawns its workers on the first one.
    (candidate as WebMapModule).setWorkerUrl(MAPLIBRE_WORKER_URL);
  } catch (error) {
    return {
      gl: null,
      reason: `could not configure the map worker: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { gl: candidate as WebMapModule, reason: '' };
}
