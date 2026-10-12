import { ImageResponse } from 'next/og';

import { BrandMark } from '@/lib/brand-mark';
import { loadDisplayFont } from '@/lib/og-font';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default async function Icon() {
  return new ImageResponse(<BrandMark size={180} font="Big Shoulders" />, {
    ...size,
    fonts: [{ name: 'Big Shoulders', data: await loadDisplayFont(), weight: 900 }],
  });
}
