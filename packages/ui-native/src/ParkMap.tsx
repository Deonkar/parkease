import { colors, duration, elevation, radius, stagger } from '@parkease/tokens';
import { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

export interface MapLocation {
  lat: number;
  lng: number;
}

/** [west, south, east, north] — the order both MapLibre and supercluster use. */
export interface MapBoundsBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface MapViewportState {
  center: MapLocation;
  zoom: number;
  bounds: MapBoundsBox;
}

/**
 * Marker tones. Colour is never the only signal — every marker also carries a
 * `label`, which is what the driver actually reads (R-FE-12).
 */
export type ParkMapMarkerTone = 'car' | 'twoWheeler' | 'closed' | 'cluster';

export interface ParkMapMarker {
  id: string;
  location: MapLocation;
  /** Price for a space, count for a cluster. Always rendered. */
  label: string;
  tone: ParkMapMarkerTone;
  accessibilityLabel: string;
  selected?: boolean;
}

interface ParkMapProps {
  /** Single-pin mode: the pin. Discovery mode: the camera centre. */
  location: MapLocation;
  onLocationChange?: (location: MapLocation) => void;
  interactive?: boolean;
  style?: ViewStyle;
  /**
   * Providing `markers` switches the map into discovery mode: many labelled
   * markers and no draggable pin. Omitting it keeps the original single
   * draggable pin used by the owner listing flow.
   */
  markers?: readonly ParkMapMarker[];
  onMarkerPress?: (id: string) => void;
  /** Fired after a pan or zoom settles. Drives "Search this area". */
  onViewportChange?: (viewport: MapViewportState) => void;
  zoom?: number;
  /**
   * Bump to re-issue the camera move even when `location`/`zoom` are unchanged.
   *
   * Recentring after the driver has panned, and expanding a cluster that is
   * already centred, are both "go here again" commands. Diffing the target
   * alone silently drops them, so the caller ticks this instead.
   */
  cameraNonce?: number;
  /** Shows a "you are here" dot at `location` in discovery mode. */
  showOriginDot?: boolean;
  onMapPress?: () => void;
}

const isWeb = Platform.OS === 'web';

const DEFAULT_ZOOM = 15;

/**
 * Marker fills.
 *
 * Every marker carries a white price label, so the fill has to clear WCAG AA
 * for small text. The vivid tones do not: white on `primaryVivid` measures
 * 4.10:1 and on `availableVivid` 3.77:1, both under 4.5:1. The base tones do
 * (5.93:1, 5.48:1, 4.76:1), which is what `colors.ts` means by "the base tones
 * carry anything with text on it".
 */
const TONE_COLORS: Record<ParkMapMarkerTone, string> = {
  car: colors.primary,
  /** Two-wheeler-only: availability green, the one thing green means here. */
  twoWheeler: colors.available,
  /** Closed or nothing free. Muted, never red — unavailable is not an error. */
  closed: colors.muted,
  cluster: colors.primaryDark,
};

type LngLat = [number, number];

/** Minimal surface of maplibre-gl (web) that this component uses. */
interface WebMapInstance {
  on(event: 'click', handler: (e: { lngLat: { lng: number; lat: number } }) => void): void;
  on(event: 'moveend', handler: () => void): void;
  flyTo(options: { center: LngLat; zoom: number; duration?: number }): void;
  getZoom(): number;
  getCenter(): { lng: number; lat: number };
  getBounds(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number };
  remove(): void;
}

interface WebMarkerInstance {
  setLngLat(coord: LngLat): WebMarkerInstance;
  addTo(map: WebMapInstance): WebMarkerInstance;
  getLngLat(): { lng: number; lat: number };
  on(event: 'dragend', handler: () => void): void;
  remove(): void;
}

interface MaplibreGl {
  Map: new (options: Record<string, unknown>) => WebMapInstance;
  Marker: new (options: { element: unknown; draggable: boolean }) => WebMarkerInstance;
}

// Why the map could not load, surfaced in the fallback UI rather than swallowed (R-FAIL-01).
let mapUnavailableReason = '';

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- Native: conditional MapLibre React Native ---
type NativeComponent = React.ComponentType<Record<string, unknown>>;
type MaybeNativeExports = Partial<Record<'Map' | 'Camera' | 'Marker', NativeComponent>>;

let MLMap: NativeComponent | null = null;
let MLCamera: NativeComponent | null = null;
let MLMarker: NativeComponent | null = null;
let nativeMapAvailable = false;

if (!isWeb) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- conditional native module
    const ml = require('@maplibre/maplibre-react-native') as MaybeNativeExports;
    MLMap = ml.Map ?? null;
    MLCamera = ml.Camera ?? null;
    MLMarker = ml.Marker ?? null;
    nativeMapAvailable = MLMap !== null && MLCamera !== null && MLMarker !== null;
    if (!nativeMapAvailable) {
      mapUnavailableReason = 'MapLibre loaded but Map/Camera/Marker are missing';
    }
  } catch (error) {
    mapUnavailableReason = describe(error);
  }
}

// --- Web: MapLibre GL JS ---
type MaybeWebExports = Partial<MaplibreGl> & { default?: MaplibreGl };

let maplibregl: MaplibreGl | null = null;
let webMapAvailable = false;

if (isWeb) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- conditional web module
    const mod = require('maplibre-gl') as MaybeWebExports;
    // maplibre-gl ships a dual ESM/CJS build; the CJS path nests it under `default`.
    maplibregl = typeof mod.Map === 'function' ? (mod as MaplibreGl) : (mod.default ?? null);
    webMapAvailable = typeof maplibregl?.Map === 'function';
    if (webMapAvailable) {
      injectMaplibreCss();
    } else {
      mapUnavailableReason = 'maplibre-gl loaded but the Map constructor is missing';
    }
  } catch (error) {
    mapUnavailableReason = describe(error);
  }
}

/** Minimal DOM surface used on web; `document` has no type here (React Native lib). */
interface MinimalElement {
  id: string;
  textContent: string;
  style: Record<string, string>;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, handler: (event: { stopPropagation(): void }) => void): void;
  /** A marker is a transparent hit area wrapping the visible price pill. */
  appendChild(child: MinimalElement): void;
}

interface MinimalDocument {
  getElementById(id: string): unknown;
  createElement(tag: string): MinimalElement;
  head: { appendChild(node: unknown): void };
}

function getDocument(): MinimalDocument | undefined {
  return (globalThis as { document?: MinimalDocument }).document;
}

function injectMaplibreCss() {
  const doc = getDocument();
  if (!doc) return;
  if (doc.getElementById('maplibre-gl-css')) return;
  const style = doc.createElement('style');
  style.id = 'maplibre-gl-css';
  style.textContent = [
    '.maplibregl-map{font:12px/20px Helvetica,Arial,sans-serif;overflow:hidden;position:relative;-webkit-tap-highlight-color:rgba(0,0,0,0)}',
    '.maplibregl-canvas{position:absolute;left:0;top:0}',
    '.maplibregl-canvas-container{overflow:hidden;position:relative}',
    '.maplibregl-ctrl-bottom-left,.maplibregl-ctrl-bottom-right,.maplibregl-ctrl-top-left,.maplibregl-ctrl-top-right{position:absolute;pointer-events:none;z-index:2}',
    '.maplibregl-ctrl-top-left{top:0;left:0}.maplibregl-ctrl-top-right{top:0;right:0}',
    '.maplibregl-ctrl-bottom-left{bottom:0;left:0}.maplibregl-ctrl-bottom-right{bottom:0;right:0}',
    '.maplibregl-ctrl{pointer-events:auto}',
    '.maplibregl-ctrl-attrib{background-color:hsla(0,0%,100%,.5);font-size:10px;padding:0 5px}',
    '.maplibregl-marker{position:absolute;top:0;left:0;will-change:transform;opacity:1;transition:opacity .2s}',
    // Marker entrance: compositor-only (transform + opacity), staggered by the
    // per-marker animation-delay set below.
    `@keyframes parkease-marker-in{from{opacity:0;transform:scale(0.6) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}`,
    `.parkease-marker{animation:parkease-marker-in ${String(duration.base)}ms cubic-bezier(0.05,0.7,0.1,1) both}`,
    `.parkease-marker{transition:transform ${String(duration.fast)}ms cubic-bezier(0.2,0,0,1)}`,
    // Reduced motion: state changes instantly, nothing moves.
    '@media (prefers-reduced-motion: reduce){.parkease-marker{animation:none!important;transition:none!important}}',
  ].join('\n');
  doc.head.appendChild(style);
}

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }],
};

/** Identity of the rendered marker set, so we only rebuild when something changed. */
function markerSignature(markers: readonly ParkMapMarker[]): string {
  return markers
    .map((m) => `${m.id}:${m.tone}:${m.label}:${m.selected === true ? '1' : '0'}`)
    .join('|');
}

/**
 * Markers get a transparent 48x48 hit area around the visible pill.
 *
 * The pill itself is 30px tall; at 48 it would swallow the map. Material's
 * minimum applies to the *touch target*, not the ink, so the target is grown
 * instead of the graphic.
 */
const MIN_TOUCH_PX = 48;

function styleHitArea(element: MinimalElement, index: number): void {
  Object.assign(element.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: `${String(MIN_TOUCH_PX)}px`,
    height: `${String(MIN_TOUCH_PX)}px`,
    background: 'none',
    cursor: 'pointer',
    // Capped so the last marker in a dense view does not lag seconds behind.
    animationDelay: `${String(Math.min(index * stagger.step, stagger.max))}ms`,
  });
  element.setAttribute('class', 'parkease-marker');
}

function styleMarkerElement(element: MinimalElement, marker: ParkMapMarker): void {
  const selected = marker.selected === true;
  const isCluster = marker.tone === 'cluster';
  Object.assign(element.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: isCluster ? '36px' : '46px',
    height: isCluster ? '36px' : '30px',
    padding: isCluster ? '0' : `0 ${String(8)}px`,
    borderRadius: isCluster ? `${String(radius.full)}px` : `${String(radius.md)}px`,
    backgroundColor: TONE_COLORS[marker.tone],
    color: colors.textInverse,
    fontSize: '12px',
    fontWeight: '700',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    border: `2px solid ${selected ? colors.text : colors.surface}`,
    boxShadow: selected
      ? `0 4px 12px rgba(15,23,42,0.28)`
      : `0 2px 6px rgba(15,23,42,${String(elevation.raised.shadowOpacity)})`,
    cursor: 'pointer',
    transform: selected ? 'scale(1.14)' : 'scale(1)',
    boxSizing: 'border-box',
    pointerEvents: 'none',
  });
  element.textContent = marker.label;
}

function WebMap(props: ParkMapProps) {
  const { location, interactive = true, style, markers, zoom, showOriginDot, cameraNonce } = props;

  const containerRef = useRef<View>(null);
  const mapRef = useRef<WebMapInstance | null>(null);
  const pinRef = useRef<WebMarkerInstance | null>(null);
  const markerRefs = useRef<WebMarkerInstance[]>([]);

  // Latest callbacks, so the init effect can stay mount-once without going stale.
  const handlers = useRef(props);
  handlers.current = props;

  const discovery = markers !== undefined;

  useEffect(() => {
    const gl = maplibregl;
    const doc = getDocument();
    if (!gl || !doc || !containerRef.current) return;

    // React Native Web renders View as a real DOM div, so the ref is the node itself.
    const domNode: unknown = containerRef.current;
    if (!domNode || typeof domNode !== 'object' || !('tagName' in domNode)) return;

    const map = new gl.Map({
      container: domNode,
      style: OSM_STYLE,
      center: [location.lng, location.lat],
      zoom: zoom ?? DEFAULT_ZOOM,
      interactive,
      attributionControl: true,
    });

    mapRef.current = map;

    if (discovery) {
      map.on('click', () => {
        handlers.current.onMapPress?.();
      });
      map.on('moveend', () => {
        const onViewportChange = handlers.current.onViewportChange;
        if (!onViewportChange) return;
        const center = map.getCenter();
        const bounds = map.getBounds();
        onViewportChange({
          center: { lat: center.lat, lng: center.lng },
          zoom: map.getZoom(),
          bounds: {
            west: bounds.getWest(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            north: bounds.getNorth(),
          },
        });
      });
      return () => {
        map.remove();
        mapRef.current = null;
      };
    }

    // --- Single-pin mode (owner listing): unchanged behaviour ---
    const markerEl = doc.createElement('div');
    Object.assign(markerEl.style, {
      width: '24px',
      height: '24px',
      borderRadius: `${String(radius.full)}px`,
      backgroundColor: colors.primary,
      border: `3px solid ${colors.surface}`,
      boxShadow: '0 2px 4px rgba(15,23,42,0.25)',
      cursor: interactive ? 'pointer' : 'default',
    });

    const pin = new gl.Marker({ element: markerEl, draggable: interactive })
      .setLngLat([location.lng, location.lat])
      .addTo(map);

    if (interactive) {
      map.on('click', (e) => {
        const onLocationChange = handlers.current.onLocationChange;
        if (!onLocationChange) return;
        pin.setLngLat([e.lngLat.lng, e.lngLat.lat]);
        onLocationChange({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });

      pin.on('dragend', () => {
        const onLocationChange = handlers.current.onLocationChange;
        if (!onLocationChange) return;
        const lngLat = pin.getLngLat();
        onLocationChange({ lat: lngLat.lat, lng: lngLat.lng });
      });
    }

    pinRef.current = pin;

    return () => {
      pin.remove();
      map.remove();
      mapRef.current = null;
      pinRef.current = null;
    };
    // Init once — location changes are handled by the recentre effect below.
  }, []);

  // Discovery markers: rebuilt whenever the set actually changes.
  const signature = discovery ? markerSignature(markers) : '';
  useEffect(() => {
    if (!discovery) return;
    const gl = maplibregl;
    const doc = getDocument();
    const map = mapRef.current;
    if (!gl || !doc || !map) return;

    for (const existing of markerRefs.current) existing.remove();
    markerRefs.current = [];

    markers.forEach((marker, index) => {
      const hitArea = doc.createElement('div');
      styleHitArea(hitArea, index);
      hitArea.setAttribute('role', 'button');
      hitArea.setAttribute('tabindex', '0');
      hitArea.setAttribute('aria-label', marker.accessibilityLabel);

      const pill = doc.createElement('div');
      styleMarkerElement(pill, marker);
      hitArea.appendChild(pill);

      hitArea.addEventListener('click', (event) => {
        event.stopPropagation();
        handlers.current.onMarkerPress?.(marker.id);
      });

      markerRefs.current.push(
        new gl.Marker({ element: hitArea, draggable: false })
          .setLngLat([marker.location.lng, marker.location.lat])
          .addTo(map),
      );
    });

    return () => {
      for (const existing of markerRefs.current) existing.remove();
      markerRefs.current = [];
    };
    // `signature` already captures every rendered property of the marker set;
    // depending on the array itself would rebuild every marker on every render.
  }, [signature, discovery]);

  // "You are here" dot.
  useEffect(() => {
    const gl = maplibregl;
    const doc = getDocument();
    const map = mapRef.current;
    if (!gl || !doc || !map || showOriginDot !== true) return;

    const element = doc.createElement('div');
    Object.assign(element.style, {
      width: '18px',
      height: '18px',
      borderRadius: `${String(radius.full)}px`,
      backgroundColor: colors.primaryVivid,
      border: `3px solid ${colors.surface}`,
      boxShadow: '0 0 0 6px rgba(2,132,199,0.22)',
    });
    element.setAttribute('aria-label', 'Your location');
    const dot = new gl.Marker({ element, draggable: false })
      .setLngLat([location.lng, location.lat])
      .addTo(map);

    return () => {
      dot.remove();
    };
  }, [showOriginDot, location.lat, location.lng]);

  // Recentre when the camera target changes (recentre button, or a picked place).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (discovery) {
      // No diffing here: in discovery mode the screen owns the camera and only
      // renders a new target when it actually wants the map to move. Comparing
      // against the map's current position instead threw away every "go here
      // again" command — recentring after a pan, and expanding a cluster that
      // was already under the camera.
      map.flyTo({
        center: [location.lng, location.lat],
        zoom: zoom ?? map.getZoom(),
        duration: duration.deliberate,
      });
      return;
    }

    const pin = pinRef.current;
    if (!pin) return;
    const current = pin.getLngLat();
    const alreadyThere =
      Math.abs(current.lat - location.lat) < 1e-6 && Math.abs(current.lng - location.lng) < 1e-6;
    if (alreadyThere) return;
    pin.setLngLat([location.lng, location.lat]);
    map.flyTo({
      center: [location.lng, location.lat],
      zoom: Math.max(map.getZoom(), DEFAULT_ZOOM),
      duration: duration.deliberate,
    });
  }, [location.lat, location.lng, zoom, cameraNonce, discovery]);

  return <View ref={containerRef} style={[styles.container, style]} />;
}

/** Runtime shape check on the native region event — it crosses the bridge (R-VAL-01). */
function readViewport(event: unknown): MapViewportState | null {
  if (typeof event !== 'object' || event === null) return null;
  const native = (event as { nativeEvent?: unknown }).nativeEvent;
  if (typeof native !== 'object' || native === null) return null;

  const { center, zoom, bounds } = native as {
    center?: unknown;
    zoom?: unknown;
    bounds?: unknown;
  };

  if (!Array.isArray(center) || center.length < 2) return null;
  if (typeof zoom !== 'number') return null;
  if (!Array.isArray(bounds) || bounds.length < 4) return null;

  const [lng, lat] = center as number[];
  const [west, south, east, north] = bounds as number[];
  if (lng === undefined || lat === undefined) return null;
  if (west === undefined || south === undefined || east === undefined || north === undefined) {
    return null;
  }

  return { center: { lat, lng }, zoom, bounds: { west, south, east, north } };
}

function NativeDiscoveryMarkers({
  markers,
  onMarkerPress,
  Marker,
}: {
  markers: readonly ParkMapMarker[];
  onMarkerPress: ((id: string) => void) | undefined;
  Marker: NativeComponent;
}) {
  return (
    <>
      {markers.map((marker) => (
        <Marker key={marker.id} id={marker.id} lngLat={[marker.location.lng, marker.location.lat]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={marker.accessibilityLabel}
            onPress={() => {
              onMarkerPress?.(marker.id);
            }}
            style={[
              styles.priceMarker,
              { backgroundColor: TONE_COLORS[marker.tone] },
              marker.tone === 'cluster' && styles.clusterMarker,
              marker.selected === true && styles.priceMarkerSelected,
            ]}
          >
            <Text style={styles.priceMarkerText}>{marker.label}</Text>
          </Pressable>
        </Marker>
      ))}
    </>
  );
}

export function ParkMap(props: ParkMapProps) {
  const {
    location,
    onLocationChange,
    interactive = true,
    style,
    markers,
    onMarkerPress,
    onViewportChange,
    zoom,
    showOriginDot,
    onMapPress,
  } = props;

  const coord: [number, number] = [location.lng, location.lat];
  const discovery = markers !== undefined;

  // Web with MapLibre GL JS
  if (isWeb && webMapAvailable) {
    return <WebMap {...props} />;
  }

  // Native with MapLibre React Native
  const NativeMap = MLMap;
  const NativeCamera = MLCamera;
  const NativeMarker = MLMarker;

  if (!isWeb && NativeMap && NativeCamera && NativeMarker) {
    const handlePress = (e: unknown) => {
      if (discovery) {
        onMapPress?.();
        return;
      }
      if (!interactive || !onLocationChange) return;
      const event = e as { nativeEvent: { lngLat: [number, number] } };
      const [lng, lat] = event.nativeEvent.lngLat;
      onLocationChange({ lat, lng });
    };

    const handleRegion = (e: unknown) => {
      if (!onViewportChange) return;
      const viewport = readViewport(e);
      if (viewport) onViewportChange(viewport);
    };

    return (
      <View style={[styles.container, style]}>
        <NativeMap
          style={styles.map}
          mapStyle={OSM_STYLE}
          attribution
          logo={false}
          onPress={handlePress}
          onRegionDidChange={handleRegion}
        >
          <NativeCamera center={coord} zoom={zoom ?? DEFAULT_ZOOM} duration={duration.deliberate} />

          {discovery ? (
            <>
              {showOriginDot === true ? (
                <NativeMarker id="origin-dot" lngLat={coord}>
                  <View style={styles.originDot} accessibilityLabel="Your location" />
                </NativeMarker>
              ) : null}
              <NativeDiscoveryMarkers
                markers={markers}
                onMarkerPress={onMarkerPress}
                Marker={NativeMarker}
              />
            </>
          ) : (
            <NativeMarker id="location-pin" lngLat={coord}>
              <View style={styles.marker} />
            </NativeMarker>
          )}
        </NativeMap>
      </View>
    );
  }

  // Fallback — shows why, so a missing map is never a silent blank box (R-FAIL-01).
  return (
    <View style={[styles.container, styles.fallback, style]}>
      <Text style={styles.fallbackText}>Map unavailable</Text>
      <Text style={styles.fallbackHint}>
        {mapUnavailableReason || 'Enter the address manually below'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 200,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
  fallback: {
    backgroundColor: colors.surfaceTertiary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  fallbackHint: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 4,
  },
  marker: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.surface,
    ...elevation.raised,
  },
  originDot: {
    width: 18,
    height: 18,
    borderRadius: radius.full,
    backgroundColor: colors.primaryVivid,
    borderWidth: 3,
    borderColor: colors.surface,
  },
  priceMarker: {
    minWidth: 46,
    height: 30,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.raised,
  },
  clusterMarker: {
    minWidth: 36,
    height: 36,
    borderRadius: radius.full,
    paddingHorizontal: 0,
  },
  priceMarkerSelected: {
    borderColor: colors.text,
    borderWidth: 3,
    transform: [{ scale: 1.14 }],
  },
  priceMarkerText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '700',
  },
});
