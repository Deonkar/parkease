import { expect, test } from '@playwright/test';

test.describe('earnings calculator', () => {
  test('defaults to ₹4,590 and updates as the sliders move', async ({ page }) => {
    await page.goto('/earn');
    const estimate = page.locator('[data-estimate]');
    await expect(estimate).toHaveText('₹4,590');
    await expect(page.getByText('After 15% ParkEase commission.')).toBeVisible();

    await expect(page.locator('[aria-live="polite"]').filter({ has: estimate })).toHaveAttribute(
      'aria-atomic',
      'true',
    );
    await expect(page.getByLabel('Hourly price (₹)')).toHaveAttribute(
      'aria-valuetext',
      '₹30 an hour',
    );
    await page.getByLabel('Hourly price (₹)').fill('50');
    await page.getByLabel('Hours rented per day').fill('8');
    await expect(estimate).toHaveText('₹10,200');
  });

  test('the launch waiver is opt-in and removes the commission', async ({ page }) => {
    await page.goto('/earn');
    const estimate = page.locator('[data-estimate]');
    await page.getByRole('checkbox').check();
    await expect(estimate).toHaveText('₹5,400');
    await expect(page.getByText(/No commission during your first 3 months/)).toBeVisible();
  });
});

test.describe('tabs', () => {
  test('switch by click and by arrow keys, one panel at a time', async ({ page }) => {
    await page.goto('/how-it-works');
    const parking = page.getByRole('tab', { name: 'I’m parking' });
    const listing = page.getByRole('tab', { name: 'I’m listing a space' });
    await expect(parking).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toHaveCount(1);

    await listing.click();
    await expect(listing).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Get paid weekly or monthly' })).toBeVisible();

    await listing.press('ArrowLeft');
    await expect(parking).toBeFocused();
    await expect(parking).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('FAQ', () => {
  test('answers open and close, and the JSON-LD matches what is shown', async ({ page }) => {
    await page.goto('/faq');
    const question = page.getByText('Can I park a two-wheeler?');
    const answer = page.getByText(/Owners list car and two-wheeler slots separately/);
    await expect(answer).toBeHidden();
    await question.click();
    await expect(answer).toBeVisible();
    await question.click();
    await expect(answer).toBeHidden();

    const ld = await page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((nodes) =>
        nodes.map((n) => JSON.parse(n.textContent ?? '{}') as Record<string, unknown>),
      );
    const faq = ld.find((d) => d['@type'] === 'FAQPage') as
      | { mainEntity: { name: string }[] }
      | undefined;
    const shown = await page.locator('details.faq summary').allInnerTexts();
    expect(faq?.mainEntity.map((q) => q.name)).toEqual(shown.map((s) => s.trim()));
  });
});

test.describe('keyboard', () => {
  test('the first Tab reaches the skip link, and it moves focus to the content', async ({
    page,
  }) => {
    await page.goto('/pricing');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });

  test('every link and control on the home page is reachable by Tab', async ({ page }) => {
    await page.goto('/');
    const focusable = await page
      .locator('a[href]:visible, button:visible, input:visible, summary:visible')
      .count();
    const reached = new Set<string>();
    for (let i = 0; i < focusable + 10; i++) {
      await page.keyboard.press('Tab');
      const key = await page.evaluate(() => {
        const el = document.activeElement;
        if (el === null || el === document.body) return '';
        const rect = el.getBoundingClientRect();
        return `${el.tagName}:${el.textContent?.trim().slice(0, 40) ?? ''}:${String(Math.round(rect.top + window.scrollY))}`;
      });
      if (key !== '') reached.add(key);
    }
    expect(reached.size).toBeGreaterThanOrEqual(focusable);
  });
});

test.describe('navigation', () => {
  test('the phone menu opens, navigates, and closes on arrival', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the menu only exists on small screens');
    await page.goto('/');
    await page.locator('summary[aria-label="Menu"]').click();
    const menu = page.getByRole('navigation', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await menu.getByRole('link', { name: 'Pricing' }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Transparent pricing');
    await expect(menu).toBeHidden();
    await page.locator('summary[aria-label="Menu"]').click();
    await expect(menu.getByRole('link', { name: /Pricing/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('Escape closes the phone menu and returns focus to its button', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the menu only exists on small screens');
    await page.goto('/');
    const button = page.locator('summary[aria-label="Menu"]');
    await button.click();
    const menu = page.getByRole('navigation', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
  });

  test('the current page is marked in the main navigation', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the main navigation is hidden on small screens');
    await page.goto('/pricing');
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pricing' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('unknown city slugs show the 404 page', async ({ page }) => {
    const response = await page.goto('/pune');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'This bay doesn’t exist.' })).toBeVisible();
  });

  test('legal contents links jump to their sections', async ({ page }) => {
    await page.goto('/legal/refunds');
    await page
      .getByRole('navigation', { name: 'On this page' })
      .getByRole('link', { name: 'How refunds are paid' })
      .click();
    await expect(page).toHaveURL(/#how-refunds-are-paid$/);
    await expect(page.getByRole('heading', { name: 'How refunds are paid' })).toBeInViewport();
  });
});

test.describe('blog', () => {
  test('copy link copies the canonical URL and says so', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only here');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/blog/first-basement-booking');
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'https://parkease.in/blog/first-basement-booking',
    );
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('content is visible immediately with animations off', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const animated = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (a) => a.playState === 'running' && Number(a.effect?.getTiming().duration ?? 0) > 1,
          ).length,
    );
    expect(animated).toBe(0);
  });
});
