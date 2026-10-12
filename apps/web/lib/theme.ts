import { webColors } from '@parkease/tokens';

/**
 * The palette as CSS custom properties, generated from @parkease/tokens at build time.
 * globals.css maps these into Tailwind, so no stylesheet in apps/web holds a colour literal.
 */
const vars: Record<string, string> = {
  porcelain: webColors.porcelain,
  paper: webColors.paper,
  mist: webColors.mist,
  ink: webColors.ink,
  slate: webColors.slate,
  rule: webColors.rule,
  field: webColors.field,
  midnight: webColors.midnight,
  'midnight-raised': webColors.midnightRaised,
  'on-midnight': webColors.onMidnight,
  'on-midnight-muted': webColors.onMidnightMuted,
  'midnight-rule': webColors.midnightRule,
  'nav-glass': webColors.navGlass,
  'button-hover': webColors.buttonOnMidnightHover,
  sky: webColors.skyOnMidnight,
  floor: webColors.floor,
  'floor-paint': webColors.floorPaint,
  'floor-stencil': webColors.floorStencil,
  'free-lit': webColors.freeLit,
  'free-lit-fill': webColors.freeLitFill,
  'free-glow': webColors.freeGlow,
  primary: webColors.primary,
  'primary-hover': webColors.primaryHover,
  'on-primary': webColors.onPrimary,
  focus: webColors.focus,
  available: webColors.available,
  'available-soft': webColors.availableSoft,
  'available-ink': webColors.availableInk,
  full: webColors.full,
  'warn-soft': webColors.warnSoft,
  'warn-ink': webColors.warnInk,
  shadow: webColors.shadow,
};

export const themeCss = `:root{${Object.entries(vars)
  .map(([name, value]) => `--pe-${name}:${value}`)
  .join(';')}}`;
