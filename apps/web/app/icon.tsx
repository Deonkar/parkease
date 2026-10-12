import { ImageResponse } from 'next/og';

import { BrandMark } from '@/lib/brand-mark';
import { loadDisplayFont } from '@/lib/og-font';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default async function Icon() {
  return new ImageResponse(<BrandMark size={32} font="Big Shoulders" />, {
    ...size,
    fonts: [{ name: 'Big Shoulders', data: await loadDisplayFont(), weight: 900 }],
  });
}
