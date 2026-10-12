import type { MetadataRoute } from 'next';

import { BLOG_POSTS } from '@/lib/blog';
import { LAUNCHED_CITIES } from '@/lib/cities';
import { PAGES } from '@/lib/pages';
import { SITE_URL } from '@/lib/site';

/** Every indexable URL: the page registry, the city pages and the blog posts (task 20 §20.9). */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticPages = Object.values(PAGES).map((page) => ({
    url: `${SITE_URL}${page.path === '/' ? '' : page.path}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: page.path === '/' ? 1 : 0.8,
  }));

  const cityPages = LAUNCHED_CITIES.map((city) => ({
    url: `${SITE_URL}/${city.slug}`,
    lastModified: now,
    changeFrequency: 'daily' as const,
    priority: 0.9,
  }));

  const posts = BLOG_POSTS.map((post) => ({
    url: `${SITE_URL}/blog/${post.slug}`,
    lastModified: new Date(`${post.published}T00:00:00+05:30`),
    changeFrequency: 'monthly' as const,
    priority: 0.6,
  }));

  return [...staticPages, ...cityPages, ...posts];
}
