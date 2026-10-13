import { ImageResponse } from 'next/og';

import { BrandMark } from '@/lib/brand-mark';
import { loadDisplayFont } from '@/lib/og-font';

/* Reads the font from disk, so Node runtime only; the edge share image imports BrandMark alone. */
/** The mark as a square PNG response: favicon, Apple touch icon and /logo.png. */
export async function brandMarkImage(size: number): Promise<ImageResponse> {
  return new ImageResponse(<BrandMark size={size} font="Big Shoulders" />, {
    width: size,
    height: size,
    fonts: [{ name: 'Big Shoulders', data: await loadDisplayFont(), weight: 900 }],
  });
}
