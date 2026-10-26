import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

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

test('admin can create a brand, save/edit a settlement, record payment, and export its invoice', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  await signIn(page);
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('link', { name: /Brands & costs/ }).click();
  const brand = `Browser ${testInfo.project.name} ${String(Date.now())}`;
  await page.getByLabel('Brand name', { exact: true }).fill(brand);
  await page.getByLabel(/Making cost/).fill('100');
  await page.getByRole('button', { name: /Save brand|Add brand/ }).click();
  await expect(page.getByText(brand, { exact: true })).toBeVisible();
  await page.goto('/#/settlements/new');
  await page
    .getByLabel('Brand', { exact: true })
    .last()
    .selectOption({ label: brand });
  await page
    .getByLabel('Settlement period', { exact: true })
    .fill('Browser verification');
  await page.getByLabel('Delivered parcels', { exact: true }).fill('2');
  await page.getByLabel('Delivered amount (৳)', { exact: true }).fill('1000');
  await page
    .getByRole('button', { name: /Save settlement|Save report|Save &/ })
    .click();
  await expect(page.locator('.invoice-document')).toBeVisible();
  await expect(page.locator('.invoice-final')).toContainText('৳120');
  await page.getByLabel('Amount (৳)', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Bank transfer')).toHaveCount(0);
  await expect(page.getByText(/Paid ৳50/)).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^HEXA-.*\.pdf$/);
  await download.saveAs(testInfo.outputPath('settlement.pdf'));
  await page.screenshot({
    path: testInfo.outputPath('invoice.png'),
    fullPage: true,
  });
  await page.goto('/#/business');
  await expect(
    page.getByRole('heading', { name: 'Understand every order’s outcome' }),
  ).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Internal server error');
  const folder = join(import.meta.dirname, '../../../assets');
  const filenames = existsSync(folder) ? readdirSync(folder) : [];
  const courierFile = filenames.find(
    (name) => name.startsWith('consignments') && name.endsWith('.xlsx'),
  );
  if (courierFile !== undefined) {
    const existingOrders = await page.request.get(
      '/api/manage/business/orders?from=2026-10-01&to=2026-10-31&basis=order',
    );
    const owner = z
      .object({
        items: z.array(z.object({ id: z.string(), brandId: z.string() })),
      })
      .parse(await existingOrders.json())
      .items.find((item) => !item.id.startsWith('guided-'))?.brandId;
    await page
      .getByRole('button', { name: /Import orders|Import updates/ })
      .click();
    const importer = page.locator('section').filter({
      has: page.getByRole('heading', {
        name: 'Import orders & courier updates',
        exact: true,
      }),
    });
    await importer
      .getByLabel('Brand', { exact: true })
      .selectOption(owner === undefined ? { label: brand } : { value: owner });
    await importer
      .getByLabel('CSV / XLSX / PDF', { exact: true })
      .setInputFiles(join(import.meta.dirname, '../../../assets', courierFile));
    await expect(importer.locator('tbody tr')).toHaveCount(391);
    await expect(
      importer.getByRole('button', { name: 'Import 391 orders' }),
    ).toBeDisabled();
    await importer.getByRole('checkbox', { name: /blank COD-charge/ }).check();
    await importer.getByRole('checkbox', { name: /blank COD-amount/ }).check();
    await importer
      .getByRole('checkbox', { name: /I checked the dates/ })
      .check();
    await importer.getByRole('button', { name: 'Import 391 orders' }).click();
    await expect(importer.getByRole('status')).toContainText(
      '391 orders imported',
    );
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test('business tracking guides import, costs and review without exposing every form', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  await signIn(page);
  await page.goto('/#/brands');
  const brand = `Guided ${testInfo.project.name} ${String(Date.now())}`;
  await page.getByLabel('Brand name', { exact: true }).fill(brand);
  await page.getByLabel(/Making cost/).fill('100');
  await page.getByRole('button', { name: 'Save brand' }).click();
  await expect(page.getByText(brand, { exact: true })).toBeVisible();
  await page.goto('/#/business');
  await page
    .getByLabel('Brand', { exact: true })
    .selectOption({ label: brand });
  await page.getByLabel('From', { exact: true }).fill('2026-10-01');
  await page.getByLabel('To', { exact: true }).fill('2026-10-31');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(
    page.getByRole('heading', { name: 'No orders in this view' }),
  ).toBeVisible();
  await expect(page.getByLabel('CSV / XLSX / PDF')).not.toBeVisible();
  await expect(page.getByLabel('Total ads spend (৳)')).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Delete day', exact: true }),
  ).not.toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('business-empty.png'),
    fullPage: true,
  });
  const importButton = page.getByRole('button', {
    name: 'Import orders',
    exact: true,
  });
  await importButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Brand', { exact: true })).toHaveValue(
    await page
      .locator('.filters')
      .getByLabel('Brand', { exact: true })
      .inputValue(),
  );
  await expect(dialog.getByLabel('Source date format')).not.toBeVisible();
  const orderId = `guided-${testInfo.project.name}-${String(Date.now())}`;
  await dialog
    .getByLabel('Or paste spreadsheet cells (including headers)')
    .fill(
      `Order ID\tOrder Date\tDelivery Date\tStatus\tCOD Amount\tShipping Charge\tCOD Charge\n${orderId}\t26/10/2026\t26/10/2026\tDelivered\t500\t60\t5`,
    );
  await dialog.getByRole('button', { name: 'Preview pasted rows' }).click();
  await dialog
    .getByText('Check date format & column mapping', { exact: true })
    .click();
  await dialog.getByLabel('Source date format').selectOption('DMY');
  await expect(
    dialog.getByRole('cell', { name: 'Ready', exact: true }),
  ).toBeVisible();
  await dialog.getByRole('checkbox', { name: /I checked the dates/ }).check();
  await dialog.getByRole('button', { name: 'Import 1 orders' }).click();
  await expect(dialog.getByRole('status')).toContainText('1 orders imported');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('cell', { name: new RegExp(orderId) }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Create settlement', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Create settlement', exact: true }),
  ).toHaveCSS('min-height', '42px');
  await expect(
    page.getByText('Allocated advertising', { exact: true }),
  ).not.toBeVisible();
  await page.getByRole('button', { name: 'Add ad spend', exact: true }).click();
  await expect(dialog.getByLabel('Brand', { exact: true })).toHaveValue(
    await page
      .locator('.filters')
      .getByLabel('Brand', { exact: true })
      .inputValue(),
  );
  await dialog.getByLabel('Order date', { exact: true }).fill('2026-10-26');
  await dialog.getByLabel('Total ads spend (৳)').fill('100');
  await page.screenshot({
    path: testInfo.outputPath('business-cost-dialog.png'),
    fullPage: true,
  });
  await dialog
    .getByRole('button', { name: 'Save / replace daily spend' })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Add ad spend', exact: true }).click();
  await dialog.getByText('Saved daily spend', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit spend' }).click();
  await expect(dialog.getByLabel('Total ads spend (৳)')).toHaveValue('100');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add ad spend', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  await dialog.getByLabel('Date', { exact: true }).fill('2026-10-26');
  await dialog.getByLabel('Amount (৳)', { exact: true }).fill('10');
  await dialog
    .getByLabel('Description', { exact: true })
    .fill(`Test expense ${orderId}`);
  await dialog.getByRole('button', { name: 'Save expense' }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByText('Cost breakdown & daily totals', { exact: true })
    .click();
  await expect(
    page.getByText('Allocated advertising', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('business-review.png'),
    fullPage: true,
  });
  await page.getByText('Data management', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Remove an imported day', exact: true })
    .click();
  await expect(dialog.getByLabel('Brand', { exact: true })).toHaveValue(
    await page
      .locator('.filters')
      .getByLabel('Brand', { exact: true })
      .inputValue(),
  );
  await dialog.getByLabel('Order date', { exact: true }).fill('2026-10-26');
  page.once('dialog', async (confirmation) => {
    await confirmation.dismiss();
  });
  await dialog.getByRole('button', { name: 'Delete day', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: new RegExp(orderId) }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  expect(errors).toEqual([]);
});

test('advertising invoice, payment proof and invoice image controls work end to end', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
  await signIn(page);
  const brand = `Ads ${testInfo.project.name} ${String(Date.now())}`;
  await page.goto('/#/brands');
  await page.getByLabel('Brand name', { exact: true }).fill(brand);
  await page.getByRole('button', { name: 'Save brand' }).click();
  await expect(page.getByText(brand, { exact: true })).toBeVisible();
  await page.goto('/#/advertising/new');
  await page
    .getByLabel('Brand', { exact: true })
    .selectOption({ label: brand });
  await page
    .getByLabel('Period', { exact: true })
    .fill('Campaign verification');
  await page.getByLabel('Campaign 1', { exact: true }).fill('Prospecting');
  await page.getByLabel('Amount (৳)', { exact: true }).fill('100');
  await page.getByRole('button', { name: '+ Add campaign' }).click();
  await page.getByLabel('Campaign 2', { exact: true }).fill('Retargeting');
  await page.getByLabel('Amount (৳)', { exact: true }).last().fill('200');
  await page.getByRole('button', { name: 'Save invoice', exact: true }).click();
  await expect(page.locator('.invoice-final')).toContainText('৳300');
  const image = {
    name: 'browser-proof.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx9sAAAAASUVORK5CYII=',
      'base64',
    ),
  };
  await page
    .getByLabel('Upload proof (PNG, JPEG or WebP)', { exact: true })
    .setInputFiles(image);
  await expect(page.getByRole('img', { name: 'proof preview' })).toBeVisible();
  await page.getByLabel('Amount (৳)', { exact: true }).fill('40');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText(/Paid ৳40/)).toBeVisible();
  await page.getByRole('button', { name: 'View / edit proof' }).click();
  await expect(page.getByRole('img', { name: 'proof preview' })).toBeVisible();
  await page.goto('/#/settings');
  await page.getByLabel(/^(Upload|Replace) signature/).setInputFiles(image);
  await expect(
    page.getByRole('img', { name: 'signature preview' }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('settings.png'),
    fullPage: true,
  });
  await page.goto('/#/advertising');
  await page
    .getByLabel('Brand account', { exact: true })
    .selectOption({ label: brand });
  await expect(
    page.getByRole('heading', { name: 'Invoice ledger' }),
  ).toBeVisible();
  await page.getByLabel('Amount (৳)', { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText(/Paid ৳100/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('advertising.png'),
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test('a 50-campaign invoice exports readable multiple A4 pages rather than shrinking to one page', async ({
  page,
}, testInfo) => {
  await signIn(page);
  const headers = { Origin: 'http://127.0.0.1:5174' };
  const brandResponse = await page.request.post('/api/manage/brands', {
    headers,
    data: {
      name: `Long invoice ${testInfo.project.name} ${String(Date.now())}`,
      makingCost: null,
    },
  });
  expect(brandResponse.status()).toBe(201);
  const brandId = z
    .object({ item: z.object({ id: z.string() }) })
    .parse(await brandResponse.json()).item.id;
  const response = await page.request.post('/api/manage/advertising', {
    headers,
    data: {
      brandId,
      date: '2026-10-26',
      period: 'Long campaign invoice',
      campaigns: Array.from({ length: 50 }, (_, index) => ({
        name: `Campaign ${String(index + 1)} · conversion and retargeting`,
        amount: 100000,
      })),
    },
  });
  expect(response.status()).toBe(201);
  const id = z.object({ id: z.string() }).parse(await response.json()).id;
  await page.goto(`/#/advertising/${id}`);
  await expect(page.locator('.invoice-document tbody tr')).toHaveCount(50);
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const file = testInfo.outputPath('long-advertising.pdf');
  await (await event).saveAs(file);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(readFileSync(file)) });
  try {
    const document = await task.promise;
    expect(document.numPages).toBeGreaterThan(1);
  } finally {
    await task.destroy();
  }
});
