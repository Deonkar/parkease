# @parkease/web

The ParkEase marketing site (task 20): every public page, the city pages, the blog, the legal
pages, and the SEO infrastructure. Next.js 15 App Router, Tailwind 4, MDX. ParkEase is currently
a portfolio project; the site says so in its footer and legal banner.

## Run it

```bash
pnpm install                          # from the repo root; Node 24 (see .nvmrc)
pnpm --filter @parkease/web dev       # http://localhost:3001
pnpm --filter @parkease/web build && pnpm --filter @parkease/web start   # production, :3000
```

## Checks

| Command                                          | What it checks                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @parkease/web lint` / `typecheck` | ESLint (root config) and TypeScript                                                                                                                                                                                                                                                                                                                         |
| `pnpm --filter @parkease/web test`               | Vitest: earnings maths, metadata uniqueness and length, cities, sitemap/robots, JSON-LD, pricing per ADR-009, legal contents, the map builder, and a scan that fails on any colour literal                                                                                                                                                                  |
| `pnpm --filter @parkease/web test:e2e`           | Playwright against a production build (run `build` first) at desktop and phone sizes: SEO (titles, descriptions, canonical, Open Graph, JSON-LD, broken link targets, sitemap, robots, share image, 404s), interactions (calculator, tabs, phone menu, keyboard, FAQ, copy link, reduced motion), axe on every page, and no horizontal scroll down to 320px |
| Lighthouse CI (`lighthouserc.json`)              | A gate in CI on `/`, `/pricing` and `/bangalore`: Performance and SEO ≥ 0.9, FCP and LCP ≤ 2.5s, CLS ≤ 0.1                                                                                                                                                                                                                                                  |

`.github/workflows/web.yml` runs all of these on every PR that touches the site. Where
Playwright's own Chromium can't be downloaded, set `PW_CHROMIUM_PATH` to a local Chromium.

## Environment variables

All optional.

| Variable                     | Effect                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`       | Canonical origin for metadata, the sitemap, robots.txt and the share image. Defaults to `https://parkease.in`; set it when deploying anywhere else so search engines aren't pointed at another domain |
| `NEXT_PUBLIC_PLAY_STORE_URL` | Turns "Android app coming soon" into a link to the listing                                                                                                                                            |
| `NEXT_PUBLIC_APP_STORE_URL`  | Same for iPhone                                                                                                                                                                                       |

## Where things live

| Path                             | What                                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`                           | Routes. City pages are `app/[city]` at the root, legal pages are `app/legal/[doc]`; both set `dynamicParams = false`, so unknown slugs 404                              |
| `content/blog`, `content/legal`  | MDX bodies. Blog posts are also listed in `lib/blog.ts`; each legal document's contents list is in `lib/legal.ts` and must match its `##` headings (a test checks this) |
| `lib/pages.ts`                   | Title and meta description for every static page; metadata, the sitemap and the tests read from here                                                                    |
| `lib/pricing.ts`                 | Every number the site quotes, derived from `@parkease/contracts`. Don't type prices into pages; add them here                                                           |
| `lib/site.ts`                    | Site URL, store links, contact addresses, company details, navigation                                                                                                   |
| `lib/cities.ts`                  | Launched cities                                                                                                                                                         |
| `lib/rupee.tsx`                  | `formatRupees`, and `<Rupees>` for amounts set in display type                                                                                                          |
| `@parkease/tokens` (`webColors`) | Every colour. `lib/theme.ts` turns them into `--pe-*` CSS variables; `app/globals.css` maps those into Tailwind. No colour literal is allowed in `apps/web`             |
| `lib/map/`                       | The Indiranagar street map, from OpenStreetMap (ODbL). Wherever it renders, it must show "Map data © OpenStreetMap contributors"                                       |

## Adding things

- **A page:** add it to `PAGES` in `lib/pages.ts` (unique title, 100–160 character description),
  use `pageMetadata(PAGES.x)`, and the sitemap and tests pick it up.
- **A blog post:** add `content/blog/<slug>.mdx`, its entry in `lib/blog.ts`, and its loader in
  `lib/mdx.ts`.
- **A city:** add it to `LAUNCHED_CITIES` in `lib/cities.ts`.

Deferred cleanup for this app is queued in `suggestedtask.md` (S-148, S-149).
