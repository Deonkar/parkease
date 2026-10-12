import { describe, expect, it } from 'vitest';

import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { BLOG_POSTS } from '@/lib/blog';
import { LAUNCHED_CITIES } from '@/lib/cities';
import { PAGES } from '@/lib/pages';

describe('sitemap.xml', () => {
  const urls = sitemap().map((entry) => entry.url);

  it('lists every page, city, legal page and post exactly once', () => {
    const expected = [
      ...Object.values(PAGES).map((p) => `https://parkease.in${p.path === '/' ? '' : p.path}`),
      ...LAUNCHED_CITIES.map((c) => `https://parkease.in/${c.slug}`),
      ...BLOG_POSTS.map((p) => `https://parkease.in/blog/${p.slug}`),
    ];
    expect([...urls].sort()).toEqual([...expected].sort());
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('includes the legal pages', () => {
    for (const doc of ['privacy', 'terms', 'refunds', 'guidelines']) {
      expect(urls).toContain(`https://parkease.in/legal/${doc}`);
    }
  });

  it('has 20+ URLs', () => {
    expect(urls.length).toBeGreaterThanOrEqual(20);
  });
});

describe('robots.txt', () => {
  const result = robots();

  it('allows / and disallows /api/ and /admin/', () => {
    expect(result.rules).toEqual([{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin/'] }]);
  });

  it('references the sitemap', () => {
    expect(result.sitemap).toBe('https://parkease.in/sitemap.xml');
  });
});
