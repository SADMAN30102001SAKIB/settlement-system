import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

test('Pathao workbook imports verified rows only after explicit exclusion and confirmation', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const file = join('..', '..', 'assets', 'deliveries_2026-11-13 (1).xlsx');
  test.skip(!existsSync(file), 'Local admin workbook unavailable');
  await page.clock.setFixedTime(new Date('2026-11-13T06:00:00Z'));
  await page.goto('/');
  await expect(page.getByRole('img', { name: 'Hexa logo' })).toBeVisible();
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
  const headers = { Origin: 'http://127.0.0.1:5174' };
  const name = 'Pathao admin workbook validation';
  const existing = z
    .object({ items: z.array(z.object({ id: z.string(), name: z.string() })) })
    .parse(
      await (
        await page.request.get(
          '/api/manage/brands?q=' + encodeURIComponent(name),
        )
      ).json(),
    );
  let id = existing.items.find((brand) => brand.name === name)?.id;
  if (!id) {
    const created = await page.request.post('/api/manage/brands', {
      headers,
      data: { name, makingCost: 175000 },
    });
    expect(created.status()).toBe(201);
    id = z
      .object({ item: z.object({ id: z.string() }) })
      .parse(await created.json()).item.id;
  }
  await page.goto('/business');
  const importer = page.locator('.importer');
  await importer.getByLabel('Brand', { exact: true }).selectOption(id);
  await importer.getByLabel('Courier', { exact: true }).selectOption('pathao');
  await importer.locator('input[type=file]').setInputFiles(file);
  await expect(
    importer.getByText(/191 valid rows · 2 rows need correction/),
  ).toBeVisible();
  const button = importer.getByRole('button', {
    name: 'Confirm & import 191 orders',
    exact: true,
  });
  await expect(button).toBeDisabled();
  await importer
    .getByRole('checkbox', {
      name: 'Import valid orders only; skip 2 flagged rows',
    })
    .check();
  await button.click();
  const confirmation = page.getByRole('alertdialog', {
    name: 'Import valid orders only?',
  });
  await expect(confirmation).toContainText('Daily advertising');
  await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(button).toBeEnabled();
  await button.click();
  const request = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().endsWith('/api/manage/business/import'),
  );
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/manage/business/import'),
    { timeout: 30000 },
  );
  await confirmation
    .getByRole('button', { name: 'Use valid orders only', exact: true })
    .click();
  const payload = z
    .object({
      rows: z.array(
        z.object({ status: z.string(), collectedAmount: z.number() }),
      ),
    })
    .parse((await request).postDataJSON());
  expect((await response).status()).toBe(200);
  expect(payload.rows).toHaveLength(191);
  expect(payload.rows.filter((row) => row.status === 'Pending')).toHaveLength(
    44,
  );
  expect(payload.rows.filter((row) => row.status === 'Delivered')).toHaveLength(
    80,
  );
  expect(
    payload.rows.filter((row) => row.status === 'Partial Delivered'),
  ).toHaveLength(32);
  expect(payload.rows.filter((row) => row.status === 'Cancelled')).toHaveLength(
    35,
  );
  await expect(importer.getByRole('status')).toContainText(
    '191 orders imported',
  );
  await expect(importer.getByRole('status')).toContainText(
    'source rows: 41, 96',
  );
  await page.screenshot({
    path: info.outputPath('import-complete.png'),
    fullPage: true,
  });
  const csvHeader =
    'Order consignment id,Order created at,Collectable Amount,Collected amount,Cod fee,Delivery fee,Order status,Order status updated at';
  const duplicate =
    'duplicate-id,2026-11-13,100,0,0,60,Pickup On Hold,2026-11-13';
  await importer.locator('input[type=file]').setInputFiles({
    name: 'duplicates.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        csvHeader,
        duplicate,
        duplicate,
        duplicate.replace('duplicate-id', 'unique-id'),
      ].join('\n'),
    ),
  });
  await expect(
    importer.getByText(/1 valid rows · 2 rows need correction/),
  ).toBeVisible();
  await expect(importer.getByRole('checkbox')).not.toBeChecked();
  await importer
    .getByRole('button', { name: 'Change source', exact: true })
    .click();
  await importer.locator('input[type=file]').setInputFiles({
    name: 'all-invalid.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([csvHeader, duplicate, duplicate].join('\n')),
  });
  await importer.getByRole('checkbox').check();
  await expect(
    importer.getByRole('button', {
      name: 'Confirm & import 0 orders',
      exact: true,
    }),
  ).toBeDisabled();
});

test('supplied branding renders in both themes and document exports', async ({
  page,
}, info) => {
  await page.goto('/brand/login');
  await expect(page.locator('.portal-header .wordmark')).toHaveText(
    'BRAND PORTAL',
  );
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    for (const theme of ['Light', 'Dark']) {
      await page.getByLabel('Color theme').selectOption({ label: theme });
      const logo = page.getByRole('img', { name: 'Hexa logo' });
      await expect(logo).toBeVisible();
      expect(
        await logo.evaluate(
          (image) =>
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0,
        ),
      ).toBe(true);
      const themeBox = await page.getByLabel('Color theme').boundingBox();
      const signInBox = await page
        .getByRole('link', { name: 'Admin sign-in', exact: true })
        .boundingBox();
      expect(themeBox?.height).toBe(44);
      expect(signInBox?.height).toBe(44);
      expect(
        Math.abs((themeBox?.y ?? -100) - (signInBox?.y ?? 0)),
      ).toBeLessThan(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`brand-login-${theme}-${String(width)}.png`),
        fullPage: true,
      });
    }
  }
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({ short_name: 'Hexa' });
  for (const asset of [
    '/favicon.svg',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
  ])
    expect((await page.request.get(asset)).ok()).toBe(true);
});
