import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { z } from 'zod';
const headers = { Origin: 'http://127.0.0.1:5174' };
async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('browser-admin');
  await page
    .getByLabel('Password', { exact: true })
    .fill('browser-test-long-password');
  if (await page.getByLabel('Installation token', { exact: true }).isVisible())
    await page
      .getByLabel('Installation token', { exact: true })
      .fill('browser-test-only-setup-token-never-for-production');
  await page
    .getByRole('button', {
      name: /Create admin & sign in|Sign in to workspace/,
    })
    .click();
  await expect(
    page.getByRole('heading', { name: 'The numbers, in focus.' }),
  ).toBeVisible();
}
async function seed(page: Page) {
  const name = `AAA Cost ${crypto.randomUUID()}`;
  const brand = z.object({ item: z.object({ id: z.string() }) }).parse(
    await (
      await page.request.post('/api/manage/brands', {
        headers,
        data: { name, makingCost: 450000 },
      })
    ).json(),
  ).item;
  const rows = [
    {
      id: crypto.randomUUID(),
      status: 'Delivered',
      quantity: 2,
      deliveryDate: '2026-10-22',
    },
    {
      id: crypto.randomUUID(),
      status: 'Pending',
      quantity: 1,
      deliveryDate: null,
    },
  ].map((row) => ({
    ...row,
    orderDate: '2026-10-21',
    partialQuantity: null,
    salesOverride: null,
    codAmount: 1000000,
    shipping: 0,
    codCharge: 0,
  }));
  expect(
    (
      await page.request.post('/api/manage/business/import', {
        headers,
        data: { brandId: brand.id, rows },
      })
    ).status(),
  ).toBe(200);
  return { brand, name, rows };
}
test('brand prices default to new orders and existing-cost corrections require a reviewed confirmation', async ({
  page,
}, info) => {
  await signIn(page);
  const { brand, name } = await seed(page);
  await page.goto('/brands');
  const row = page.locator('.brand-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit brand', exact: true });
  await expect(dialog.getByLabel('Apply making cost to')).toHaveValue('new');
  await dialog.getByLabel('Making cost per piece (৳)').fill('175');
  await dialog.getByRole('button', { name: 'Save brand', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const costs = async () =>
    z
      .object({ items: z.array(z.object({ costPerPiece: z.number() })) })
      .parse(
        await (
          await page.request.get(
            `/api/manage/business/orders?brandId=${brand.id}&from=2026-10-01&to=2026-10-31&basis=order`,
          )
        ).json(),
      )
      .items.map((item) => item.costPerPiece);
  expect(await costs()).toEqual([450000, 450000]);
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog.getByLabel('Apply making cost to').selectOption('existing');
  await dialog.getByLabel('Orders from').fill('2026-10-01');
  await dialog.getByLabel('Orders through').fill('2026-10-31');
  await dialog.getByRole('button', { name: 'Preview correction' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('2 orders');
  await expect(confirmation).toContainText('৳900.00 → ৳350.00');
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  expect(await costs()).toEqual([450000, 450000]);
  await dialog.getByRole('button', { name: 'Preview correction' }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.screenshot({ path: info.outputPath('cost-preview.png') });
  await confirmation
    .getByRole('button', { name: 'Apply correction', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(await costs()).toEqual([175000, 175000]);
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await dialog.getByLabel('Apply making cost to').selectOption('existing');
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await dialog.screenshot({
      path: info.outputPath(`cost-form-${String(width)}.png`),
    });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  }
});

test('wheel scrolling never changes number inputs and keyboard increments still work', async ({
  page,
}, info) => {
  await signIn(page);
  const { brand, rows } = await seed(page);
  const response = await page.request.post('/api/manage/settlements', {
    headers,
    data: {
      brandId: brand.id,
      date: '2026-10-21',
      period: 'Wheel legacy VAT test',
      advertisingVatOnly: false,
      deliveredQty: 1,
      deliveredAmount: 1000000,
      cancelledQty: 0,
      cancelledAmount: 0,
      partialQty: 0,
      partialAmount: 0,
      pendingQty: 0,
      shipping: 0,
      codCharge: 0,
      ads: 0,
      productCost: 450000,
      costPerPiece: 450000,
      agencyBasisPoints: 1500,
    },
  });
  expect(response.status()).toBe(201);
  const invoice = z
    .object({ item: z.object({ id: z.string() }) })
    .parse(await response.json()).item;
  for (const theme of ['light', 'dark']) {
    await page.goto(`/settlements/${invoice.id}/edit`);
    await page.getByLabel('Color theme').selectOption(theme);
    await expect(page.locator('input[type="number"]')).toHaveCount(7);
    for (const input of await page.locator('input[type="number"]').all()) {
      await input.fill('2');
      await input.press('ArrowUp');
      const value = await input.inputValue();
      await input.hover();
      await page.mouse.wheel(0, 180);
      await expect(input).toHaveValue(value);
      await expect(input).not.toBeFocused();
    }
    const count = page.getByLabel('Delivered parcels', { exact: true });
    await count.click();
    const before = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 120);
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeGreaterThan(before);
    await page.goto('/settings');
    const percentage = page.getByLabel('Default agency percentage (%)');
    await percentage.fill('15');
    await percentage.hover();
    await page.mouse.wheel(0, 150);
    await expect(percentage).toHaveValue('15');
    await expect(percentage).not.toBeFocused();
    await page.evaluate((brandId) => {
      sessionStorage.setItem(
        'hexa-filters:business',
        JSON.stringify({ from: '2026-10-01', to: '2026-10-31', brandId }),
      );
    }, brand.id);
    await page.goto('/business');
    const row = page.getByRole('row').filter({ hasText: rows[0]?.id ?? '' });
    await row.getByRole('button', { name: 'Edit order', exact: true }).click();
    await expect(page.locator('input[type="number"]')).toHaveCount(2);
    for (const input of await page.locator('input[type="number"]').all()) {
      await input.fill('2');
      await input.hover();
      await page.mouse.wheel(0, 150);
      await expect(input).toHaveValue('2');
      await expect(input).not.toBeFocused();
    }
    await page
      .getByRole('dialog')
      .screenshot({ path: info.outputPath(`wheel-${theme}.png`) });
    await page.keyboard.press('Escape');
  }
});
