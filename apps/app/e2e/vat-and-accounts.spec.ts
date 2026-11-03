import { test, expect } from '@playwright/test';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { paymentAccountSchema } from '../shared/receipts';

const headers = { Origin: 'http://127.0.0.1:5174' };
test('commission excludes advertising VAT, deleted bills refresh across tabs, and activation preserves records', async ({
  page,
  context,
}, info) => {
  test.setTimeout(120000);
  await page.clock.setFixedTime(new Date('2026-11-02T06:00:00Z'));
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
  const suffix = crypto.randomUUID().slice(0, 8);
  const name = `AAA VAT ${suffix}`,
    username = `vat-owner-${suffix}`,
    password = 'brand owner secure test passphrase';
  const result = await page.request.post('/api/manage/brands', {
    headers,
    data: { name, makingCost: 0 },
  });
  const brandId = z
    .object({ item: z.object({ id: z.string() }) })
    .parse(await result.json()).item.id;
  await page.goto('/settlements/new');
  await page.getByLabel('Brand', { exact: true }).last().selectOption(brandId);
  await page
    .getByLabel('Settlement period', { exact: true })
    .fill('November VAT correction');
  await page.getByLabel('Delivered parcels', { exact: true }).fill('1');
  await page.getByLabel('Delivered amount (৳)', { exact: true }).fill('12000');
  await page.getByLabel('Advertising cost (৳)', { exact: true }).fill('2000');
  await expect(
    page.getByLabel('Advertising VAT (%)', { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.commission')).toContainText('৳1,500.00');
  await page
    .getByRole('button', { name: /Save settlement|Save report|Save &/ })
    .click();
  await expect(page.locator('.invoice-document')).toBeVisible();
  await expect(page.locator('.invoice-final')).toContainText('৳1,500.00');
  await expect(page.locator('.invoice-document')).not.toContainText(
    'Add: advertising VAT',
  );
  const id = page.url().split('/').at(-1) ?? '';
  const detail = z
    .object({ item: z.object({ invoiceNumber: z.string() }) })
    .parse(
      await (await page.request.get(`/api/manage/settlements/${id}`)).json(),
    );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const file = await download;
  const path = info.outputPath('vat-only-advertising.pdf');
  await file.saveAs(path);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = getDocument({ data: new Uint8Array(readFileSync(path)) });
  try {
    expect((await pdf.promise).numPages).toBe(1);
  } finally {
    await pdf.destroy();
  }
  const ad = await page.request.post('/api/manage/advertising', {
    headers,
    data: {
      brandId,
      date: '2026-11-02',
      period: 'November VAT',
      vatBasisPoints: 1000,
      campaigns: [{ name: 'Ads', amount: 2000000 }],
    },
  });
  expect(ad.status()).toBe(201);
  await page.goto(`/payments/brand/${brandId}`);
  const metric = page.locator('.metric').filter({
    has: page.getByText('15% Commission outstanding', { exact: true }),
  });
  await expect(metric).toContainText('৳1,500.00');
  await expect(
    page
      .locator('.metric')
      .filter({ hasText: 'Advertising outstanding with VAT' }),
  ).toContainText('৳2,200.00');
  await page.screenshot({ path: info.outputPath('payment-labels.png') });
  const other = await context.newPage();
  await other.goto('/settlements');
  await other
    .getByLabel('Search invoice', { exact: true })
    .fill(detail.item.invoiceNumber);
  const row = other
    .locator('tr')
    .filter({ hasText: detail.item.invoiceNumber });
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await other
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete settlement', exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await page.bringToFront();
  await expect(metric).toContainText('৳0.00');
  await expect(
    page.getByRole('region', { name: 'Date-wise payment ledger' }),
  ).not.toContainText(detail.item.invoiceNumber);
  const account = paymentAccountSchema.parse(
    await (
      await page.request.get(`/api/manage/receipts/account/${brandId}`)
    ).json(),
  );
  expect(account.invoices.some((invoice) => invoice.id === id)).toBe(false);
  expect(account.ads.due).toBe(2200000);
  expect(
    (
      await page.request.put(`/api/manage/brand-access/${brandId}`, {
        headers,
        data: {
          username,
          password,
          enabled: true,
          version: 0,
          currentPassword: 'browser-test-long-password',
        },
      })
    ).ok(),
  ).toBe(true);
  const ownerLogin = await page.request.post('/api/brand-auth/login', {
    headers,
    data: { username, password },
  });
  expect(ownerLogin.ok()).toBe(true);
  await page.goto('/brands');
  const brandRow = page.locator('.brand-row').filter({ hasText: name });
  async function revealBrand() {
    const scroller = page.getByRole('region', { name: 'Brands', exact: true });
    await scroller.scrollIntoViewIfNeeded();
    await expect(async () => {
      if (!(await brandRow.isVisible()))
        await scroller.evaluate((element) => {
          element.scrollTop += element.clientHeight * 0.8;
        });
      await expect(brandRow).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 20000, intervals: [100, 250] });
  }
  await revealBrand();
  await expect(brandRow).toContainText('Login enabled');
  await brandRow
    .getByRole('button', { name: 'Deactivate', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.screenshot({ path: info.outputPath('deactivate-brand.png') });
  await expect(
    dialog.getByLabel('New brand password', { exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByLabel('Your administrator password', { exact: true })
    .fill('wrong password');
  await dialog
    .getByRole('button', { name: 'Deactivate brand', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect((await page.request.get('/api/portal/payment-summary')).status()).toBe(
    200,
  );
  await dialog
    .getByLabel('Your administrator password', { exact: true })
    .fill('browser-test-long-password');
  await dialog
    .getByRole('button', { name: 'Deactivate brand', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await revealBrand();
  await expect(brandRow).toContainText('Login disabled');
  expect((await page.request.get('/api/portal/payment-summary')).status()).toBe(
    401,
  );
  expect(
    (
      await page.request.post('/api/brand-auth/login', {
        headers,
        data: { username, password },
      })
    ).status(),
  ).toBe(401);
  await brandRow.getByRole('button', { name: 'Activate', exact: true }).click();
  await dialog
    .getByLabel('Your administrator password', { exact: true })
    .fill('browser-test-long-password');
  await dialog
    .getByRole('button', { name: 'Activate brand', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await revealBrand();
  await expect(brandRow).toContainText('Login enabled');
  expect(
    (
      await page.request.post('/api/brand-auth/login', {
        headers,
        data: { username, password },
      })
    ).status(),
  ).toBe(200);
  expect(
    paymentAccountSchema.parse(
      await (
        await page.request.get(`/api/manage/receipts/account/${brandId}`)
      ).json(),
    ),
  ).toEqual(account);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset['theme'] = value;
    }, theme);
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      if (width === 320)
        await page.screenshot({
          path: info.outputPath(`brands-${theme}-phone.png`),
        });
    }
  }
  await other.close();
});
