import { Atkinson_Hyperlegible_Next, Big_Shoulders, Big_Shoulders_Stencil } from 'next/font/google';
import localFont from 'next/font/local';

/** Condensed signage face for display type. Self-hosted by next/font, so no third-party request. */
export const bigShoulders = Big_Shoulders({
  // Not preloaded: a preload competes with the CSS and body font for the first bytes and pushes
  // LCP (the hero's body-text lead) past the 2.5s gate. The browser still fetches it as soon as
  // the first layout needs it, and headlines swap in when it lands.
  preload: false,
  // Only latin is preloaded; latin-ext (which has ₹) still loads on demand through unicode-range.
  subsets: ['latin'],
  weight: ['800', '900'],
  variable: '--font-big-shoulders',
  display: 'swap',
  // Next has no fallback metrics for these families, so it cannot size a fallback to match.
  adjustFontFallback: false,
});

/** The stencil cut, for painted bay numbers only. */
export const bigShouldersStencil = Big_Shoulders_Stencil({
  subsets: ['latin'],
  weight: ['800'],
  variable: '--font-stencil-face',
  display: 'swap',
  // Next has no fallback metrics for these families, so it cannot size a fallback to match.
  adjustFontFallback: false,
  preload: false,
});

/** Body text. Designed for legibility, and it covers the rupee sign. */
export const atkinson = Atkinson_Hyperlegible_Next({
  // Only latin is preloaded; latin-ext (which has ₹) still loads on demand through unicode-range.
  subsets: ['latin'],
  weight: ['400', '700', '800'],
  variable: '--font-atkinson',
  display: 'swap',
  // Next has no fallback metrics for these families, so it cannot size a fallback to match.
  adjustFontFallback: false,
});

/**
 * The rupee sign alone, cut from each face's latin-ext subset (OFL 1.1, as served by Google
 * Fonts) with `pyftsubset --unicodes=U+20B9`, variable weight axis kept. Each is first in its
 * stack and covers only U+20B9, so a page with ₹ in view no longer fetches two latin-ext files
 * (~49 kB) before its first paint just to draw one glyph — on /pricing that pushed LCP past the
 * 2.5 s gate. Not preloaded: a page without ₹ in view never fetches them, and one with it
 * fetches about 1 kB. (Font loader options must be literals, hence the repeat.)
 */
export const rupeeSans = localFont({
  src: '../assets/fonts/rupee-atkinson.woff2',
  weight: '200 800',
  variable: '--font-rupee-sans',
  preload: false,
  declarations: [{ prop: 'unicode-range', value: 'U+20B9' }],
  adjustFontFallback: false,
});

export const rupeeDisplay = localFont({
  src: '../assets/fonts/rupee-big-shoulders.woff2',
  weight: '100 900',
  variable: '--font-rupee-display',
  preload: false,
  declarations: [{ prop: 'unicode-range', value: 'U+20B9' }],
  adjustFontFallback: false,
});
