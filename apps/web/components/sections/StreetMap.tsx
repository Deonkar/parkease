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

const PIN_FILL: Record<PinKind, string> = {
  selected: webColors.primary,
  free: webColors.available,
  full: webColors.full,
};

/**
 * Indiranagar's real streets from OpenStreetMap, with illustrative listing markers.
 * `pinScale` keeps markers legible whatever size the map is drawn at.
 */
export function StreetMap({
  theme,
  pinScale = 1,
  animatePins = false,
}: {
  readonly theme: 'light' | 'dark';
  readonly pinScale?: number;
  readonly animatePins?: boolean;
}) {
  const light = webColors.mapLight;
  const dark = webColors.mapDark;
  const s =
    theme === 'light'
      ? {
          land: light.land,
          park: light.park,
          casing: light.casing,
          minor: light.road,
          tertiary: light.road,
          primary: light.road,
          label: light.label,
        }
      : {
          land: dark.land,
          park: dark.park,
          casing: dark.casing,
          minor: dark.minor,
          tertiary: dark.tertiary,
          primary: dark.primary,
          label: dark.label,
        };
  const road = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

  return (
    <svg
      aria-hidden="true"
      className="block size-full"
      viewBox={MAP_VIEWBOX}
      preserveAspectRatio="xMidYMid slice"
    >
      <rect x="-200" y="-200" width="1600" height="1400" fill={s.land} />
      <path d={PARKS} fill={s.park} />
      <path d={MINOR_ROADS} stroke={s.casing} strokeWidth="9" {...road} />
      <path d={TERTIARY_ROADS} stroke={s.casing} strokeWidth="15" {...road} />
      <path d={PRIMARY_ROADS} stroke={s.casing} strokeWidth="22" {...road} />
      <path d={MINOR_ROADS} stroke={s.minor} strokeWidth="6" {...road} />
      <path d={TERTIARY_ROADS} stroke={s.tertiary} strokeWidth="11" {...road} />
      <path d={PRIMARY_ROADS} stroke={s.primary} strokeWidth="17" {...road} />
      {MAP_LABELS.map((l) => (
        <text
          key={l.text}
          x={l.x}
          y={l.y}
          dy="5"
          transform={`rotate(${String(l.angle)} ${String(l.x)} ${String(l.y)})`}
          textAnchor="middle"
          fontFamily="var(--font-atkinson), sans-serif"
          fontSize="15"
          fontWeight="700"
          fill={s.label}
          stroke={s.land}
          strokeWidth="4"
          paintOrder="stroke"
        >
          {l.text}
        </text>
      ))}
      {MAP_PINS.map((pin, i) => {
        const selected = pin.kind === 'selected';
        const h = selected ? 38 : 30;
        const w = 22 + 9.5 * pin.label.length;
        const fontSize = selected ? 17 : 14;
        return (
          <g
            key={`${pin.label}-${String(i)}`}
            transform={`translate(${String(pin.x)} ${String(pin.y)})`}
          >
            <g
              className={animatePins ? 'map-pin' : undefined}
              style={animatePins ? { animationDelay: `${String(300 + i * 50)}ms` } : undefined}
            >
              <g
                transform={`scale(${String(pinScale)})`}
                className="drop-shadow-[0_3px_6px_rgba(8,17,30,0.35)]"
              >
                {selected && (
                  <rect
                    x={-w / 2 - 6}
                    y={-h / 2 - 6}
                    width={w + 12}
                    height={h + 12}
                    rx={(h + 12) / 2}
                    fill={webColors.markerRing}
                  />
                )}
                <rect
                  x={-w / 2}
                  y={-h / 2}
                  width={w}
                  height={h}
                  rx={h / 2}
                  fill={PIN_FILL[pin.kind]}
                />
                <text
                  y={fontSize * 0.36}
                  textAnchor="middle"
                  fontFamily="var(--font-atkinson), sans-serif"
                  fontSize={fontSize}
                  fontWeight="800"
                  fill={webColors.paper}
                >
                  {pin.label}
                </text>
              </g>
            </g>
          </g>
        );
      })}
      <g
        transform={`translate(${String(MAP_DESTINATION.x)} ${String(MAP_DESTINATION.y)}) scale(${String(pinScale)})`}
      >
        <circle r="16" fill={webColors.markerPin} opacity="0.18" />
        <circle r="9" fill={webColors.markerPin} />
        <circle r="4" fill={webColors.paper} />
      </g>
    </svg>
  );
}

export const MAP_ATTRIBUTION = 'Map data © OpenStreetMap contributors';
