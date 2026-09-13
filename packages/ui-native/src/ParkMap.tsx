import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';

export interface MapLocation {
  lat: number;
  lng: number;
}

interface ParkMapProps {
  location: MapLocation;
  onLocationChange?: (location: MapLocation) => void;
  interactive?: boolean;
  style?: ViewStyle;
}

const isWeb = Platform.OS === 'web';

type LngLat = [number, number];

/** Minimal surface of maplibre-gl (web) that this component uses. */
interface WebMapInstance {
  on(event: 'click', handler: (e: { lngLat: { lng: number; lat: number } }) => void): void;
  flyTo(options: { center: LngLat; zoom: number }): void;
  getZoom(): number;
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
interface MinimalDocument {
  getElementById(id: string): unknown;
  createElement(tag: string): { id: string; textContent: string; style: Record<string, string> };
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

function WebMap({ location, onLocationChange, interactive = true, style }: ParkMapProps) {
  const containerRef = useRef<View>(null);
  const mapRef = useRef<WebMapInstance | null>(null);
  const markerRef = useRef<WebMarkerInstance | null>(null);

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
      zoom: 15,
      interactive,
      attributionControl: true,
    });

    const markerEl = doc.createElement('div');
    Object.assign(markerEl.style, {
      width: '24px',
      height: '24px',
      borderRadius: '50%',
      backgroundColor: '#4F46E5',
      border: '3px solid #FFFFFF',
      boxShadow: '0 2px 4px rgba(0,0,0,0.25)',
      cursor: interactive ? 'pointer' : 'default',
    });

    const marker = new gl.Marker({ element: markerEl, draggable: interactive })
      .setLngLat([location.lng, location.lat])
      .addTo(map);

    if (interactive && onLocationChange) {
      map.on('click', (e) => {
        marker.setLngLat([e.lngLat.lng, e.lngLat.lat]);
        onLocationChange({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });

      marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        onLocationChange({ lat: lngLat.lat, lng: lngLat.lng });
      });
    }

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      marker.remove();
      map.remove();
    };
    // Init once — location changes are handled by the recenter effect below.
  }, []);

  // Recenter when the location prop changes (e.g. a place was picked from search).
  // Skipped when the marker is already there, so dragging doesn't fight this effect.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    const current = marker.getLngLat();
    const alreadyThere =
      Math.abs(current.lat - location.lat) < 1e-6 && Math.abs(current.lng - location.lng) < 1e-6;
    if (alreadyThere) return;
    marker.setLngLat([location.lng, location.lat]);
    map.flyTo({ center: [location.lng, location.lat], zoom: Math.max(map.getZoom(), 15) });
  }, [location.lat, location.lng]);

  return <View ref={containerRef} style={[styles.container, style]} />;
}

export function ParkMap(props: ParkMapProps) {
  const { location, onLocationChange, interactive = true, style } = props;
  const coord: [number, number] = [location.lng, location.lat];

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
      if (!interactive || !onLocationChange) return;
      const event = e as { nativeEvent: { lngLat: [number, number] } };
      const [lng, lat] = event.nativeEvent.lngLat;
      onLocationChange({ lat, lng });
    };

    return (
      <View style={[styles.container, style]}>
        <NativeMap
          style={styles.map}
          mapStyle={OSM_STYLE}
          attribution
          logo={false}
          onPress={handlePress}
        >
          <NativeCamera center={coord} zoom={15} duration={800} />
          <NativeMarker id="location-pin" lngLat={coord}>
            <View style={styles.marker} />
          </NativeMarker>
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
    borderRadius: 12,
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
  fallback: {
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
  },
  fallbackHint: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  marker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#4F46E5',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
