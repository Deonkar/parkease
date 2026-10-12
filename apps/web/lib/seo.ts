import type { Metadata } from 'next';

import { fullTitle, type PageMeta } from '@/lib/pages';
import { SITE_NAME } from '@/lib/site';

/**
 * Per-page metadata: title, description, canonical and Open Graph. The share image comes from
 * app/opengraph-image.tsx, which Next applies to every route below it.
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
    },
  };
}
