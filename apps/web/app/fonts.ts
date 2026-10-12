import { Atkinson_Hyperlegible_Next, Big_Shoulders, Big_Shoulders_Stencil } from 'next/font/google';

/** Condensed signage face for display type. Self-hosted by next/font, so no third-party request. */
export const bigShoulders = Big_Shoulders({
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
