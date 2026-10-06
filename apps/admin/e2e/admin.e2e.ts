import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('a non-admin route never renders without a session: /login stands alone', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Every action here is recorded in the audit log.')).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('approve a space', async ({ page }) => {
  await page.getByRole('link', { name: 'Approvals' }).click();
  await page
    .getByText(/Basement Parking/)
    .first()
    .click();
  await expect(page.getByText('first — approval required')).toBeVisible();
  await page.getByRole('button', { name: /Approve/ }).click();
  await expect(page.locator('.ant-drawer-open')).toHaveCount(0);
});

test('request changes needs notes first', async ({ page }) => {
  await page.getByRole('link', { name: 'Approvals' }).click();
  await page.getByText('Stilt Parking, Palm Meadows').click();
  const request = page.getByRole('button', { name: /Request changes/ });
  await expect(request).toBeDisabled();
  await page
    .getByPlaceholder(/Notes to the owner/)
    .fill('Photo 2 shows a different building. Please retake.');
  await request.click();
  await expect(page.locator('.ant-drawer-open')).toHaveCount(0);
});

test('grant a role needs a role and a reason', async ({ page }) => {
  await page.getByRole('link', { name: 'Users' }).click();
  await page.getByRole('button', { name: 'Grant role' }).first().click();
  const dialog = page.getByRole('dialog');
  const ok = dialog.getByRole('button', { name: 'Grant role' });
  await expect(ok).toBeDisabled();
  await dialog.getByText('owner', { exact: true }).click();
  await dialog
    .getByPlaceholder(/Reason/)
    .fill('Verified in person at the Koramangala onboarding session.');
  await ok.click();
  await expect(dialog).toHaveCount(0);
});

test('issue a refund from a booking', async ({ page }) => {
  await page.getByRole('link', { name: 'Bookings' }).click();
  await page.getByText(/Basement Parking/).click();
  await expect(page.getByText('Ledger trail')).toBeVisible();
  await page.getByRole('button', { name: 'Refund…' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Issue refund' });
  await dialog.getByPlaceholder(/Reason/).fill('Owner reported the gate was locked.');
  await dialog.getByRole('button', { name: 'Issue refund' }).click();
  await expect(dialog).toHaveCount(0);
});

test('edit surge and save the config', async ({ page }) => {
  await page.getByRole('link', { name: 'Surge' }).click();
  const save = page.getByRole('button', { name: 'Save config' });
  await expect(save).toBeDisabled();
  await page.getByRole('button', { name: '+ add tier' }).first().click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(save).toBeDisabled();
});

test('override a zone with its own ladder', async ({ page }) => {
  await page.getByRole('link', { name: 'Surge' }).click();
  await page.getByRole('button', { name: 'Edit' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Use a custom ladder' }).click();
  await dialog.getByPlaceholder(/Reason/).fill('Airport demand, structural scarcity');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
});

test('remove a reported review; a stored script renders as text', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', () => {
    dialogs += 1;
  });
  await page.getByRole('link', { name: 'Moderation' }).click();
  await expect(page.getByText('<script>alert(1)</script>', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder(/Reason/).fill('Spam');
  await dialog.getByRole('button', { name: 'Remove' }).click();
  await expect(dialog).toHaveCount(0);
  expect(dialogs).toBe(0);
});

test('the export button exists on finance (disabled without an API)', async ({ page }) => {
  await page.getByRole('link', { name: 'Finance' }).click();
  await expect(page.getByRole('button', { name: /Export CSV/ })).toBeDisabled();
  await expect(page.getByText('TOTAL')).toBeVisible();
});

test('keyboard reaches the refund dialog and Escape closes it', async ({ page }) => {
  await page.getByRole('link', { name: 'Bookings' }).click();
  await page.getByText(/Basement Parking/).click();
  await page.getByRole('button', { name: 'Refund…' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog').filter({ hasText: 'Issue refund' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
