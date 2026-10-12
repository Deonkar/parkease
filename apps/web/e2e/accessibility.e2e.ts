import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = [
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
  '/partners',
  '/blog',
  '/blog/first-basement-booking',
  '/legal/privacy',
  '/legal/terms',
  '/legal/refunds',
  '/legal/guidelines',
  '/account/delete',
  '/bangalore',
  '/delhi',
  '/mumbai',
  '/pune',
];

/** Task 20: every page passes axe with no critical violations. Serious ones fail too. */
for (const path of PAGES) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
      .analyze();
    const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(
      blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });

  test(`no horizontal scroll: ${path}`, async ({ page, isMobile }) => {
    await page.goto(path);
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);
    if (isMobile) {
      // The narrowest phones in use are 320 CSS px wide.
      await page.setViewportSize({ width: 320, height: 640 });
      expect(await overflow()).toBeLessThanOrEqual(0);
    }
  });
}
