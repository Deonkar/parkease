import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

/**
 * §21.8 (S-157): every admin page draws its loading, error and empty states, and passes an axe
 * scan. The fixtures serve each state on request (`parkease.fixtureState`), so this is a table,
 * not a test per screen.
 */
const PAGES = [
  { path: '/', heading: 'Dashboard', list: false },
  { path: '/spaces', heading: 'Approvals', list: true },
  { path: '/partners', heading: 'Partners', list: true },
  { path: '/users', heading: 'Users', list: true },
  { path: '/bookings', heading: 'Bookings', list: true },
  { path: '/finance', heading: 'Finance', list: false },
  { path: '/surge', heading: 'Surge', list: false },
  { path: '/moderation', heading: 'Moderation', list: true },
  { path: '/audit', heading: 'Audit log', list: true },
] as const;

const inState = async (page: Page, state: 'loading' | 'error' | 'empty' | null, path: string) => {
  await page.addInitScript((value) => {
    if (value === null) sessionStorage.removeItem('parkease.fixtureState');
    else sessionStorage.setItem('parkease.fixtureState', value);
  }, state);
  await page.goto(path);
};

for (const { path, list } of PAGES) {
  test.describe(`${path}`, () => {
    test('shows a skeleton while loading', async ({ page }) => {
      await inState(page, 'loading', path);
      await expect(page.locator('.ant-skeleton').first()).toBeVisible();
    });

    test('shows the error with a retry when the API fails', async ({ page }) => {
      await inState(page, 'error', path);
      const alert = page.getByRole('alert').filter({ hasText: 'Could not load this page' }).first();
      await expect(alert).toBeVisible({ timeout: 15_000 });
      await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
    });

    if (list) {
      test('shows the empty state for no rows', async ({ page }) => {
        await inState(page, 'empty', path);
        await expect(page.locator('.ant-empty').first()).toBeVisible();
      });
    }

    test('has no serious or critical axe violations', async ({ page }) => {
      await inState(page, null, path);
      await expect(page.locator('.ant-skeleton')).toHaveCount(0, { timeout: 15_000 });
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const blocking = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(blocking).toEqual([]);
    });
  });
}

test('the sign-in page has no serious or critical axe violations', async ({ page }) => {
  await page.goto('/login');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => v.id),
  ).toEqual([]);
});
