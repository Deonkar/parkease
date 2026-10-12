/**
 * Checks a running build of the site against the task 20 SEO requirements: every URL in the
 * sitemap answers 200 with a unique title, a 100–160 character description, canonical and
 * Open Graph tags, valid JSON-LD with no review markup, and one h1. Also checks robots.txt,
 * the share image, and that unknown city slugs 404.
 *
 *   pnpm --filter @parkease/web build && pnpm --filter @parkease/web start &
 *   pnpm --filter @parkease/web verify          # BASE_URL defaults to http://localhost:3000
 */
const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SITE = 'https://parkease.in';

const failures = [];
const fail = (where, message) => failures.push(`${where}: ${message}`);
const log = (line) => process.stdout.write(`${line}\n`);

const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

function meta(html, attr, key) {
  const tag = html.match(new RegExp(`<meta[^>]*${attr}="${key}"[^>]*>`, 'i'))?.[0];
  const content = tag?.match(/content="([^"]*)"/)?.[1];
  return content === undefined ? undefined : decode(content);
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
  return { status: res.status, type: res.headers.get('content-type') ?? '', res };
}

// sitemap.xml
const sitemapRes = await get('/sitemap.xml');
const sitemapXml = await sitemapRes.res.text();
const urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (sitemapRes.status !== 200) fail('/sitemap.xml', `status ${sitemapRes.status}`);
if (urls.length < 20) fail('/sitemap.xml', `only ${urls.length} URLs`);
for (const required of [
  '/legal/privacy',
  '/legal/terms',
  '/legal/refunds',
  '/legal/guidelines',
  '/bangalore',
]) {
  if (!urls.includes(`${SITE}${required}`)) fail('/sitemap.xml', `missing ${required}`);
}

// robots.txt
const robots = await (await get('/robots.txt')).res.text();
for (const line of [
  'User-Agent: *',
  'Allow: /',
  'Disallow: /api/',
  'Disallow: /admin/',
  `Sitemap: ${SITE}/sitemap.xml`,
]) {
  if (!robots.toLowerCase().includes(line.toLowerCase())) fail('/robots.txt', `missing "${line}"`);
}

// Every page in the sitemap
const titles = new Map();
const descriptions = new Map();
for (const url of urls) {
  const path = url.slice(SITE.length) || '/';
  const { status, res } = await get(path);
  if (status !== 200) {
    fail(path, `status ${status}`);
    continue;
  }
  const html = await res.text();

  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
  if (title === '') fail(path, 'no <title>');
  if (titles.has(title)) fail(path, `title "${title}" also used by ${titles.get(title)}`);
  titles.set(title, path);

  const description = meta(html, 'name', 'description') ?? '';
  if (description.length < 100 || description.length > 160) {
    fail(path, `description is ${description.length} characters`);
  }
  if (descriptions.has(description))
    fail(path, `description also used by ${descriptions.get(description)}`);
  descriptions.set(description, path);

  for (const key of ['og:title', 'og:description', 'og:image', 'og:url']) {
    if (meta(html, 'property', key) === undefined) fail(path, `no ${key}`);
  }
  const canonical = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/)?.[1];
  if (canonical !== url) fail(path, `canonical is ${canonical ?? 'missing'}`);
  if (!/<html[^>]*lang="en-IN"/.test(html)) fail(path, 'html lang is not en-IN');

  const h1s = html.match(/<h1[\s>]/g)?.length ?? 0;
  if (h1s !== 1) fail(path, `${h1s} <h1> elements`);

  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map(
    (m) => m[1],
  );
  const types = [];
  for (const block of blocks) {
    if (/aggregateRating|"Review"/.test(block)) fail(path, 'JSON-LD contains review markup');
    try {
      types.push(JSON.parse(block)['@type']);
    } catch {
      fail(path, 'JSON-LD does not parse');
    }
  }
  if (!types.includes('Organization')) fail(path, 'no Organization JSON-LD');
  if (path === '/' && !types.includes('SoftwareApplication'))
    fail(path, 'no SoftwareApplication JSON-LD');
  if (path === '/faq' && !types.includes('FAQPage')) fail(path, 'no FAQPage JSON-LD');
}

// Unknown city slugs 404; static routes are not shadowed by [city].
for (const path of ['/pune', '/bogus-city']) {
  const { status } = await get(path);
  if (status !== 404) fail(path, `expected 404, got ${status}`);
}
for (const [path, expected] of [
  ['/pricing', 'Pricing — ParkEase'],
  ['/about', 'About ParkEase — ParkEase'],
]) {
  const html = await (await get(path)).res.text();
  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
  if (title !== expected) fail(path, `title "${title}", expected "${expected}"`);
}

// Share image: a 1200×630 PNG.
const og = await get('/opengraph-image');
const png = Buffer.from(await og.res.arrayBuffer());
if (og.status !== 200 || !og.type.startsWith('image/png')) {
  fail('/opengraph-image', `status ${og.status}, ${og.type}`);
} else if (png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) {
  fail('/opengraph-image', `size ${png.readUInt32BE(16)}×${png.readUInt32BE(20)}`);
}

// The Organization logo the JSON-LD points at.
const logo = await get('/logo.png');
if (logo.status !== 200 || !logo.type.startsWith('image/png'))
  fail('/logo.png', `status ${logo.status}`);

if (failures.length > 0) {
  log(`✗ ${failures.length} problem(s):`);
  for (const f of failures) log(`  ${f}`);
  process.exit(1);
}
log(`✓ ${urls.length} pages, robots.txt, sitemap.xml, share image, logo and 404s all check out.`);
