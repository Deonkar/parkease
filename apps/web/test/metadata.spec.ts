import { describe, expect, it } from 'vitest';

import { BLOG_POSTS } from '@/lib/blog';
import { cityDescription, cityTitle, LAUNCHED_CITIES } from '@/lib/cities';
import { fullTitle, PAGES } from '@/lib/pages';
import { OG_IMAGE, pageMetadata } from '@/lib/seo';

/** Every indexable page's tab title and description, as the browser sees them. */
const entries = [
  ...Object.values(PAGES).map((p) => ({
    path: p.path,
    title: fullTitle(p),
    description: p.description,
  })),
  ...LAUNCHED_CITIES.map((c) => ({
    path: `/${c.slug}`,
    title: `${cityTitle(c)} — ParkEase`,
    description: cityDescription(c),
  })),
  ...BLOG_POSTS.map((p) => ({
    path: `/blog/${p.slug}`,
    title: `${p.title} — ParkEase`,
    description: p.description,
  })),
];

describe('page metadata', () => {
  it('gives every page a unique title', () => {
    const titles = entries.map((e) => e.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('gives every page a unique description', () => {
    const descriptions = entries.map((e) => e.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it.each(entries)('$path has a 100–160 character description', ({ description }) => {
    expect(description.length).toBeGreaterThanOrEqual(100);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it.each(entries)('$path uses no superlatives', ({ title, description }) => {
    expect(`${title} ${description}`).not.toMatch(
      /\b(best|cheapest|fastest|#1|number one|leading|ultimate)\b/i,
    );
  });

  it('covers the task 20 page set', () => {
    const paths = entries.map((e) => e.path);
    for (const path of [
      '/',
      '/how-it-works',
      '/earn',
      '/find-parking',
      '/valet',
      '/car-wash',
      '/pricing',
      '/faq',
      '/about',
      '/contact',
      '/blog',
      '/legal/privacy',
      '/legal/terms',
      '/legal/refunds',
      '/legal/guidelines',
      '/bangalore',
      '/delhi',
      '/mumbai',
    ]) {
      expect(paths).toContain(path);
    }
  });
});

describe('pageMetadata', () => {
  it.each(Object.values(PAGES))('$path keeps the share image when it sets openGraph', (page) => {
    const metadata = pageMetadata(page);
    expect(metadata.openGraph?.images).toEqual([OG_IMAGE]);
    expect(metadata.alternates?.canonical).toBe(page.path);
  });
});
