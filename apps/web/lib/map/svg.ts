import { webColors } from '@parkease/tokens';

import {
  MAP_DESTINATION,
  MAP_LABELS,
  MAP_PINS,
  MAP_VIEWBOX,
  MINOR_ROADS,
  PARKS,
  PRIMARY_ROADS,
  TERTIARY_ROADS,
  type PinKind,
} from '@/lib/map/indiranagar';

export interface StreetMapOptions {
  readonly theme: 'light' | 'dark';
  /** Keeps markers legible whatever size the map is drawn at. */
  readonly pinScale?: number;
  /** Drops the pins in one after another (inline use only; needs the site stylesheet). */
  readonly animatePins?: boolean;
  /**
   * Inline maps use the page's font; a standalone file cannot reach it. Set through `style`,
   * because an SVG presentation attribute does not resolve `var()`.
   */
  readonly fontFamily?: string;
}

const PIN_FILL: Record<PinKind, string> = {
  selected: webColors.primary,
  free: webColors.available,
  full: webColors.full,
};

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function palette(theme: StreetMapOptions['theme']) {
  if (theme === 'light') {
    const l = webColors.mapLight;
    return { ...l, minor: l.road, tertiary: l.road, primary: l.road };
  }
  return webColors.mapDark;
}

/**
 * Indiranagar's real streets from OpenStreetMap, with illustrative listing markers, as SVG
 * markup. One builder serves both the inline hero map and the static file the home page loads
 * lazily, so the two cannot drift. © OpenStreetMap contributors: show MAP_ATTRIBUTION with it.
 */
export function streetMapSvg({
  theme,
  pinScale = 1,
  animatePins = false,
  fontFamily = 'var(--font-atkinson), system-ui, sans-serif',
}: StreetMapOptions): string {
  const s = palette(theme);
  const font = escape(fontFamily).replace(/"/g, '&quot;');
  // Each road layer is defined once and drawn twice (casing, then fill) with <use>, so the
  // geometry, most of the file, is not written out twice.
  const roadId = (layer: string) => `${theme}-${layer}-roads`;
  const road = (layer: string, stroke: string, width: number) =>
    `<use href="#${roadId(layer)}" stroke="${stroke}" stroke-width="${String(width)}"/>`;

  const labels = MAP_LABELS.map(
    (l) =>
      `<text x="${String(l.x)}" y="${String(l.y)}" dy="5" transform="rotate(${String(l.angle)} ${String(l.x)} ${String(l.y)})" text-anchor="middle" style="font-family:${font}" font-size="15" font-weight="700" fill="${s.label}" stroke="${s.land}" stroke-width="4" paint-order="stroke">${escape(l.text)}</text>`,
  ).join('');

  const pins = MAP_PINS.map((pin, i) => {
    const selected = pin.kind === 'selected';
    const h = selected ? 38 : 30;
    const w = 22 + 9.5 * pin.label.length;
    const fontSize = selected ? 17 : 14;
    const ring = selected
      ? `<rect x="${String(-w / 2 - 6)}" y="${String(-h / 2 - 6)}" width="${String(w + 12)}" height="${String(h + 12)}" rx="${String((h + 12) / 2)}" fill="${webColors.markerRing}"/>`
      : '';
    const drop = animatePins
      ? ` class="map-pin" style="animation-delay:${String(300 + i * 50)}ms"`
      : '';
    return (
      `<g transform="translate(${String(pin.x)} ${String(pin.y)})"><g${drop}>` +
      `<g transform="scale(${String(pinScale)})" filter="url(#pin-shadow-${theme})">${ring}` +
      `<rect x="${String(-w / 2)}" y="${String(-h / 2)}" width="${String(w)}" height="${String(h)}" rx="${String(h / 2)}" fill="${PIN_FILL[pin.kind]}"/>` +
      `<text y="${String(fontSize * 0.36)}" text-anchor="middle" style="font-family:${font}" font-size="${String(fontSize)}" font-weight="800" fill="${webColors.paper}">${escape(pin.label)}</text>` +
      `</g></g></g>`
    );
  }).join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MAP_VIEWBOX}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style="display:block;width:100%;height:100%">` +
    `<defs><filter id="pin-shadow-${theme}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="${webColors.pinShadow}"/></filter>` +
    `<path id="${roadId('minor')}" d="${MINOR_ROADS}"/>` +
    `<path id="${roadId('tertiary')}" d="${TERTIARY_ROADS}"/>` +
    `<path id="${roadId('primary')}" d="${PRIMARY_ROADS}"/></defs>` +
    `<rect x="-200" y="-200" width="1600" height="1400" fill="${s.land}"/>` +
    `<path d="${PARKS}" fill="${s.park}"/>` +
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    road('minor', s.casing, 9) +
    road('tertiary', s.casing, 15) +
    road('primary', s.casing, 22) +
    road('minor', s.minor, 6) +
    road('tertiary', s.tertiary, 11) +
    road('primary', s.primary, 17) +
    `</g>` +
    labels +
    pins +
    `<g transform="translate(${String(MAP_DESTINATION.x)} ${String(MAP_DESTINATION.y)}) scale(${String(pinScale)})">` +
    `<circle r="16" fill="${webColors.markerPin}" opacity="0.18"/><circle r="9" fill="${webColors.markerPin}"/><circle r="4" fill="${webColors.paper}"/></g>` +
    `</svg>`
  );
}

export const MAP_ATTRIBUTION = 'Map data © OpenStreetMap contributors';
