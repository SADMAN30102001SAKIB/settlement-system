import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { z } from 'zod';
import { paymentAccountSchema } from '../shared/receipts';
import { readFileSync } from 'node:fs';
const headers = { Origin: 'http://127.0.0.1:5174' };
async function login(page: Page) {
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
test('brand advances fund commission and ads without double counting and remain brand isolated', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  await login(page);
  const name = `AAA Advance ${crypto.randomUUID()}`;
  const brand = z.object({ item: z.object({ id: z.string() }) }).parse(
    await (
      await page.request.post('/api/manage/brands', {
        headers,
        data: { name, makingCost: 0 },
      })
    ).json(),
  ).item;
  const settlement = z
    .object({ item: z.object({ id: z.string(), invoiceNumber: z.string() }) })
    .parse(
      await (
        await page.request.post('/api/manage/settlements', {
          headers,
          data: {
            brandId: brand.id,
            date: '2026-11-03',
            period: 'Advance test',
            deliveredQty: 1,
            deliveredAmount: 10000000,
            cancelledQty: 0,
            cancelledAmount: 0,
            partialQty: 0,
            partialAmount: 0,
            pendingQty: 0,
            shipping: 0,
            codCharge: 0,
            ads: 0,
            productCost: 0,
            costPerPiece: 0,
            agencyBasisPoints: 1500,
          },
        })
      ).json(),
    ).item;
  const ad = z.object({ id: z.string() }).parse(
    await (
      await page.request.post('/api/manage/advertising', {
        headers,
        data: {
          brandId: brand.id,
          date: '2026-11-03',
          period: 'Advance advertising',
          vatBasisPoints: 1000,
          campaigns: [{ name: 'Campaign', amount: 1000000 }],
        },
      })
    ).json(),
  );
  const adNumber = z
    .object({ item: z.object({ invoiceNumber: z.string() }) })
    .parse(
      await (await page.request.get(`/api/manage/advertising/${ad.id}`)).json(),
    ).item.invoiceNumber;
  await page.goto(`/payments/brand/${brand.id}`);
  await page
    .getByRole('button', { name: 'Record advance', exact: true })
    .click();
  const modal = page.getByRole('dialog', { name: 'Record advance payment' });
  await modal.getByLabel('Advance amount (৳)').fill('2500');
  await modal.getByLabel('Advance note (optional)').fill('Future invoices');
  await modal
    .getByRole('button', { name: 'Save advance', exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  const metric = (label: string) =>
    page
      .locator('.metric')
      .filter({ has: page.getByText(label, { exact: true }) });
  await expect(metric('Available advance')).toContainText('৳2,500.00');
  await page.getByLabel('Payment source').selectOption('advance');
  await page
    .getByLabel(`Received for ${settlement.invoiceNumber}`, { exact: true })
    .fill('1000');
  await page
    .getByLabel(`Received for ${adNumber}`, { exact: true })
    .fill('500');
  await page
    .getByRole('button', { name: 'Record payment & create receipt' })
    .click();
  await expect(page.locator('.invoice-document')).toContainText(
    'Advance credit applied',
  );
  await expect(page.locator('.invoice-document')).toContainText(
    'New money received on this receipt: ৳0.00',
  );
  const receiptId = page.url().split('/').at(-1) ?? '';
  await page.goto(`/payments/brand/${brand.id}`);
  await expect(metric('Available advance')).toContainText('৳1,000.00');
  await expect(metric('Total money received')).toContainText('৳2,500.00');
  await expect(metric('Total due')).toContainText('৳1,100.00');
  const history = page.getByRole('region', { name: 'Advance payment history' });
  await history.screenshot({
    path: info.outputPath('advance-delete-actions.png'),
  });
  await history.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete advance', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'Reverse enough credit-payment receipts first',
  );
  const receiptNumber = z
    .object({ item: z.object({ number: z.string() }) })
    .parse(
      await (
        await page.request.get(`/api/manage/receipts/${receiptId}`)
      ).json(),
    ).item.number;
  await expect(page.getByRole('alert')).toContainText(receiptNumber);
  const username = `advance-${crypto.randomUUID().slice(0, 8)}`,
    password = 'brand advance secure password';
  expect(
    (
      await page.request.put(`/api/manage/brand-access/${brand.id}`, {
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
  const ownerContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:5174',
  });
  const owner = await ownerContext.newPage();
  await owner.goto('/brand/login');
  await owner.getByLabel('Username', { exact: true }).fill(username);
  await owner.getByLabel('Password', { exact: true }).fill(password);
  await owner.getByRole('button', { name: /Sign in/ }).click();
  await owner.getByRole('tab', { name: 'Payment receipts' }).click();
  await expect(
    owner
      .locator('.metric')
      .filter({ has: owner.getByText('Available advance', { exact: true }) }),
  ).toContainText('৳1,000.00');
  await expect(
    owner.getByRole('region', { name: 'Advance payment history' }),
  ).toHaveCount(0);
  await expect(
    owner
      .locator('.metric')
      .filter({ has: owner.getByText('Total due', { exact: true }) }),
  ).toContainText('৳1,100.00');
  await expect(
    owner.getByRole('heading', { name: 'Advance payments', exact: true }),
  ).toHaveCount(0);
  await expect(
    owner.getByRole('button', { name: 'Record advance', exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await owner.request.get(
        '/api/portal/advances?brandId=00000000-0000-4000-8000-000000000001',
      )
    ).status(),
  ).toBe(422);
  expect(
    (await owner.request.get('/api/manage/manual-invoices')).status(),
  ).toBe(401);
  await ownerContext.close();
  await history.getByRole('button', { name: 'Reverse', exact: true }).click();
  const reverse = page.getByRole('dialog', { name: 'Reverse advance payment' });
  await reverse.getByLabel('Reversal reason').fill('Mistaken advance entry');
  await reverse.getByRole('button', { name: 'Confirm reversal' }).click();
  await expect(reverse.getByRole('alert')).toContainText(
    'Insufficient unused advance',
  );
  await reverse.getByRole('button', { name: 'Close', exact: true }).click();
  const account = paymentAccountSchema.parse(
    await (
      await page.request.get(`/api/manage/receipts/account/${brand.id}`)
    ).json(),
  );
  expect(
    (
      await page.request.post(`/api/manage/receipts/${receiptId}/reverse`, {
        headers,
        data: { version: account.version, reason: 'Undo credit application' },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await expect(metric('Available advance')).toContainText('৳2,500.00');
  await history.getByRole('button', { name: 'Reverse', exact: true }).click();
  await reverse.getByLabel('Reversal reason').fill('Mistaken advance entry');
  await reverse.getByRole('button', { name: 'Confirm reversal' }).click();
  await expect(reverse).toHaveCount(0);
  await expect(metric('Available advance')).toContainText('৳0.00');
  await expect(metric('Total money received')).toContainText('৳0.00');
  await history.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete advance', exact: true })
    .click();
  await expect(history).not.toContainText('Reversed');
  await page
    .getByRole('button', { name: 'Record advance', exact: true })
    .click();
  await modal.getByLabel('Advance amount (৳)').fill('100');
  await modal
    .getByRole('button', { name: 'Save advance', exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await expect(metric('Available advance')).toContainText('৳100.00');
  await history.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(metric('Available advance')).toContainText('৳100.00');
  await history.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete advance', exact: true })
    .click();
  await expect(metric('Available advance')).toContainText('৳0.00');
  await expect(metric('Total money received')).toContainText('৳0.00');
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: info.outputPath(`advances-${String(width)}.png`),
    });
  }
});

test('manual invoice editing, fractional quantities, PDF and deletion stay independent of financial accounts', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await login(page);
  await page.goto('/manual-invoices');
  await page.getByRole('button', { name: 'New invoice', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New manual invoice' });
  await form.getByLabel('Document title').fill('Office purchase budget');
  await form.getByLabel('Prepared for (optional)').fill('Studio');
  await form.getByLabel('Item 1', { exact: true }).fill('Lighting equipment');
  await form.getByLabel('Quantity 1', { exact: true }).fill('2.5');
  await form.getByLabel('Unit price 1 (৳)', { exact: true }).fill('100');
  await expect(form).toContainText('৳250.00');
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await form.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await form.screenshot({
      path: info.outputPath(`manual-form-${String(width)}.png`),
    });
  }
  await form.getByRole('button', { name: 'Save invoice', exact: true }).click();
  await expect(form).toHaveCount(0);
  const preview = page.getByRole('dialog', { name: 'Manual invoice preview' });
  await expect(preview.locator('.invoice-final')).toContainText('৳250.00');
  const download = page.waitForEvent('download');
  await preview
    .getByRole('button', { name: 'Download PDF', exact: true })
    .click();
  const file = await download;
  const path = info.outputPath('manual-invoice.pdf');
  await file.saveAs(path);
  expect(readFileSync(path).subarray(0, 4).toString()).toBe('%PDF');
  await preview
    .locator('.invoice-document')
    .screenshot({ path: info.outputPath('manual-paper.png') });
  await preview.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit manual invoice' });
  await edit.getByLabel('Unit price 1 (৳)', { exact: true }).fill('200');
  await edit.getByRole('button', { name: 'Save invoice', exact: true }).click();
  await expect(preview.locator('.invoice-final')).toContainText('৳500.00');
  await preview.getByRole('button', { name: 'Close', exact: true }).click();
  const row = page
    .getByRole('region', { name: 'Manual invoices' })
    .locator('.brand-row')
    .filter({ hasText: 'Office purchase budget' })
    .first();
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete invoice', exact: true })
    .click();
  await expect(row).toHaveCount(0);
});
