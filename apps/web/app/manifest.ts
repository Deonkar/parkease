import { webColors } from '@parkease/tokens';
import type { MetadataRoute } from 'next';

import { PAGES } from '@/lib/pages';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ParkEase',
    short_name: 'ParkEase',
    description: PAGES.home.description,
    start_url: '/',
    display: 'browser',
    background_color: webColors.porcelain,
    theme_color: webColors.midnight,
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
