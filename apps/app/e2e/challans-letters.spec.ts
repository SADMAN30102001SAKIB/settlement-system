import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { paymentAccountSchema } from '../shared/receipts';
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
test('delivery challans support isolated CRUD, continuous history and read-only brand access', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(120000);
  await login(page);
  const name = 'Challan ' + crypto.randomUUID();
  const brand = z.object({ item: z.object({ id: z.string() }) }).parse(
    await (
      await page.request.post('/api/manage/brands', {
        headers,
        data: { name, makingCost: 0 },
      })
    ).json(),
  ).item;
  const account = async () =>
    paymentAccountSchema.parse(
      await (
        await page.request.get(`/api/manage/receipts/account/${brand.id}`)
      ).json(),
    );
  const before = await account();
  await page.goto(`/payments/brand/${brand.id}`);
  await page.getByRole('button', { name: 'Add challan', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Add delivery challan' });
  await modal.getByLabel('Challan date').fill('2026-11-03');
  await modal.getByLabel('Challan quantity').fill('2.5');
  await modal.getByLabel('Challan unit cost (৳)').fill('175');
  await expect(modal.getByLabel('Challan total cost')).toContainText('৳437.50');
  await modal.screenshot({ path: info.outputPath('challan-form.png') });
  await modal
    .getByRole('button', { name: 'Save challan', exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  const history = page.getByRole('region', {
    name: 'Delivery challan history',
  });
  const row = history.locator('tr').filter({ hasText: '৳437.50' });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit delivery challan' });
  await edit.getByLabel('Challan quantity').fill('3');
  await edit.getByRole('button', { name: 'Save challan', exact: true }).click();
  await expect(history).toContainText('৳525.00');
  const username = 'challan-' + crypto.randomUUID(),
    password = 'brand challan secure password';
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
    viewport: page.viewportSize() ?? { width: 1280, height: 900 },
  });
  try {
    const owner = await ownerContext.newPage();
    await owner.goto('/brand/login');
    await owner.getByLabel('Username', { exact: true }).fill(username);
    await owner.getByLabel('Password', { exact: true }).fill(password);
    await owner
      .getByRole('button', { name: 'Sign in to brand portal' })
      .click();
    await owner
      .getByRole('tab', { name: 'Payment receipts', exact: true })
      .click();
    const ownHistory = owner.getByRole('region', {
      name: 'Delivery challan history',
    });
    await expect(ownHistory).toContainText('৳525.00');
    await expect(ownHistory.getByRole('button')).toHaveCount(0);
    await expect(
      owner.getByRole('button', { name: 'Add challan', exact: true }),
    ).toHaveCount(0);
    for (let i = 0; i < 25; i++)
      expect(
        (
          await page.request.post('/api/manage/challans', {
            headers,
            data: {
              requestId: crypto.randomUUID(),
              brandId: brand.id,
              date: '2026-11-02',
              quantityMilli: 1000,
              unitCost: 10000,
            },
          })
        ).ok(),
      ).toBe(true);
    await page
      .getByRole('button', { name: 'Refresh challans', exact: true })
      .click();
    await expect(history).toHaveAttribute('data-loaded-count', '20');
    await expect(async () => {
      await history.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(history).toHaveAttribute('data-loaded-count', '26', {
        timeout: 500,
      });
    }).toPass({ timeout: 15000, intervals: [100, 250] });
    await page
      .getByRole('button', { name: 'Refresh challans', exact: true })
      .click();
    const updated = history.locator('tr').filter({ hasText: '৳525.00' });
    await updated.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await expect(updated).toBeVisible();
    await updated.getByRole('button', { name: 'Delete', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete challan', exact: true })
      .click();
    await expect(updated).toHaveCount(0);
    await owner
      .getByRole('button', { name: 'Refresh challans', exact: true })
      .click();
    await expect(ownHistory).not.toContainText('৳525.00');
    await expect(ownHistory).toContainText('৳10.00');
    await ownHistory.screenshot({
      path: info.outputPath('brand-challans.png'),
    });
  } finally {
    await ownerContext.close();
  }
  const after = await account();
  expect(after.commission).toEqual(before.commission);
  expect(after.ads).toEqual(before.ads);
  expect(after.advance).toEqual(before.advance);
  expect(after.totalReceived).toBe(before.totalReceived);
});

test('bilingual formatted letters preserve whitespace, omit charges and stamps, and export multiple readable pages', async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await login(page);
  await page.goto('/manual-invoices');
  await page.getByRole('button', { name: 'New invoice', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'New manual invoice' });
  await modal.getByLabel('Document type').selectOption('letter');
  await modal
    .getByLabel('Document title')
    .fill('Client letter ' + info.project.name);
  await expect(modal.getByLabel('Document stamp')).toHaveCount(0);
  await expect(modal.getByLabel('Item 1', { exact: true })).toHaveCount(0);
  const body = modal.getByRole('textbox', { name: 'Letter body' });
  await body.fill(
    'Dear Sir,  \n\nশ্রদ্ধেয় গ্রাহক, আপনার সহযোগিতার জন্য ধন্যবাদ।\n  With regards,\nHexa Agency',
  );
  await body.press('Shift+Enter');
  await body.pressSequentially('PS: Thank you.');
  if (info.project.name === 'mobile')
    await body.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  else await body.press('Control+a');
  await expect
    .poll(() => body.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toContain('Dear Sir');
  for (const label of ['Bold', 'Italic', 'Underline', 'Strikethrough'])
    await modal.getByRole('button', { name: label, exact: true }).click();
  await modal.getByLabel('Letter text color').selectOption('#174ea6');
  await modal.getByLabel('Letter highlight').selectOption('#fff3a3');
  await expect(body.locator('strong').first()).toBeVisible();
  await modal.screenshot({ path: info.outputPath('letter-editor.png') });
  await modal
    .getByRole('button', { name: 'Save invoice', exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  const preview = page.getByRole('dialog', { name: 'Manual invoice preview' }),
    paper = preview.locator('.invoice-document');
  await expect(paper.locator('.letter-body')).toContainText('শ্রদ্ধেয় গ্রাহক');
  await expect(
    paper.locator('table,.invoice-final,.invoice-stamp'),
  ).toHaveCount(0);
  await expect(paper.locator('.letter-body strong')).not.toHaveCount(0);
  await expect(paper.locator('.letter-body br')).not.toHaveCount(0);
  expect(
    await paper
      .locator('.letter-body')
      .evaluate(
        (element) => getComputedStyle(element).fontFamily.split(',')[0],
      ),
  ).toBe(
    await paper
      .locator('.invoice-header h1')
      .evaluate(
        (element) => getComputedStyle(element).fontFamily.split(',')[0],
      ),
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
    await document.fonts.load('15px "Noto Sans Bengali Variable"', 'শ্রদ্ধেয়');
  });
  expect(
    await page.evaluate(() =>
      document.fonts.check('15px "Noto Sans Bengali Variable"', 'শ্রদ্ধেয়'),
    ),
  ).toBe(true);
  await paper.screenshot({ path: info.outputPath('letter-preview.png') });
  const download = page.waitForEvent('download');
  await preview
    .getByRole('button', { name: 'Download PDF', exact: true })
    .click();
  await (await download).saveAs(info.outputPath('letter.pdf'));
  await preview.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit manual invoice' });
  await expect(
    edit.getByRole('textbox', { name: 'Letter body' }),
  ).toContainText('শ্রদ্ধেয় গ্রাহক');
  const longText =
    Array.from(
      { length: 70 },
      (_, i) =>
        `Paragraph ${String(i + 1)}. শ্রদ্ধেয় গ্রাহক, আপনার সহযোগিতার জন্য ধন্যবাদ। This letter confirms our ongoing work and services.`,
    ).join('\n\n') + '\n\nLETTER END — ধন্যবাদ।';
  await edit.getByRole('textbox', { name: 'Letter body' }).fill(longText);
  await edit.getByRole('button', { name: 'Save invoice', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(paper.locator('.letter-body')).toContainText('LETTER END');
  const longDownload = page.waitForEvent('download');
  await preview
    .getByRole('button', { name: 'Download PDF', exact: true })
    .click();
  const path = info.outputPath('letter-long.pdf');
  await (await longDownload).saveAs(path);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = getDocument({ data: new Uint8Array(readFileSync(path)) });
  try {
    expect((await pdf.promise).numPages).toBeGreaterThan(1);
  } finally {
    await pdf.destroy();
  }
  await preview.getByRole('button', { name: 'Close', exact: true }).click();
  const row = page
    .getByRole('region', { name: 'Manual invoices' })
    .locator('.brand-row')
    .filter({ hasText: 'Client letter ' + info.project.name });
  await expect(row).toContainText('Letter document');
  await expect(row).not.toContainText('৳0.00');
});
