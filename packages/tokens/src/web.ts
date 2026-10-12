import { colors } from './colors.js';

/**
 * Marketing site palette, direction "Midnight" (task 20).
 *
 * A basement at night rather than a car park at noon: deep navy carries the
 * hero, closing bands and footer; porcelain carries the reading. The only
 * luminous colour is the green of a free bay, so availability keeps the single
 * meaning the app gives it. Actions stay on the app's `primary`, which keeps
 * the site and the app on one brand colour.
 *
 * apps/web may not hardcode a hex value (task 20, "Tokens"), so everything the
 * site paints — including the map and the share image — lives here.
 */
export const webColors = {
  /** Page ground for reading sections. */
  porcelain: '#F3F5F8',
  paper: colors.surface,
  /** Subtle panels on porcelain or paper. */
  mist: '#E8EDF3',
  ink: '#0A1424',
  /** Secondary text on porcelain and paper. 7.2:1 on porcelain. */
  slate: '#44546A',
  rule: '#D5DCE5',
  field: '#B7C2D0',

  /** Hero, closing bands, footer. */
  midnight: '#08111E',
  midnightRaised: '#111D30',
  /** Text on midnight. */
  onMidnight: '#F3F5F8',
  /** Secondary text on midnight. 8.4:1. */
  onMidnightMuted: '#A9B8CC',
  /** Hairlines on midnight, as an rgba so they sit on any dark surface. */
  midnightRule: 'rgba(169, 184, 204, 0.2)',
  navGlass: 'rgba(8, 17, 30, 0.94)',
  buttonOnMidnightHover: '#DCEBFA',
  /** Link and focus colour on midnight. */
  skyOnMidnight: '#7DD3FC',

  /** The parking floor under the hero. */
  floor: '#0D1828',
  floorPaint: 'rgba(226, 232, 240, 0.8)',
  floorStencil: '#4A5D78',
  /** Parked cars are quiet silhouettes so the lit bay is the only bright thing. */
  carShades: ['#1B2637', '#243045', '#1E2A3C', '#2A374B', '#212D40', '#283449', '#1C283A'],
  carLeaving: '#33425A',
  tailLight: '#F43F5E',
  tailLightCore: '#FECDD3',

  /** A bay that is free right now, lit on the dark floor. */
  freeLit: '#34D399',
  freeLitFill: 'rgba(16, 185, 129, 0.16)',
  freeGlow: 'rgba(16, 185, 129, 0.5)',

  primary: colors.primary,
  primaryHover: colors.primaryDark,
  onPrimary: colors.textInverse,
  /** Focus ring; 4:1 on both porcelain and midnight. */
  focus: colors.primaryVivid,
  available: colors.available,
  availableSoft: colors.availableSoft,
  availableInk: colors.availableInk,
  full: colors.muted,
  warnSoft: colors.surgeSoft,
  warnInk: colors.surge,
  shadow: 'rgba(8, 17, 30, 0.45)',

  /** Map styles, drawn from OpenStreetMap geometry. Parks stay grey: green means free. */
  mapLight: {
    land: '#EDF0F4',
    park: '#E1E6EC',
    casing: '#D3DAE3',
    road: '#FFFFFF',
    label: '#5D6B80',
  },
  mapDark: {
    land: '#0E1A2B',
    park: '#122238',
    casing: '#0B1524',
    minor: '#1B2B42',
    tertiary: '#22385A',
    primary: '#2C4672',
    label: '#8C9DB5',
  },
  markerRing: 'rgba(56, 189, 248, 0.28)',
  markerPin: '#0A1424',
} as const;

export type WebColors = typeof webColors;
