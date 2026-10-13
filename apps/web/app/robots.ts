import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/site';

/** The marketing site is fully indexable; the admin panel lives on its own subdomain. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
