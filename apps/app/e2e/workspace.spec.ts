import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { contrastFailures } from './contrast';

async function signIn(page: Page) {
  await page.goto('/');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    'href',
    '/favicon.svg',
  );
  const favicon = await page.request.get('/favicon.svg');
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()['content-type']).toContain('image/svg+xml');
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
  await page.goto('/settlements/new');
  await page
    .getByLabel('Brand', { exact: true })
    .last()
    .selectOption({ label: brand });
  await page
    .getByLabel('Settlement period', { exact: true })
    .fill('Browser verification');
  await page.getByLabel('Delivered parcels', { exact: true }).fill('2');
  await page.getByLabel('Cancelled parcels', { exact: true }).fill('5');
  await page.getByLabel('Partial parcels', { exact: true }).fill('3');
  await page.getByLabel('Pending parcels', { exact: true }).fill('4');
  await page.getByLabel('Delivered amount (৳)', { exact: true }).fill('1000');
  await page.getByLabel('Partial collection (৳)', { exact: true }).fill('200');
  await page
    .getByLabel('Delivered COD charges (৳)', { exact: true })
    .fill('10');
  await page.getByLabel('Partial COD charges (৳)', { exact: true }).fill('2');
  await page.getByLabel('Advertising cost (৳)', { exact: true }).fill('100');
  await page.getByLabel('Delivered item quantity', { exact: true }).fill('4');
  await page.getByLabel('Shipping charges (৳)', { exact: true }).fill('60');
  await expect(
    page.getByLabel('Product cost (৳)', { exact: true }),
  ).toHaveValue('400');
  await page
    .getByRole('button', { name: /Save settlement|Save report|Save &/ })
    .click();
  await expect(page.locator('.invoice-document')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Delete settlement', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page
    .getByRole('button', { name: 'Delete settlement', exact: true })
    .click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('HEXA-');
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(page.locator('.invoice-document')).toBeVisible();
  await expect(page.locator('.invoice-final')).toContainText('৳92.70');
  await expect(page.locator('.invoice-document')).toContainText(
    '4 delivered items',
  );
  await expect(page.locator('.invoice-document')).toContainText(
    'Less: delivery charges',
  );
  await expect(page.locator('.invoice-document')).toContainText(
    'advertising VAT (10%)',
  );
  await expect(page.locator('.invoice-document')).not.toContainText(
    'Less: shipping charges',
  );
  await page.getByLabel('Amount (৳)', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Bank transfer')).toHaveCount(0);
  await expect(page.getByText(/Paid ৳50/)).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^HEXA-.*\.pdf$/);
  await download.saveAs(testInfo.outputPath('settlement.pdf'));
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = getDocument({
    data: new Uint8Array(readFileSync(testInfo.outputPath('settlement.pdf'))),
  });
  try {
    expect((await pdf.promise).numPages).toBe(1);
  } finally {
    await pdf.destroy();
  }
  await page.screenshot({
    path: testInfo.outputPath('invoice.png'),
    fullPage: true,
  });
  await page.goto('/notes');
  await page.getByLabel('Filter work by brand').selectOption({ label: brand });
  await expect(
    page.getByRole('cell', { name: 'Browser verification', exact: true }),
  ).toBeVisible();
  await page.goto('/business');
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
      importer.getByRole('button', { name: 'Confirm & import 391 orders' }),
    ).toBeDisabled();
    await importer.getByLabel(/Blank COD fees/).selectOption('zero');
    await importer.getByLabel(/Blank COD collection/).selectOption('zero');
    await importer
      .getByRole('button', { name: 'Confirm & import 391 orders' })
      .click();
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
  await page.goto('/brands');
  const brand = `Guided ${testInfo.project.name} ${String(Date.now())}`;
  await page.getByLabel('Brand name', { exact: true }).fill(brand);
  await page.getByLabel(/Making cost/).fill('100');
  await page.getByRole('button', { name: 'Save brand' }).click();
  await expect(page.getByText(brand, { exact: true })).toBeVisible();
  await page.goto('/business');
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
  await expect(
    dialog.getByRole('button', { name: 'Preview pasted rows' }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole('button', { name: 'Preview pasted rows' }),
  ).toHaveCSS('cursor', 'not-allowed');
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
  await dialog
    .getByRole('button', { name: 'Confirm & import 1 orders' })
    .click();
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
    page.getByText('Advertising incl. 10% VAT', { exact: true }),
  ).toBeVisible();
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
    page.getByText('Advertising incl. 10% VAT', { exact: true }),
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
  await dialog.getByRole('button', { name: 'Delete day', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
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
  await page.goto('/brands');
  await page.getByLabel('Brand name', { exact: true }).fill(brand);
  await page.getByRole('button', { name: 'Save brand' }).click();
  await expect(page.getByText(brand, { exact: true })).toBeVisible();
  await page.goto('/advertising/new');
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
  await page.goto('/settings');
  await page.getByLabel(/^(Upload|Replace) signature/).setInputFiles(image);
  await expect(
    page.getByRole('img', { name: 'signature preview' }),
  ).toBeVisible();
  for (const kind of ['watermark', 'signature']) {
    await page
      .getByRole('button', { name: `Restore default ${kind}`, exact: true })
      .click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Restore image', exact: true })
      .click();
    await expect(
      page.getByRole('img', { name: `${kind} preview` }),
    ).toBeVisible();
  }
  const artwork = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Canvas unavailable');
    context.fillStyle = 'black';
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = 'white';
    context.fillRect(1, 0, 1, 1);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });
  await page
    .getByRole('checkbox', {
      name: 'Remove light background and convert artwork to black',
      exact: true,
    })
    .last()
    .check();
  await page.getByLabel(/^(Upload|Replace) signature/).setInputFiles({
    name: 'artwork.png',
    mimeType: 'image/png',
    buffer: Buffer.from(artwork, 'base64'),
  });
  await expect
    .poll(async () =>
      page
        .getByRole('img', { name: 'signature preview' })
        .evaluate(async (node) => {
          if (!(node instanceof HTMLImageElement)) return [];
          await node.decode();
          const canvas = document.createElement('canvas');
          canvas.width = 2;
          canvas.height = 1;
          const context = canvas.getContext('2d');
          if (context === null) return [];
          context.drawImage(node, 0, 0);
          const data = context.getImageData(0, 0, 2, 1).data;
          return [data[3], data[7]];
        }),
    )
    .toEqual([255, 0]);
  await page
    .getByRole('button', { name: 'Restore default signature', exact: true })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Restore image', exact: true })
    .click();
  await expect
    .poll(async () =>
      page
        .getByRole('img', { name: 'signature preview' })
        .evaluate(async (node) => {
          if (!(node instanceof HTMLImageElement)) return 0;
          await node.decode();
          return node.naturalWidth;
        }),
    )
    .toBeGreaterThan(100);
  await page.screenshot({
    path: testInfo.outputPath('settings.png'),
    fullPage: true,
  });
  await page.goto('/advertising');
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

test('layouts stay balanced across desktop, tablet and narrow mobile screens', async ({
  page,
}, testInfo) => {
  await signIn(page);
  const widths =
    testInfo.project.name === 'desktop' ? [1440, 1024, 768] : [390, 360];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['settings', 'files', 'settlements/new']) {
      await page.goto(`/${route}`);
      await expect(page.locator('main h1')).toBeVisible();
      await expect(page.locator('main')).not.toContainText(
        'Internal server error',
      );
      if (route === 'settings') {
        const panels = page.locator('.settings-layout > .panel');
        const first = await panels.nth(0).boundingBox();
        const second = await panels.nth(1).boundingBox();
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        if (first && second) {
          expect(Math.abs(first.width - second.width)).toBeLessThan(1);
          expect(second.y - (first.y + first.height)).toBeGreaterThanOrEqual(
            20,
          );
        }
        await expect(page.locator('.invoice-image-card')).toHaveCount(2);
      } else if (route === 'files') {
        await expect(
          page.locator('.files-table tbody tr').first(),
        ).toBeVisible();
        if (width > 680) {
          await expect(page.locator('.files-table th').last()).toHaveCSS(
            'text-align',
            'left',
          );
          await expect(page.locator('.files-table th.numeric')).toHaveCSS(
            'text-align',
            'right',
          );
        } else {
          await expect(page.locator('.files-table tbody tr').first()).toHaveCSS(
            'display',
            'block',
          );
          await expect(
            page.locator('.files-table td.file-actions').first(),
          ).toHaveCSS('display', 'flex');
        }
      } else {
        await expect(page.getByLabel('CSV / XLSX / PDF')).not.toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Save & view invoice' }),
        ).toBeVisible();
        const identity = await page
          .locator('.settlement-identity')
          .boundingBox();
        const editor = await page.locator('.settlement-editor').boundingBox();
        if (identity && editor && width > 1100)
          expect(identity.width).toBeGreaterThan(editor.width * 0.85);
        await page
          .getByRole('button', { name: 'Load settlement totals', exact: true })
          .click();
        await expect(
          page.getByRole('button', {
            name: 'Load saved courier totals & allocated ads',
          }),
        ).toBeVisible();
        await expect(
          page.getByRole('button', {
            name: 'Load saved courier totals & allocated ads',
          }),
        ).toBeDisabled();
        await expect(
          page.getByRole('button', {
            name: 'Load saved courier totals & allocated ads',
          }),
        ).toHaveCSS('cursor', 'not-allowed');
        await expect(page.getByLabel('CSV / XLSX / PDF')).not.toBeVisible();
        await page
          .getByRole('button', { name: 'Courier file', exact: true })
          .click();
        await expect(page.getByLabel('CSV / XLSX / PDF')).toBeVisible();
        await expect(
          page.getByRole('button', {
            name: 'Load saved courier totals & allocated ads',
          }),
        ).not.toBeVisible();
        await page
          .getByRole('button', { name: 'Business Tracking', exact: true })
          .click();
        await page
          .getByRole('button', { name: 'Close data source', exact: true })
          .click();
        await expect(
          page.getByText('Gross settlement', { exact: true }),
        ).toBeVisible();
      }
      if (width <= 1024)
        await expect(
          page.getByRole('button', { name: 'Toggle navigation' }),
        ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
      ).toBe(false);
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: testInfo.outputPath(
          `layout-${route.replace('/', '-')}-${String(width)}.png`,
        ),
        fullPage: true,
      });
    }
  }
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
  await page.goto(`/advertising/${id}`);
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

test('themes persist, follow the system, and keep compact advertising invoices printable', async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.getByLabel('Color theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByLabel('Color theme')).toHaveValue('dark');
  for (const route of ['settings', 'business', 'settlements/new']) {
    await page.goto(`/${route}`);
    await expect(page.getByLabel('Color theme')).toHaveValue('dark');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath(`dark-${route.replace('/', '-')}.png`),
      fullPage: true,
    });
  }
  const headers = { Origin: 'http://127.0.0.1:5174' };
  const brand = await page.request.post('/api/manage/brands', {
    headers,
    data: {
      name: `Compact ${testInfo.project.name} ${String(Date.now())}`,
      makingCost: 100000,
    },
  });
  const brandId = z
    .object({ item: z.object({ id: z.string() }) })
    .parse(await brand.json()).item.id;
  const imported = await page.request.post('/api/manage/business/import', {
    headers,
    data: {
      brandId,
      rows: [
        {
          id: `guided-quantity-${testInfo.project.name}-${String(Date.now())}`,
          orderDate: '2026-10-26',
          deliveryDate: '2026-10-26',
          status: 'Delivered',
          quantity: 4,
          partialQuantity: null,
          salesOverride: null,
          codAmount: 1000000,
          shipping: 60000,
          codCharge: 10000,
        },
      ],
    },
  });
  expect(imported.status()).toBe(200);
  await page.goto('/settlements/new');
  await page.reload();
  await page
    .getByRole('button', { name: 'Load settlement totals', exact: true })
    .click();
  await page.getByLabel('Brand', { exact: true }).first().selectOption(brandId);
  await page
    .getByRole('button', {
      name: 'Load saved courier totals & allocated ads',
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel('Delivered item quantity', { exact: true }),
  ).toHaveValue('4');
  await expect(
    page.getByLabel('Product cost (৳)', { exact: true }),
  ).toHaveValue('400');
  await expect(
    page.getByLabel('Shipping charges (৳)', { exact: true }),
  ).toHaveValue('60');
  const response = await page.request.post('/api/manage/advertising', {
    headers,
    data: {
      brandId,
      date: '2026-10-26',
      period: 'Compact invoice check',
      campaigns: [{ name: 'One campaign', amount: 100000 }],
    },
  });
  expect(response.status()).toBe(201);
  const id = z.object({ id: z.string() }).parse(await response.json()).id;
  await page.goto(`/advertising/${id}`);
  await expect(page.locator('.invoice-advertising')).toBeVisible();
  await expect(page.locator('.invoice-document')).toHaveCSS(
    'color',
    'rgb(34, 52, 44)',
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF' }).click();
  const file = testInfo.outputPath('compact-advertising.pdf');
  await (await download).saveAs(file);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(readFileSync(file)) });
  try {
    const document = await task.promise;
    expect(document.numPages).toBe(1);
    const pdfPage = await document.getPage(1);
    const viewport = pdfPage.getViewport({ scale: 1 });
    expect(viewport.width).toBeCloseTo((210 * 72) / 25.4, 0);
    expect(viewport.height).toBeLessThan((280 * 72) / 25.4);
  } finally {
    await task.destroy();
  }
  await page.screenshot({
    path: testInfo.outputPath('compact-invoice-dark.png'),
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByLabel('Color theme').selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByLabel('Color theme').selectOption('light');
});

test('clean routes support navigation, reloads, history and existing hash bookmarks', async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto('/brands');
  await expect(
    page.getByRole('heading', { name: 'Built around your brands' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/brands$/);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Built around your brands' }),
  ).toBeVisible();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(
    navigation.getByRole('link', { name: 'Invoice settings' }),
  ).toHaveAttribute('href', '/settings');
  await navigation.getByRole('link', { name: 'Invoice settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/brands$/);
  await expect(
    page.getByRole('heading', { name: 'Built around your brands' }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole('heading', { name: 'Make it yours' }),
  ).toBeVisible();
  await page.goto('/#/brands');
  await expect(page).toHaveURL(/\/brands$/);
  await expect(
    page.getByRole('heading', { name: 'Built around your brands' }),
  ).toBeVisible();
  await expect(page.locator('a[href^="#/"]')).toHaveCount(0);
});

test('shared screen colors and scrollbars remain legible in both themes', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await signIn(page);
  await page.goto('/brands');
  await page
    .getByLabel('Brand name', { exact: true })
    .fill(
      `OK Tailor appearance ${testInfo.project.name} ${String(Date.now())}`,
    );
  await page.getByLabel(/Making cost/).fill('450');
  await page.getByRole('button', { name: 'Save brand' }).click();
  await expect(page.locator('.brand-row .avatar').last()).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Color theme').selectOption(theme);
    for (const route of [
      'brands',
      'settlements',
      'settlements/new',
      'advertising',
      'advertising/new',
      'business',
      'notes',
      'settings',
      'files',
    ]) {
      await page.goto(`/${route}`);
      await expect(page.getByLabel('Color theme')).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByLabel('Color theme')).toHaveValue(theme);
      await expect(page.locator('main h1')).toBeVisible();
      const failures = await contrastFailures(page);
      console.log(JSON.stringify({ theme, route, failures }));
      expect.soft(failures, `${theme} ${route} text contrast`).toEqual([]);
      const scrollbar = await page.evaluate(() => ({
        width: getComputedStyle(document.documentElement, '::-webkit-scrollbar')
          .width,
        arrows: getComputedStyle(
          document.documentElement,
          '::-webkit-scrollbar-button',
        ).display,
        thumb: getComputedStyle(
          document.documentElement,
          '::-webkit-scrollbar-thumb',
        ).backgroundColor,
      }));
      expect(scrollbar.width).toBe('8px');
      expect(scrollbar.arrows).toBe('none');
      expect(scrollbar.thumb).not.toBe('rgba(0, 0, 0, 0)');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
      ).toBe(false);
      if (route === 'brands' || route === 'settlements/new')
        await page.screenshot({
          path: testInfo.outputPath(`${theme}-${route.replace('/', '-')}.png`),
          fullPage: true,
        });
      if (route === 'brands') {
        await page.locator('.skip-link').focus();
        expect
          .soft(await contrastFailures(page), `${theme} focused skip link`)
          .toEqual([]);
      }
      if (route === 'business') {
        await page
          .getByRole('button', { name: 'Add ad spend', exact: true })
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect
          .soft(await contrastFailures(page), `${theme} advertising dialog`)
          .toEqual([]);
        await page.keyboard.press('Escape');
      }
    }
  }
  await page.getByLabel('Color theme').selectOption('light');
});

test('source loading gives feedback, sidebar collapses, and import decisions stay explicit', async ({
  page,
}, testInfo) => {
  await signIn(page);
  if (testInfo.project.name === 'desktop') {
    await page
      .getByRole('button', { name: 'Collapse sidebar', exact: true })
      .click();
    await expect(page.locator('.sidebar')).toHaveAttribute('inert', '');
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Expand sidebar', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Expand sidebar', exact: true })
      .click();
    await expect(page.locator('.sidebar')).not.toHaveAttribute('inert', '');
  }
  await expect(page.getByText('D1 connected', { exact: true })).toHaveCount(0);
  await expect(page.locator('.breadcrumb')).toHaveCount(0);
  await page.goto('/brands');
  const brand = `Feedback ${testInfo.project.name} ${String(Date.now())}`;
  await page.getByLabel('Brand name', { exact: true }).fill(brand);
  await page.getByLabel(/Making cost/).fill('100');
  await page.getByRole('button', { name: 'Save brand' }).click();
  await expect(page.getByText(brand, { exact: true })).toBeVisible();
  await page.goto('/settlements/new');
  await page.getByLabel('Delivered amount (৳)', { exact: true }).fill('777');
  await page
    .getByRole('button', { name: 'Load settlement totals', exact: true })
    .click();
  await page
    .getByLabel('Brand', { exact: true })
    .first()
    .selectOption({ label: brand });
  let release: () => void = () => {
    throw new Error('The request gate was not initialized.');
  };
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/manage/business/settlement?*', async (route) => {
    await gate;
    await route.continue();
  });
  await page
    .getByRole('button', {
      name: 'Load saved courier totals & allocated ads',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('button', { name: 'Loading saved totals…', exact: true }),
  ).toBeDisabled();
  release();
  await expect(page.getByRole('alert')).toContainText(
    'No saved orders match this brand and date range',
  );
  await expect(
    page.getByLabel('Delivered amount (৳)', { exact: true }),
  ).toHaveValue('777');
  await page.unroute('**/api/manage/business/settlement?*');
  await page.goto('/business');
  await page
    .getByRole('button', { name: /Import orders|Import updates/ })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Brand', { exact: true })
    .selectOption({ label: brand });
  await dialog
    .getByLabel('Or paste spreadsheet cells (including headers)')
    .fill(
      'Order Date\tOrder ID\tDelivery Status\tDelivery Time\tCOD Amount\tShipping Charge\tCOD Charge\n2026-10-26\tfeedback-test\tDelivered\t2026-10-26\t1000\t60\t10',
    );
  await dialog.getByRole('button', { name: 'Preview pasted rows' }).click();
  await expect(dialog.getByLabel(/Blank COD/)).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(
    dialog.getByRole('button', {
      name: 'Confirm & import 1 orders',
      exact: true,
    }),
  ).toBeEnabled();
  await dialog.getByLabel('Import type').selectOption('orders');
  await expect(dialog.getByRole('alert')).toContainText('would ignore them');
  await expect(
    dialog.getByRole('button', {
      name: 'Confirm & import 1 orders',
      exact: true,
    }),
  ).toBeDisabled();
  await dialog
    .getByRole('button', { name: 'Use courier update', exact: true })
    .click();
  await expect(
    dialog.getByRole('cell', { name: 'Delivered', exact: true }),
  ).toBeVisible();
  await dialog.screenshot({
    path: testInfo.outputPath('import-review-layout.png'),
  });
});

test('settings use themed confirmations, custom checkboxes and reduced-motion preferences', async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto('/settings');
  await expect(
    page.getByRole('button', { name: 'Delete image', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('.form-footer')).not.toContainText(
    'Restore company defaults',
  );
  const restore = page.getByRole('button', {
    name: 'Restore company defaults',
    exact: true,
  });
  for (const theme of ['light', 'dark']) {
    await page.getByLabel('Color theme').selectOption(theme);
    await restore.click();
    const confirmation = page.getByRole('alertdialog', {
      name: 'Restore company details?',
    });
    await expect(confirmation).toBeVisible();
    await expect(
      confirmation.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeFocused();
    expect(await contrastFailures(page)).toEqual([]);
    await confirmation.screenshot({
      path: testInfo.outputPath(`confirmation-${theme}.png`),
    });
    await page.keyboard.press('Shift+Tab');
    await expect(
      confirmation.getByRole('button', {
        name: 'Restore details',
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(confirmation).toHaveCount(0);
    await expect(restore).toBeFocused();
  }
  const checkbox = page
    .getByRole('checkbox', {
      name: 'Remove light background and convert artwork to black',
      exact: true,
    })
    .first();
  await expect(checkbox).toHaveCSS('appearance', 'none');
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await page.keyboard.press('Space');
  await expect(checkbox).not.toBeChecked();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await restore.click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toHaveCSS('animation-name', 'none');
  await expect(
    confirmation.getByRole('button', { name: 'Cancel', exact: true }),
  ).toHaveCSS('transition-duration', '0s');
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await page
    .getByLabel('Company name', { exact: true })
    .fill('Temporary company details');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved');
  await restore.click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Restore details', exact: true })
    .click();
  await expect(page.getByLabel('Company name', { exact: true })).toHaveValue(
    'Hexa Agency Ltd.',
  );
  await page.screenshot({
    path: testInfo.outputPath('settings-refined.png'),
    fullPage: true,
  });
  const filename = `delete-confirmation-${testInfo.project.name}.png`;
  const upload = await page.request.post('/api/manage/files/proof', {
    headers: {
      Origin: 'http://127.0.0.1:5174',
      'Content-Type': 'application/octet-stream',
      'X-File-Name': filename,
    },
    data: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx9sAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  expect(upload.ok()).toBe(true);
  await page.goto('/files');
  const file = page.getByRole('row').filter({ hasText: filename });
  await file.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText(filename);
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(file).toBeVisible();
  await file.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete file', exact: true })
    .click();
  await expect(file).toHaveCount(0);
});
