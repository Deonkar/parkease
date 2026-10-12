import { webColors } from '@parkease/tokens';

/**
 * The palette as CSS custom properties, generated from @parkease/tokens at build time:
 * `webColors.midnightRaised` becomes `--pe-midnight-raised`. globals.css maps these into
 * Tailwind, so no stylesheet in apps/web holds a colour literal. Nested groups (the map styles,
 * car shades) are read by the SVG builders directly and are not exposed here.
 */
const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export const themeCss = `:root{${Object.entries(webColors)
  .flatMap(([key, value]: [string, unknown]) =>
    typeof value === 'string' ? [`--pe-${kebab(key)}:${value}`] : [],
  )
  .join(';')}}`;
