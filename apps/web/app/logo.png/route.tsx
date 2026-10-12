import { ImageResponse } from 'next/og';

import { BrandMark } from '@/lib/brand-mark';
import { loadDisplayFont } from '@/lib/og-font';

/** /logo.png, the square logo referenced by the Organization JSON-LD. Rendered once at build. */
export const dynamic = 'force-static';

export async function GET() {
  return new ImageResponse(<BrandMark size={512} font="Big Shoulders" />, {
    width: 512,
    height: 512,
    fonts: [{ name: 'Big Shoulders', data: await loadDisplayFont(), weight: 900 }],
  });
}
