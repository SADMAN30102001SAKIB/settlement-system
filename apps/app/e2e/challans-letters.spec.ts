import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { paymentAccountSchema } from '../shared/receipts';
import { defaultLetterLayout } from '../shared/letter';
const headers = { Origin: 'http://127.0.0.1:5174' };
async function emptyStyle(cell: Locator) {
  return cell.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      color: style.color,
      lineHeight: style.lineHeight,
    };
  });
}
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
  const emptyChallans = page.getByText('No delivery challans recorded.', {
    exact: true,
  });
  const emptyReceipts = page.getByText(
    'No receipts recorded for this brand yet.',
    { exact: true },
  );
  await expect(emptyChallans).toHaveAttribute('colspan', '5');
  const emptyStyles = new Map<string, Awaited<ReturnType<typeof emptyStyle>>>();
  for (const theme of ['light', 'dark']) {
    await page.locator('html').evaluate((element, value) => {
      element.dataset['theme'] = value;
    }, theme);
    await page.waitForFunction(
      () =>
        !document
          .getAnimations()
          .some((animation) => animation instanceof CSSTransition),
    );
    const style = await emptyStyle(emptyReceipts);
    expect(await emptyStyle(emptyChallans)).toEqual(style);
    emptyStyles.set(theme, style);
  }
  await emptyChallans.screenshot({
    path: info.outputPath('admin-empty-challans.png'),
  });
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
    await owner.route('**/api/portal/challans', async (route) => {
      await route.fulfill({ json: { items: [], next: null } });
    });
    await owner
      .getByRole('button', { name: 'Refresh challans', exact: true })
      .click();
    const ownEmpty = ownHistory.getByText('No delivery challans recorded.', {
      exact: true,
    });
    await expect(ownEmpty).toHaveAttribute('colspan', '4');
    for (const theme of ['light', 'dark']) {
      await owner.locator('html').evaluate((element, value) => {
        element.dataset['theme'] = value;
      }, theme);
      await owner.waitForFunction(
        () =>
          !document
            .getAnimations()
            .some((animation) => animation instanceof CSSTransition),
      );
      expect(await emptyStyle(ownEmpty)).toEqual(emptyStyles.get(theme));
    }
    await ownEmpty.screenshot({
      path: info.outputPath('brand-empty-challans.png'),
    });
    await owner.unroute('**/api/portal/challans');
    await owner
      .getByRole('button', { name: 'Refresh challans', exact: true })
      .click();
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
  await body.press('Control+End');
  await body.press('Shift+Enter');
  await page.keyboard.insertText('PS: Thank you.');
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

test('letter page setup, table controls, images and links survive save and export', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await login(page);
  await page.goto('/manual-invoices');
  const newDraft = async () => {
    await page
      .getByRole('button', { name: 'New invoice', exact: true })
      .click();
    const draft = page.getByRole('dialog', { name: 'New manual invoice' });
    await draft.getByLabel('Document type').selectOption('letter');
    return draft;
  };
  const draft = await newDraft();
  await draft.getByLabel('Document title').fill('Page setup letter');
  const body = draft.getByRole('textbox', { name: 'Letter body' });
  await body.fill('English and বাংলা');
  await body.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await draft.getByLabel('Font family').selectOption('Georgia');
  await draft.getByLabel('Font size').selectOption('18pt');
  await draft.getByLabel('Text alignment').selectOption('center');
  await draft.getByLabel('Line spacing').selectOption('1.5');
  await expect(body.locator('[data-letter-font="Georgia"]')).toBeVisible();
  await draft.getByRole('button', { name: 'Insert link', exact: true }).click();
  const link = page.getByRole('dialog', { name: 'Insert link', exact: true });
  await link.getByLabel('Link address').fill('https://example.com/');
  await link.getByRole('button', { name: 'Apply link' }).click();
  await expect(body.locator('a')).toHaveAttribute(
    'href',
    'https://example.com/',
  );
  await body.press('Control+End');
  await body.press('Enter');
  await draft
    .getByRole('button', { name: 'Insert table', exact: true })
    .click();
  const table = page.getByRole('dialog', { name: 'Insert table', exact: true });
  await table.getByLabel('Rows').fill('3');
  await table.getByLabel('Columns').fill('2');
  await table
    .getByRole('button', { name: 'Insert table', exact: true })
    .click();
  const cells = body.locator('td');
  await expect(cells).toHaveCount(6);
  await cells.first().click();
  await page.keyboard.insertText('Delivery amount');
  const tools = draft.getByRole('toolbar', { name: 'Table tools' });
  await tools
    .getByRole('button', { name: 'Add row below', exact: true })
    .click();
  await expect(cells).toHaveCount(8);
  await tools
    .getByRole('button', { name: 'Add column right', exact: true })
    .click();
  await expect(cells).toHaveCount(12);
  await tools.getByLabel('Table borders').selectOption('dashed');
  await cells.first().click();
  await tools.getByLabel('Row height').selectOption('64');
  await tools.getByLabel('Cell alignment').selectOption('bottom');
  await expect(body.locator('table')).toHaveAttribute(
    'data-letter-border',
    'dashed',
  );
  await body.press('Control+End');
  await draft
    .getByRole('button', { name: 'Insert page break', exact: true })
    .click();
  await body.press('Control+End');
  await page.keyboard.insertText('Second page — ধন্যবাদ');
  const testImage = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable.');
    ctx.fillStyle = '#df3100';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL().split(',')[1] ?? '';
  });
  await draft.locator('input[type="file"]').setInputFiles({
    name: 'test-image.png',
    mimeType: 'image/png',
    buffer: Buffer.from(testImage, 'base64'),
  });
  await expect(body.locator('img[alt="test-image.png"]')).toHaveCount(1);
  await draft.getByRole('button', { name: 'Page setup', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Page setup', exact: true });
  await setup.getByText('Pageless', { exact: true }).click();
  await setup.getByText('Landscape', { exact: true }).click();
  await setup.getByLabel('Paper size').selectOption('Custom');
  await setup.getByLabel('Width (in)').fill('6');
  await setup.getByLabel('Height (in)').fill('9');
  await setup.getByLabel('Top', { exact: true }).fill('0.7');
  await setup.getByLabel('Page color').fill('#f2f3fa');
  await setup.getByRole('button', { name: 'Set as Default' }).click();
  await expect(draft.locator('.letter-pageless')).toBeVisible();
  await draft
    .getByRole('button', { name: 'Save invoice', exact: true })
    .click();
  await expect(draft).toHaveCount(0);
  const preview = page.getByRole('dialog', { name: 'Manual invoice preview' });
  await expect(preview.locator('.letter-sheets-guide')).toContainText(
    '2 pages',
  );
  await expect(preview.locator('.letter-body a')).toHaveAttribute(
    'href',
    'https://example.com/',
  );
  await expect(preview.locator('.letter-body td').first()).toHaveCSS(
    'vertical-align',
    'bottom',
  );
  await expect(preview.locator('.letter-body tr').first()).toHaveAttribute(
    'style',
    /height:\s*64px/,
  );
  await expect(preview.getByText('Second page — ধন্যবাদ')).toHaveCount(1);
  await expect(preview.locator('.invoice-header')).toHaveCount(1);
  await expect(preview.locator('.invoice-footer')).toHaveCount(1);
  await preview.screenshot({
    path: info.outputPath('letter-layout-preview.png'),
  });
  const downloading = page.waitForEvent('download');
  await preview
    .getByRole('button', { name: 'Download PDF', exact: true })
    .click();
  const pdfFile = info.outputPath('letter-custom.pdf');
  await (await downloading).saveAs(pdfFile);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = getDocument({ data: new Uint8Array(readFileSync(pdfFile)) });
  try {
    const document = await pdf.promise;
    expect(document.numPages).toBe(2);
    const sheet = await document.getPage(1);
    expect(sheet.view.slice(2)).toEqual([648, 432]);
    expect(await sheet.getAnnotations()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://example.com/' }),
      ]),
    );
  } finally {
    await pdf.destroy();
  }
  if (info.project.name === 'desktop') {
    await page.evaluate(() => {
      window.print = () => undefined;
    });
    await preview.getByRole('button', { name: 'Print', exact: true }).click();
    const bytes = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      path: info.outputPath('letter-print.pdf'),
    });
    await page.evaluate(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    const printed = getDocument({ data: new Uint8Array(bytes) });
    try {
      const document = await printed.promise;
      expect(document.numPages).toBe(2);
      const first = await document.getPage(1);
      const second = await document.getPage(2);
      expect(first.view[2]).toBeCloseTo(648, 0);
      expect(first.view[3]).toBeCloseTo(432, 0);
      const text = async (sheet: typeof first) =>
        (await sheet.getTextContent()).items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ');
      expect(await text(first)).toContain('Delivery amount');
      expect(await text(second)).toContain('Second page');
    } finally {
      await printed.destroy();
    }
  }
  await preview.getByRole('button', { name: 'Close', exact: true }).click();
  const next = await newDraft();
  await expect(next.locator('.letter-pageless')).toBeVisible();
  await next.getByRole('button', { name: 'Page setup', exact: true }).click();
  await expect(setup.getByLabel('Paper size')).toHaveValue('Custom');
  await expect(setup.getByLabel('Top', { exact: true })).toHaveValue('0.7');
});

test('wide, multi-page letter tables fit the sheet and keep their last row', async ({
  page,
}, info) => {
  test.skip(
    info.project.name === 'mobile',
    'Desktop letter pagination and print',
  );
  test.setTimeout(120000);
  await login(page);
  const title = 'Long delivery table';
  const response = await page.request.post('/api/manage/manual-invoices', {
    headers,
    data: {
      requestId: crypto.randomUUID(),
      kind: 'letter',
      date: '2026-11-26',
      title,
      recipient: '',
      notes: '',
      pageSetup: { ...defaultLetterLayout, size: 'Statement' },
      body: {
        type: 'doc',
        content: [
          {
            type: 'table',
            attrs: { letterBorder: 'solid' },
            content: Array.from({ length: 44 }, (_, index) => ({
              type: 'tableRow',
              attrs: { letterRowHeight: 38 },
              content: [`Delivery ${String(index + 1)}`, '৳ 450.00'].map(
                (text) => ({
                  type: 'tableCell',
                  attrs: { colwidth: [650] },
                  content: [
                    { type: 'paragraph', content: [{ type: 'text', text }] },
                  ],
                }),
              ),
            })),
          },
        ],
      },
    },
  });
  expect(response.status()).toBe(201);
  await page.goto('/manual-invoices');
  await page
    .locator('.document-row')
    .filter({ hasText: title })
    .getByRole('button', { name: 'View / PDF' })
    .click();
  const preview = page.getByRole('dialog', { name: 'Manual invoice preview' });
  await expect(preview.locator('.letter-sheets-guide')).toContainText(
    '3 pages',
  );
  await expect(preview.locator('table')).toHaveAttribute('data-letter-fit', '');
  const rows = preview.locator('tr');
  await expect(rows).toHaveCount(44);
  expect(
    await rows.last().evaluate((row) => {
      const rect = row.getBoundingClientRect();
      const flow = row.closest('.letter-sheet-flow')?.getBoundingClientRect();
      return (
        !!flow &&
        Math.abs(rect.width - flow.width) < 2 &&
        rect.left > flow.right
      );
    }),
  ).toBe(true);
  await page.evaluate(() => {
    window.print = () => undefined;
  });
  await preview.getByRole('button', { name: 'Print', exact: true }).click();
  const bytes = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
    path: info.outputPath('long-table-print.pdf'),
  });
  await page.evaluate(() => {
    window.dispatchEvent(new Event('afterprint'));
  });
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = getDocument({ data: new Uint8Array(bytes) });
  try {
    const document = await pdf.promise;
    expect(document.numPages).toBe(3);
    const last = await document.getPage(3);
    expect(last.view[2]).toBeCloseTo(396, 0);
    const text = (await last.getTextContent()).items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ');
    expect(text).toContain('Delivery 44');
  } finally {
    await pdf.destroy();
  }
});
