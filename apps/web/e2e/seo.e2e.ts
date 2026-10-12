import { expect, test, type APIRequestContext } from '@playwright/test';

import { fullTitle, PAGES } from '@/lib/pages';
import { SITE_URL } from '@/lib/site';

/**
 * Checks the built site against the task 20 SEO requirements: every sitemap URL answers 200 with
 * a unique title, a 100–160 character description, canonical and Open Graph tags, JSON-LD with
 * no review markup, one h1, and no broken link targets. Plus robots.txt, the share image, the
 * logo and 404s for unknown slugs. Markup does not depend on viewport, so desktop only.
 */
test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, 'server output is the same at every viewport');
});

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

function meta(html: string, attr: string, key: string): string | undefined {
  const tag = new RegExp(`<meta[^>]*${attr}="${key}"[^>]*>`, 'i').exec(html)?.[0];
  const content = tag === undefined ? undefined : /content="([^"]*)"/.exec(tag)?.[1];
  return content === undefined ? undefined : decode(content);
}

const titleOf = (html: string) => decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '');

async function sitemapUrls(request: APIRequestContext): Promise<string[]> {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  return [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? '');
}

test('sitemap lists 20+ URLs including the legal and city pages', async ({ request }) => {
  const urls = await sitemapUrls(request);
  expect(urls.length).toBeGreaterThanOrEqual(20);
  for (const path of [
    '/legal/privacy',
    '/legal/terms',
    '/legal/refunds',
    '/legal/guidelines',
    '/bangalore',
  ]) {
    expect(urls).toContain(`${SITE_URL}${path}`);
  }
});

test('robots.txt allows /, blocks /api/ and /admin/, and names the sitemap', async ({
  request,
}) => {
  const robots = (await (await request.get('/robots.txt')).text()).toLowerCase();
  for (const line of [
    'User-Agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /admin/',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
  ]) {
    expect(robots).toContain(line.toLowerCase());
  }
});

test('every sitemap page has complete, unique metadata and sound links', async ({ request }) => {
  const problems: string[] = [];
  const titles = new Map<string, string>();
  const descriptions = new Map<string, string>();

  for (const url of await sitemapUrls(request)) {
    const path = url.slice(SITE_URL.length) || '/';
    const res = await request.get(path);
    if (res.status() !== 200) {
      problems.push(`${path}: status ${String(res.status())}`);
      continue;
    }
    const html = await res.text();
    const fail = (m: string) => problems.push(`${path}: ${m}`);

    const title = titleOf(html);
    if (title === '') fail('no <title>');
    if (titles.has(title)) fail(`title also used by ${titles.get(title) ?? ''}`);
    titles.set(title, path);

    const description = meta(html, 'name', 'description') ?? '';
    if (description.length < 100 || description.length > 160) {
      fail(`description is ${String(description.length)} characters`);
    }
    if (descriptions.has(description))
      fail(`description also used by ${descriptions.get(description) ?? ''}`);
    descriptions.set(description, path);

    for (const key of ['og:title', 'og:description', 'og:image', 'og:url']) {
      if (meta(html, 'property', key) === undefined) fail(`no ${key}`);
    }
    const canonical = /<link[^>]*rel="canonical"[^>]*href="([^"]+)"/.exec(html)?.[1];
    if (canonical !== url) fail(`canonical is ${canonical ?? 'missing'}`);
    if (!/<html[^>]*lang="en-IN"/.test(html)) fail('html lang is not en-IN');

    // An unevaluated {expression} in a link target (an MDX link URL, say) or a mailto with no
    // address is a broken link, however good the page looks.
    for (const [, href = ''] of html.matchAll(/<a[^>]*href="([^"]*)"/g)) {
      if (/[{}]|%7B|%7D/i.test(href)) fail(`link target is not a URL: ${href}`);
      if (href.startsWith('mailto:') && !(href.slice(7).split('?')[0] ?? '').includes('@')) {
        fail(`mailto has no address: ${href}`);
      }
    }

    const h1s = html.match(/<h1[\s>]/g)?.length ?? 0;
    if (h1s !== 1) fail(`${String(h1s)} <h1> elements`);

    const types: unknown[] = [];
    for (const [, block = ''] of html.matchAll(
      /<script type="application\/ld\+json">([^<]*)<\/script>/g,
    )) {
      if (/aggregateRating|"Review"/.test(block)) fail('JSON-LD contains review markup');
      try {
        types.push((JSON.parse(block) as { '@type'?: unknown })['@type']);
      } catch {
        fail('JSON-LD does not parse');
      }
    }
    if (!types.includes('Organization')) fail('no Organization JSON-LD');
    if (path === '/' && !types.includes('SoftwareApplication'))
      fail('no SoftwareApplication JSON-LD');
    if (path === '/faq' && !types.includes('FAQPage')) fail('no FAQPage JSON-LD');
  }

  expect(problems).toEqual([]);
});

test('unknown slugs 404, and static routes are not shadowed by [city]', async ({ request }) => {
  for (const path of ['/pune', '/bogus-city', '/legal/cookies']) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  for (const page of [PAGES.pricing, PAGES.about]) {
    expect(titleOf(await (await request.get(page.path)).text())).toBe(fullTitle(page));
  }
});

test('the share image is a 1200×630 PNG and the logo is a PNG', async ({ request }) => {
  const og = await request.get('/opengraph-image');
  expect(og.headers()['content-type']).toMatch(/^image\/png/);
  const png = await og.body();
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);

  const logo = await request.get('/logo.png');
  expect(logo.status()).toBe(200);
  expect(logo.headers()['content-type']).toMatch(/^image\/png/);
});
