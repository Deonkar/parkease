import type { Metadata } from 'next';

import { fullTitle, type PageMeta } from '@/lib/pages';
import { SITE_NAME } from '@/lib/site';

/**
 * The share image from app/opengraph-image.tsx. A page that sets `openGraph` replaces the parent's
 * whole object, file-based image included, so every page names it explicitly.
 */
export const OG_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: 'ParkEase. Stop circling the block.',
  type: 'image/png',
} as const;

/**
 * Per-page metadata: title, description, canonical and Open Graph.
 */
export function pageMetadata(page: PageMeta): Metadata {
  return {
    title: page.absolute ? { absolute: page.title } : page.title,
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: {
      type: 'website',
      locale: 'en_IN',
      siteName: SITE_NAME,
      url: page.path,
      title: fullTitle(page),
      description: page.description,
      images: [OG_IMAGE],
    },
  };
}
