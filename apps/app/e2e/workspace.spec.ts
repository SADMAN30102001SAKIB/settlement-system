import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { contrastFailures } from './contrast';
import { readSheet } from 'read-excel-file/node';
import { receiptListSchema } from '../shared/receipts';

async function reverseLinkedReceipt(
  page: Page,
  kind: 'settlements' | 'advertising',
  invoiceId: string,
) {
  const detail = z
    .object({ item: z.object({ brandId: z.string() }) })
    .parse(
      await (await page.request.get(`/api/manage/${kind}/${invoiceId}`)).json(),
    );
  const records = receiptListSchema.parse(
    await (
      await page.request.get(
        `/api/manage/receipts?brandId=${detail.item.brandId}`,
      )
    ).json(),
  );
  const receipt = records.items.find(
    (r) =>
      r.reversedAt === null &&
      r.data.lines.some((line) => line.invoiceId === invoiceId),
  );
  if (!receipt) throw new Error('Expected an active linked receipt');
  await page.goto(`/payments/${receipt.id}`);
  await expect(
    page.getByRole('button', { name: 'Delete receipt', exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel('Reversal reason')
    .fill('Reverse browser test payment before deleting source invoice');
  await page
    .getByRole('button', { name: 'Reverse receipt', exact: true })
    .click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('All 1 allocation(s)');
  await confirmation
    .getByRole('button', { name: 'Reverse receipt', exact: true })
    .click();
  await expect(
    page.getByText('REVERSED — NOT AN ACTIVE PAYMENT', { exact: true }),
  ).toBeVisible();
  return receipt.id;
}

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

async function uploadStamps(page: Page) {
  await page.goto('/settings');
  for (const kind of ['paid', 'unpaid', 'due']) {
    const source = join(
      '..',
      '..',
      'assets',
      'stamps',
      `${kind}-transparent.png`,
    );
    const buffer = existsSync(source)
      ? readFileSync(source)
      : Buffer.from(
          await page.evaluate((label) => {
            const canvas = document.createElement('canvas');
            canvas.width = 300;
            canvas.height = 150;
            const drawing = canvas.getContext('2d');
            if (!drawing) throw new Error('Canvas unavailable');
            drawing.strokeStyle = drawing.fillStyle =
              label === 'paid' ? '#0034ac' : '#cc0000';
            drawing.lineWidth = 8;
            drawing.strokeRect(8, 8, 284, 134);
            drawing.font = 'bold 50px sans-serif';
            drawing.fillText(label.toUpperCase(), 22, 95);
            return canvas.toDataURL('image/png').split(',')[1] ?? '';
          }, kind),
          'base64',
        );
    await page
      .getByLabel(new RegExp(`^(Upload|Replace) ${kind} stamp`))
      .setInputFiles({ name: `${kind}.png`, mimeType: 'image/png', buffer });
    await expect(
      page.getByRole('img', { name: `${kind} stamp preview`, exact: true }),
    ).toBeVisible();
  }
}

test('brand payments split commission and ads into immutable receipts and support audited reversal', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await signIn(page);
  await page.goto('/settings');
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
  await uploadStamps(page);
  const headers = { Origin: 'http://127.0.0.1:5174' },
    brandName = `Receipts ${testInfo.project.name} ${String(Date.now())}`;
  const brand = z.object({ item: z.object({ id: z.string() }) }).parse(
    await (
      await page.request.post('/api/manage/brands', {
        headers,
        data: { name: brandName, makingCost: 100000 },
      })
    ).json(),
  ).item;
  const settlement = await page.request.post('/api/manage/settlements', {
    headers,
    data: {
      brandId: brand.id,
      date: '2026-10-27',
      period: 'October commission',
      deliveredQty: 10,
      deliveredAmount: 100000000,
      cancelledQty: 0,
      cancelledAmount: 0,
      partialQty: 0,
      partialAmount: 0,
      pendingQty: 0,
      shipping: 0,
      codCharge: 0,
      ads: 0,
      productCost: 0,
      costPerPiece: null,
      agencyBasisPoints: 1500,
    },
  });
  const invoice = z
    .object({ item: z.object({ id: z.string(), invoiceNumber: z.string() }) })
    .parse(await settlement.json()).item;
  const ad = await page.request.post('/api/manage/advertising', {
    headers,
    data: {
      brandId: brand.id,
      date: '2026-10-27',
      period: 'October advertising',
      campaigns: [{ name: 'Campaign', amount: 20000000 }],
    },
  });
  const adId = z.object({ id: z.string() }).parse(await ad.json()).id;
  const adInvoice = z
    .object({ item: z.object({ invoiceNumber: z.string() }) })
    .parse(
      await (await page.request.get(`/api/manage/advertising/${adId}`)).json(),
    ).item;
  for (const [route, number, kind] of [
    ['/settlements', invoice.invoiceNumber, 'settlement'],
    ['/advertising', adInvoice.invoiceNumber, 'advertising'],
  ] as const) {
    await page.goto(route);
    const status = page.getByLabel(`Status for ${number}`, { exact: true });
    await expect(status.locator('option')).toHaveText([
      'Unpaid',
      'Paid',
      'Due',
      'Advance',
      'N/A',
    ]);
    const row = page.locator('tr').filter({ has: status });
    const actions = await row
      .locator('.invoice-row-actions button')
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const box = button.getBoundingClientRect();
          return {
            top: box.top,
            text: button.textContent.trim(),
            label: button.getAttribute('aria-label'),
          };
        }),
      );
    expect(new Set(actions.map((action) => action.top)).size).toBe(1);
    expect(actions.every((action) => action.text === '' && action.label)).toBe(
      true,
    );
    for (const choice of ['Unpaid', 'Due', 'Advance', 'N/A', 'Paid']) {
      await status.selectOption(choice);
      await expect(status).toHaveValue(choice);
      await row.getByRole('button', { name: 'View', exact: true }).click();
      const dialog = page.locator('.invoice-dialog');
      await expect(dialog).toBeVisible();
      if (['Paid', 'Unpaid', 'Due'].includes(choice)) {
        await expect(
          dialog.getByRole('img', { name: `${choice} stamp`, exact: true }),
        ).toBeVisible();
      } else await expect(dialog.locator('.invoice-stamp')).toHaveCount(0);
      if (choice === 'Paid') {
        const download = page.waitForEvent('download');
        await dialog
          .getByRole('button', { name: 'Download PDF', exact: true })
          .click();
        await (
          await download
        ).saveAs(testInfo.outputPath(`${kind}-paid-stamp.pdf`));
        await page.screenshot({
          path: testInfo.outputPath(`${kind}-paid-stamp.png`),
        });
      }
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    }
    await page.reload();
    await expect(status).toHaveValue('Paid');
  }
  await page.goto('/payments');
  if (testInfo.project.name === 'mobile')
    await page
      .getByRole('button', { name: 'Toggle navigation', exact: true })
      .click();
  const navigation = page.locator('.sidebar');
  await expect(
    navigation.getByRole('link', { name: /Payments/ }),
  ).toContainText('06');
  await expect(
    navigation.getByRole('link', { name: /Business tracking/ }),
  ).toContainText('07');
  await expect(
    navigation.getByRole('link', { name: /Private files/ }),
  ).toContainText('08');
  if (testInfo.project.name === 'mobile')
    await navigation.getByRole('link', { name: /Payments/ }).click();
  await page.getByLabel('Payment brand account').selectOption(brand.id);
  await expect(
    page.getByRole('heading', { name: `${brandName} account`, exact: true }),
  ).toBeVisible();
  await expect(page.locator('.metrics')).toContainText('৳15,000.00');
  await expect(page.locator('.metrics')).toContainText('৳22,000.00');
  const dateLedger = page.getByRole('region', {
    name: 'Date-wise payment ledger',
  });
  const billRow = dateLedger.locator('[data-bill-date="2026-10-27"]');
  await expect(billRow.locator('.numeric')).toHaveText([
    '৳15,000.00',
    '৳22,000.00',
    '৳0.00',
    '৳0.00',
    '৳15,000.00',
    '৳22,000.00',
  ]);
  const size = page.viewportSize();
  for (const width of testInfo.project.name === 'desktop'
    ? [1440, 1024, 768]
    : [390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Color theme').selectOption(theme);
      await page.waitForFunction(
        () =>
          !document
            .getAnimations()
            .some((animation) => animation instanceof CSSTransition),
      );
      await dateLedger.scrollIntoViewIfNeeded();
      expect(await contrastFailures(page)).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`date-ledger-${theme}-${String(width)}.png`),
      });
      await page.locator('.receipt-composer').scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      expect(await contrastFailures(page)).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`payments-${theme}-${String(width)}.png`),
      });
    }
  }
  if (size) await page.setViewportSize(size);
  await billRow
    .getByRole('button', { name: 'Pay this date', exact: true })
    .click();
  await expect(page.getByLabel('Bills to pay', { exact: true })).toHaveValue(
    '2026-10-27',
  );
  await page.getByLabel('Payment date', { exact: true }).fill('2026-10-28');
  await page
    .getByLabel(`Received for ${invoice.invoiceNumber}`, { exact: true })
    .fill('4000');
  await page
    .getByLabel(`Received for ${adInvoice.invoiceNumber}`, { exact: true })
    .fill('6000');
  await page.getByLabel('Payment method').selectOption('Bank transfer');
  await page.getByLabel('Transaction reference').fill('BANK-VERIFY-1');
  await page
    .getByLabel('Receipt stamp status', { exact: true })
    .selectOption('Unpaid');
  await page
    .getByRole('button', {
      name: 'Record payment & create receipt',
      exact: true,
    })
    .click();
  await expect(page.locator('.invoice-final')).toContainText('৳10,000.00');
  await expect(
    page.getByRole('img', { name: 'Unpaid stamp', exact: true }),
  ).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  expect(
    await page.evaluate(() => {
      const stampBox = document
        .querySelector('.invoice-stamp')
        ?.getBoundingClientRect();
      const metaBox = document
        .querySelector('.invoice-meta')
        ?.getBoundingClientRect();
      if (!stampBox || !metaBox) throw new Error('Printed stamp missing');
      return Math.abs(
        stampBox.x + stampBox.width / 2 - metaBox.x - metaBox.width / 2,
      );
    }),
  ).toBeLessThan(1);
  await page.emulateMedia({ media: null });
  await expect(page.locator('.invoice-document')).toContainText('৳11,000.00');
  await expect(page.locator('.invoice-document')).toContainText('৳16,000.00');
  await expect(page.locator('.invoice-meta')).toContainText('28 Oct 2026');
  const signature = await page
    .getByRole('img', { name: 'Authorized signature', exact: true })
    .boundingBox();
  expect(signature?.width).toBe(130);
  expect(signature?.height).toBe(60);
  const firstId = new URL(page.url()).pathname.split('/').at(-1);
  if (!firstId) throw new Error('Missing receipt id');
  const first = z
    .object({ item: z.object({ data: z.unknown() }) })
    .parse(
      await (await page.request.get(`/api/manage/receipts/${firstId}`)).json(),
    ).item;
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Download receipt PDF', exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^PAY-.*\.pdf$/);
  await file.saveAs(testInfo.outputPath('payment-receipt.pdf'));
  expect(
    readFileSync(testInfo.outputPath('payment-receipt.pdf'))
      .toString('latin1')
      .match(/\/Type \/Page\b/g),
  ).toHaveLength(1);
  await page.screenshot({
    path: testInfo.outputPath('payment-receipt.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Back to brand account', exact: true })
    .click();
  await expect(billRow.locator('.numeric')).toHaveText([
    '৳15,000.00',
    '৳22,000.00',
    '৳4,000.00',
    '৳6,000.00',
    '৳11,000.00',
    '৳16,000.00',
  ]);
  await page
    .getByLabel(`Received for ${invoice.invoiceNumber}`, { exact: true })
    .fill('500');
  await page
    .getByRole('button', {
      name: 'Record payment & create receipt',
      exact: true,
    })
    .click();
  await expect(page.locator('.invoice-final')).toContainText('৳500.00');
  await page
    .getByRole('button', { name: 'Back to brand account', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Payment receipt history' })
      .locator('tbody tr'),
  ).toHaveCount(2);
  const unchanged = z
    .object({ item: z.object({ data: z.unknown() }) })
    .parse(
      await (await page.request.get(`/api/manage/receipts/${firstId}`)).json(),
    ).item;
  expect(unchanged.data).toEqual(first.data);
  await page.goto(`/payments/${firstId}`);
  await page
    .getByRole('button', { name: 'Reverse receipt', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('at least five');
  await page
    .getByLabel('Reversal reason')
    .fill('Incorrect allocation, entered during verification');
  await page
    .getByRole('button', { name: 'Reverse receipt', exact: true })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(page.locator('.receipt-reversed')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Reverse receipt', exact: true })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Reverse receipt', exact: true })
    .click();
  await expect(page.locator('.receipt-reversed')).toContainText('REVERSED');
  await expect(page.locator('.invoice-final')).toContainText('৳10,000.00');
  await page
    .getByRole('button', { name: 'Back to brand account', exact: true })
    .click();
  await expect(page.locator('.metrics')).toContainText('৳14,500.00');
  await expect(page.locator('.metrics')).toContainText('৳22,000.00');
  await expect(billRow.locator('.numeric')).toHaveText([
    '৳15,000.00',
    '৳22,000.00',
    '৳500.00',
    '৳0.00',
    '৳14,500.00',
    '৳22,000.00',
  ]);
  await expect(
    page.getByRole('region', { name: 'Payment receipt history' }),
  ).toContainText('Reversed');
});

test('date ledger paginates and filters bills, and date-specific payments do not affect other dates', async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await signIn(page);
  const headers = { Origin: 'http://127.0.0.1:5174' };
  const brandResponse = await page.request.post('/api/manage/brands', {
    headers,
    data: {
      name: `Date ledger ${testInfo.project.name} ${String(Date.now())}`,
      makingCost: 0,
    },
  });
  const brandId = z
    .object({ item: z.object({ id: z.string() }) })
    .parse(await brandResponse.json()).item.id;
  const invoices: { id: string; invoiceNumber: string }[] = [];
  for (let day = 1; day <= 21; day++) {
    const response = await page.request.post('/api/manage/advertising', {
      headers,
      data: {
        brandId,
        date: `2026-10-${String(day).padStart(2, '0')}`,
        period: `Daily advertising ${String(day)}`,
        campaigns: [{ name: 'Campaign', amount: 1000000 }],
      },
    });
    expect(response.status()).toBe(201);
    const id = z.object({ id: z.string() }).parse(await response.json()).id;
    const item = z
      .object({ item: z.object({ id: z.string(), invoiceNumber: z.string() }) })
      .parse(
        await (await page.request.get(`/api/manage/advertising/${id}`)).json(),
      ).item;
    invoices.push(item);
  }
  const latest = invoices.at(-1),
    oldest = invoices[0];
  if (!latest || !oldest) throw new Error('Date fixtures missing');
  await page.goto(`/payments/brand/${brandId}`);
  const ledger = page.getByRole('region', { name: 'Date-wise payment ledger' });
  await expect(ledger.locator('tbody tr')).toHaveCount(20);
  await expect(ledger.locator('tbody tr').first()).toHaveAttribute(
    'data-bill-date',
    '2026-10-21',
  );
  await ledger.getByRole('button', { name: 'Next dates', exact: true }).click();
  await expect(ledger.locator('tbody tr')).toHaveCount(1);
  await expect(ledger.locator('tbody tr').first()).toHaveAttribute(
    'data-bill-date',
    '2026-10-01',
  );
  await page.getByLabel('Find bill date', { exact: true }).fill('2026-10-21');
  await expect(ledger.locator('tbody tr')).toHaveCount(1);
  await ledger
    .getByRole('button', { name: 'Pay this date', exact: true })
    .click();
  await expect(page.getByLabel('Bills to pay', { exact: true })).toHaveValue(
    '2026-10-21',
  );
  await expect(page.locator('.receipt-allocation')).toHaveCount(1);
  await page
    .getByLabel(`Received for ${latest.invoiceNumber}`, { exact: true })
    .fill('400');
  await page
    .getByLabel('Bills to pay', { exact: true })
    .selectOption('2026-10-01');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(page.getByLabel('Bills to pay', { exact: true })).toHaveValue(
    '2026-10-21',
  );
  await expect(
    page.getByLabel(`Received for ${latest.invoiceNumber}`, { exact: true }),
  ).toHaveValue('400');
  await page
    .getByLabel('Bills to pay', { exact: true })
    .selectOption('2026-10-01');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Change bill date', exact: true })
    .click();
  await expect(
    page.getByLabel(`Received for ${oldest.invoiceNumber}`, { exact: true }),
  ).toHaveValue('');
  await page
    .getByLabel(`Received for ${oldest.invoiceNumber}`, { exact: true })
    .fill('250');
  await page
    .getByRole('button', {
      name: 'Record payment & create receipt',
      exact: true,
    })
    .click();
  await expect(page.locator('.invoice-final')).toContainText('৳250.00');
  await expect(page.locator('.invoice-document')).toContainText(
    oldest.invoiceNumber,
  );
  await expect(page.locator('.invoice-document')).not.toContainText(
    latest.invoiceNumber,
  );
  await page
    .getByRole('button', { name: 'Back to brand account', exact: true })
    .click();
  await page.getByLabel('Find bill date', { exact: true }).fill('2026-10-21');
  await expect(ledger.locator('[data-label="Ads paid"]')).toHaveText('৳0.00');
  await expect(ledger.locator('[data-label="Ads due"]')).toHaveText(
    '৳1,100.00',
  );
  await page.getByLabel('Find bill date', { exact: true }).fill('2026-10-01');
  await expect(ledger.locator('[data-label="Ads paid"]')).toHaveText('৳250.00');
  await expect(ledger.locator('[data-label="Ads due"]')).toHaveText('৳850.00');
  await page.getByLabel('Find bill date', { exact: true }).fill('2026-09-01');
  await expect(ledger).toContainText('No bills for this date');
  await ledger
    .getByRole('button', { name: 'Show all dates', exact: true })
    .click();
  await expect(ledger.locator('tbody tr')).toHaveCount(20);
});

test('daily advertising save button stays compact and aligned at every breakpoint', async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto('/business');
  for (const width of testInfo.project.name === 'desktop'
    ? [1440, 1024, 768]
    : [390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const button = page.getByRole('button', {
      name: 'Save daily ad spend',
      exact: true,
    });
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    const input = await page.getByLabel('Total ads spend (৳)').boundingBox();
    if (!box || !input) throw new Error('Daily advertising controls missing');
    expect(box.height).toBeLessThanOrEqual(52);
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.width).toBeLessThan(260);
    const filterButton = await page
      .getByRole('button', { name: 'Apply filters', exact: true })
      .boundingBox();
    if (!filterButton) throw new Error('Daily summary filter button missing');
    expect(filterButton.height).toBeLessThanOrEqual(52);
    expect(filterButton.width).toBeLessThan(260);
    expect(box.y).toBeGreaterThanOrEqual(input.y + input.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: testInfo.outputPath(`daily-button-${String(width)}.png`),
    });
  }
});

test('settlement ledger provides responsive direct invoice actions and refreshes balances', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await signIn(page);
  const headers = { Origin: 'http://127.0.0.1:5174' };
  const brandName = `Settlement actions ${testInfo.project.name} ${String(Date.now())}`;
  const brand = z.object({ item: z.object({ id: z.string() }) }).parse(
    await (
      await page.request.post('/api/manage/brands', {
        headers,
        data: { name: brandName, makingCost: 100000 },
      })
    ).json(),
  ).item;
  const created = await page.request.post('/api/manage/settlements', {
    headers,
    data: {
      brandId: brand.id,
      date: '2026-10-27',
      period: 'Ledger actions verification',
      deliveredQty: 2,
      deliveredAmount: 1000000,
      cancelledQty: 0,
      cancelledAmount: 0,
      partialQty: 0,
      partialAmount: 0,
      pendingQty: 0,
      shipping: 0,
      codCharge: 0,
      ads: 0,
      productCost: 0,
      costPerPiece: null,
      agencyBasisPoints: 1500,
    },
  });
  expect(created.status()).toBe(201);
  const item = z
    .object({ item: z.object({ id: z.string(), invoiceNumber: z.string() }) })
    .parse(await created.json()).item;
  await page.goto('/settlements');
  const ledger = page.getByRole('region', {
    name: 'Settlement invoice ledger',
    exact: true,
  });
  const row = ledger.getByRole('row').filter({
    has: page.getByRole('button', { name: item.invoiceNumber, exact: true }),
  });
  await expect(row.getByLabel(`Status for ${item.invoiceNumber}`)).toHaveValue(
    'Unpaid',
  );
  const initialSize = page.viewportSize();
  for (const width of testInfo.project.name === 'desktop'
    ? [1535, 1280, 768]
    : [390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Color theme').selectOption(theme);
      await row.scrollIntoViewIfNeeded();
      await expect(row.locator('.ledger-identity')).toHaveCSS(
        'white-space',
        'nowrap',
      );
      expect(
        await ledger
          .locator('.table-scroll')
          .evaluate((node) => node.scrollWidth - node.clientWidth),
      ).toBeLessThanOrEqual(1);
      const bounds = await row.boundingBox();
      if (!bounds) throw new Error('Settlement row missing');
      for (const action of await row
        .locator('.invoice-row-actions button')
        .all()) {
        const box = await action.boundingBox();
        if (!box) throw new Error('Settlement action missing');
        expect(box.x + box.width).toBeLessThanOrEqual(
          bounds.x + bounds.width + 1,
        );
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(
          `settlement-ledger-${theme}-${String(width)}.png`,
        ),
      });
    }
  }
  if (initialSize) await page.setViewportSize(initialSize);
  await row.getByRole('button', { name: 'View', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.invoice-final')).toContainText('৳150.00');
  await expect(page).toHaveURL(/\/settlements$/);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await row.getByRole('button', { name: 'Payment', exact: true }).click();
  await expect(dialog.locator('.payment-brand')).toContainText(brandName);
  await dialog.getByLabel('Amount (৳)', { exact: true }).fill('100');
  await dialog
    .getByRole('button', { name: 'Record payment', exact: true })
    .click();
  await expect(dialog.getByText(/Paid ৳100/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(row.locator('[data-label="Balance"]')).toHaveText('৳50.00');
  await expect(row.getByLabel(`Status for ${item.invoiceNumber}`)).toHaveValue(
    'Due',
  );
  const downloadEvent = page.waitForEvent('download');
  await row.getByRole('button', { name: 'PDF', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(item.invoiceNumber + '.pdf');
  await download.saveAs(testInfo.outputPath('settlement-ledger.pdf'));
  await expect(page).toHaveURL(/\/settlements$/);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/settlements/${item.id}/edit$`));
  await page.goto('/settlements');
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'View payments', exact: true })
    .click();
  await expect(page).toHaveURL(/\/payments\/brand\//);
  const receiptId = await reverseLinkedReceipt(page, 'settlements', item.id);
  await page.goto('/settlements');
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText(
    'Reversed receipt snapshots remain',
  );
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete settlement', exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await page.goto(`/payments/${receiptId}`);
  await expect(
    page.getByText('Source invoice deleted · historical figures retained', {
      exact: true,
    }),
  ).toBeVisible();
  const historicalDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Download receipt PDF', exact: true })
    .click();
  await (
    await historicalDownload
  ).saveAs(testInfo.outputPath('deleted-source-receipt.pdf'));
  await page
    .getByRole('button', { name: 'Delete receipt', exact: true })
    .click();
  await expect(page.getByRole('alertdialog')).toContainText(
    'permanently removes',
  );
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(
    page.getByText('REVERSED — NOT AN ACTIVE PAYMENT', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Delete receipt', exact: true })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete receipt', exact: true })
    .click();
  await expect(page).toHaveURL(/\/payments\/brand\//);
  expect(
    (await page.request.get(`/api/manage/receipts/${receiptId}`)).status(),
  ).toBe(404);
});

test('all-brand ledger provides direct view, edit, payment, PDF and safe delete actions', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await signIn(page);
  const headers = { Origin: 'http://127.0.0.1:5174' };
  const suffix = String(Date.now());
  const names = ['Actions A ' + suffix, 'Actions B ' + suffix] as const;
  const ids: string[] = [];
  for (const name of names) {
    const brand = z.object({ item: z.object({ id: z.string() }) }).parse(
      await (
        await page.request.post('/api/manage/brands', {
          headers,
          data: { name, makingCost: 100000 },
        })
      ).json(),
    ).item.id;
    const response = await page.request.post('/api/manage/advertising', {
      headers,
      data: {
        brandId: brand,
        date: '2026-10-26',
        period: 'Action test ' + suffix,
        campaigns: [{ name: 'Campaign', amount: 2000000 }],
      },
    });
    ids.push(z.object({ id: z.string() }).parse(await response.json()).id);
  }
  await page.goto('/advertising');
  const ledger = page.getByRole('region', {
    name: 'Advertising invoice ledger',
    exact: true,
  });
  await expect(ledger.getByLabel('Invoice brand')).toHaveValue('');
  const row = ledger
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: names[0], exact: true }) });
  await expect(row).toContainText('৳2,200.00');
  const initialSize = page.viewportSize();
  for (const width of testInfo.project.name === 'desktop'
    ? [1535, 1280, 1024, 768]
    : [390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Color theme').selectOption(theme);
      await row.scrollIntoViewIfNeeded();
      await expect(row.locator('.ledger-identity')).toHaveCSS(
        'white-space',
        'nowrap',
      );
      const box = await row.boundingBox();
      if (!box) throw new Error('Ledger row missing');
      for (const button of await row.getByRole('button').all()) {
        const action = await button.boundingBox();
        if (!action) throw new Error('Ledger action missing');
        expect(action.x).toBeGreaterThanOrEqual(box.x);
        expect(action.x + action.width).toBeLessThanOrEqual(
          box.x + box.width + 1,
        );
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      const scroller = ledger.locator('.table-scroll');
      expect(
        await scroller.evaluate((node) => node.scrollWidth - node.clientWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`ledger-${theme}-${String(width)}.png`),
      });
    }
  }
  if (initialSize) await page.setViewportSize(initialSize);
  await expect(
    ledger.getByRole('cell', { name: names[1], exact: true }),
  ).toBeVisible();
  await row.getByRole('button', { name: 'View', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.invoice-final')).toContainText('৳2,200.00');
  const signature = dialog.locator('.invoice-signature');
  if (await signature.count()) {
    const image = await signature.boundingBox(),
      line = await dialog.locator('.signature-rule').boundingBox();
    expect(image).not.toBeNull();
    expect(line).not.toBeNull();
    if (image && line)
      expect(line.y).toBeGreaterThanOrEqual(image.y + image.height);
  }
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await row.getByRole('button', { name: 'Payment', exact: true }).click();
  await expect(dialog.locator('.payment-brand')).toContainText(names[0]);
  await dialog.getByLabel('Amount (৳)', { exact: true }).fill('100');
  await dialog
    .getByRole('button', { name: 'Record payment', exact: true })
    .click();
  await expect(dialog.getByText(/Paid ৳100/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'PDF', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^ADS-.*\.pdf$/);
  await file.saveAs(testInfo.outputPath('direct-ledger.pdf'));
  await expect(page).toHaveURL(/\/advertising$/);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/advertising/${String(ids[0])}/edit$`),
  );
  await page.goto('/advertising');
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'View payments', exact: true })
    .click();
  await expect(page).toHaveURL(/\/payments\/brand\//);
  const receiptId = await reverseLinkedReceipt(
    page,
    'advertising',
    String(ids[0]),
  );
  await page.goto('/advertising');
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete invoice', exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await expect(
    ledger.getByRole('cell', { name: names[1], exact: true }),
  ).toBeVisible();
  await page.goto(`/payments/${receiptId}`);
  await expect(
    page.getByText('Source invoice deleted · historical figures retained', {
      exact: true,
    }),
  ).toBeVisible();
  const receiptInfo = z
    .object({ item: z.object({ number: z.string() }) })
    .parse(
      await (
        await page.request.get(`/api/manage/receipts/${receiptId}`)
      ).json(),
    );
  await page
    .getByRole('button', { name: 'Back to brand account', exact: true })
    .click();
  const history = page.getByRole('region', {
    name: 'Payment receipt history',
    exact: true,
  });
  const historyRow = history
    .getByRole('row')
    .filter({ hasText: receiptInfo.item.number });
  await historyRow
    .getByRole('button', { name: 'Delete receipt', exact: true })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete receipt', exact: true })
    .click();
  await expect(historyRow).toHaveCount(0);
  expect(
    (await page.request.get(`/api/manage/receipts/${receiptId}`)).status(),
  ).toBe(404);
});

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
  await expect(page.locator('.invoice-final')).toContainText('৳104.20');
  await expect(page.locator('.invoice-document')).toContainText(
    '4 delivered items',
  );
  await expect(page.locator('.invoice-document')).toContainText(
    'Less: delivery charges',
  );
  await expect(page.locator('.invoice-document')).toContainText(
    'Add: advertising VAT',
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
    page.getByRole('heading', {
      name: 'Business Tracking',
    }),
  ).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Internal server error');
  const folder = join(import.meta.dirname, '../../../assets');
  const filenames = existsSync(folder) ? readdirSync(folder) : [];
  const courierFile = filenames.find(
    (name) => name.startsWith('consignments') && name.endsWith('.xlsx'),
  );
  if (courierFile !== undefined) {
    const fixtureRows = await readSheet(
      readFileSync(join(folder, courierFile)),
    );
    const firstOrderId = String(fixtureRows[1]?.[1] ?? '');
    const existingOrders = await page.request.get(
      '/api/manage/business/orders?from=2026-10-01&to=2026-10-31&basis=order&q=' +
        encodeURIComponent(firstOrderId),
    );
    const owner = z
      .object({
        items: z.array(z.object({ id: z.string(), brandId: z.string() })),
      })
      .parse(await existingOrders.json()).items[0]?.brandId;
    const importer = page.locator('.importer');
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

test('daily tracking imports, conserves advertising, paginates twenty orders and finds IDs', async ({
  page,
}, testInfo) => {
  await signIn(page);
  const headers = { Origin: 'http://127.0.0.1:5174' };
  const brandName = 'Daily ' + testInfo.project.name + ' ' + String(Date.now());
  const created = await page.request.post('/api/manage/brands', {
    headers,
    data: { name: brandName, makingCost: 100000 },
  });
  const brandId = z
    .object({ item: z.object({ id: z.string() }) })
    .parse(await created.json()).item.id;
  const corrected = await page.request.post('/api/manage/brands', {
    headers,
    data: { name: brandName + ' corrected', makingCost: 250000 },
  });
  const correctedBrandId = z
    .object({ item: z.object({ id: z.string() }) })
    .parse(await corrected.json()).item.id;
  await page.goto('/business');
  await expect(
    page.getByRole('heading', { name: 'Daily advertising spend' }),
  ).toBeVisible();
  await expect(
    page.getByText('Net profit / loss', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Product Cost Settings', { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('Advertising brand').selectOption(brandId);
  await page.getByLabel('Advertising order date').fill('2026-10-26');
  await page.getByLabel('Total ads spend (৳)').fill('100');
  await page
    .getByRole('button', { name: 'Save daily ad spend', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'Daily advertising saved',
  );
  const importer = page.locator('.importer');
  await importer.getByLabel('Brand', { exact: true }).selectOption(brandId);
  await importer.getByLabel('Import type').selectOption('orders');
  const prefix =
    'daily-' + testInfo.project.name + '-' + String(Date.now()) + '-';
  const sheet =
    'Order ID\tOrder Date\n' +
    Array.from(
      { length: 25 },
      (_, i) => prefix + String(i).padStart(2, '0') + '\t2026-10-26',
    ).join('\n');
  await importer
    .getByLabel('Or paste spreadsheet cells (including headers)')
    .fill(sheet);
  await importer.getByRole('button', { name: 'Preview pasted rows' }).click();
  await importer
    .getByRole('button', { name: 'Confirm & import 25 orders' })
    .click();
  await expect(importer.getByRole('status')).toContainText(
    '25 orders imported',
  );
  await page.getByLabel('Summary brand').selectOption(brandId);
  await page
    .getByRole('button', { name: 'Apply filters', exact: true })
    .click();
  const orders = page.getByRole('region', { name: 'Saved orders' });
  await expect(orders.locator('tbody tr')).toHaveCount(20);
  await expect(orders.locator('tbody')).toContainText('৳4.00');
  await page.getByRole('button', { name: 'Next orders', exact: true }).click();
  await expect(orders.locator('tbody tr')).toHaveCount(5);
  await page
    .getByRole('button', { name: 'Previous orders', exact: true })
    .click();
  await expect(orders.locator('tbody tr')).toHaveCount(20);
  await page.getByLabel('Find Order ID').fill(prefix + '00');
  await page.getByRole('button', { name: 'Find order', exact: true }).click();
  await expect(orders.locator('tbody tr')).toHaveCount(1);
  await expect(orders.locator('tbody')).toContainText(prefix + '00');
  await orders.getByLabel(`Sales amount for ${prefix}00`).fill('175');
  await orders
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect(
    orders.getByRole('button', { name: 'Save changes', exact: true }),
  ).toHaveCount(0);
  await expect(orders.getByLabel(`Sales amount for ${prefix}00`)).toHaveValue(
    '175',
  );
  await expect(
    orders.getByRole('columnheader', { name: 'Product cost', exact: true }),
  ).toBeVisible();
  const before = await page.request.get(
    '/api/manage/business/orders?from=2026-10-01&to=2026-10-31&brandId=' +
      brandId,
  );
  const values = z
    .object({ items: z.array(z.object({ ads: z.number() })) })
    .parse(await before.json()).items;
  expect(values.reduce((sum, row) => sum + row.ads, 0)).toBe(80000);
  const summary = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: brandName, exact: true }) })
    .first();
  await expect(summary).toContainText('25');
  await summary
    .getByRole('button', { name: 'Remove day', exact: true })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(orders.locator('tbody')).toContainText(prefix + '00');
  await page.screenshot({
    path: testInfo.outputPath('business-review.png'),
    fullPage: true,
  });
  await orders
    .getByLabel(`Brand for ${prefix}00`)
    .selectOption(correctedBrandId);
  await orders
    .getByRole('button', { name: 'Save changes', exact: true })
    .click();
  await expect(orders.locator('tbody')).toContainText(
    'No orders match this view.',
  );
  await page.getByLabel('Summary brand').selectOption(correctedBrandId);
  await page
    .getByRole('button', { name: 'Apply filters', exact: true })
    .click();
  await expect(orders.getByLabel(`Sales amount for ${prefix}00`)).toHaveValue(
    '175',
  );
  const moved = z
    .object({
      items: z.array(
        z.object({
          brandId: z.string(),
          quantity: z.number(),
          salesOverride: z.number(),
          costPerPiece: z.number(),
          ads: z.number(),
        }),
      ),
    })
    .parse(
      await (
        await page.request.get(
          '/api/manage/business/orders?from=2026-10-01&to=2026-10-31&q=' +
            prefix +
            '00',
        )
      ).json(),
    );
  expect(moved.items[0]).toMatchObject({
    brandId: correctedBrandId,
    quantity: 1,
    salesOverride: 175000,
    costPerPiece: 250000,
    ads: 0,
  });
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
  await expect(page.locator('.invoice-final')).toContainText('৳330');
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
  const openAccount = page
    .getByRole('row')
    .filter({
      has: page.getByRole('cell', { name: brand, exact: true }),
    })
    .getByRole('button', { name: 'Open account', exact: true });
  await openAccount.click();
  const accountPanel = page.getByRole('region', {
    name: `${brand} account`,
    exact: true,
  });
  await expect(accountPanel).toBeFocused();
  await expect(
    page.getByRole('heading', { name: `${brand} account`, exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole('heading', { name: 'Invoice ledger' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: brand, exact: true }) })
      .getByRole('cell', { name: 'Campaign verification', exact: true }),
  ).toBeVisible();
  const selectedBrandId = await page
    .getByLabel('Payment brand', { exact: true })
    .inputValue();
  let repeatRequests = 0;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname ===
      `/api/manage/advertising/account/${selectedBrandId}`
    )
      repeatRequests++;
  });
  await openAccount.click();
  await expect(accountPanel).toBeFocused();
  await expect(
    page.getByRole('heading', { name: `${brand} account`, exact: true }),
  ).toBeInViewport();
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: brand, exact: true }) })
      .getByRole('cell', { name: 'Campaign verification', exact: true }),
  ).toBeVisible();
  expect(repeatRequests).toBe(0);
  await expect(page.locator('.sidebar a[href="/advertising"]')).toContainText(
    'Advertising',
  );
  await expect(
    page.locator('.sidebar a[href="/advertising"]'),
  ).not.toContainText('accounts');
  let releaseReload: () => void = () => {
    throw new Error('Reload gate was not initialized');
  };
  const reloadGate = new Promise<void>((resolve) => {
    releaseReload = resolve;
  });
  const accountUrl = `**/api/manage/advertising/account/${selectedBrandId}`;
  await page.route(accountUrl, async (route) => {
    await reloadGate;
    await route.continue();
  });
  await accountPanel
    .getByRole('button', { name: 'Reload account', exact: true })
    .click();
  await expect(
    accountPanel.getByRole('button', {
      name: 'Reloading account…',
      exact: true,
    }),
  ).toBeDisabled();
  releaseReload();
  await expect(
    accountPanel.getByRole('button', { name: 'Reload account', exact: true }),
  ).toBeEnabled();
  expect(repeatRequests).toBe(1);
  await page.unroute(accountUrl);
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
        await expect(page.locator('.invoice-image-card')).toHaveCount(5);
        await expect(
          page.locator('.invoice-stamp-settings .invoice-image-card'),
        ).toHaveCount(3);
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
  await expect(page.locator('.invoice-document section tbody tr')).toHaveCount(
    50,
  );
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
        await page.getByLabel('Advertising brand').focus();
        expect
          .soft(
            await contrastFailures(page),
            `${theme} daily advertising controls`,
          )
          .toEqual([]);
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
  const dialog = page.locator('.importer');
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
