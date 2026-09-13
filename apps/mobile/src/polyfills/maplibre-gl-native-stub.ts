/**
 * Native stub for `maplibre-gl` (the web GL JS library). ParkMap only requires it
 * when Platform.OS === 'web', but Metro bundles every require() regardless of the
 * runtime branch, so without this the whole web map library ships in the native
 * bundle. Native uses @maplibre/maplibre-react-native instead.
 */
export const Map = undefined;
export const Marker = undefined;
