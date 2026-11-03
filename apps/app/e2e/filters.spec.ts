import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
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

test('list filters survive navigation and reload with independent quick date ranges', async ({
  page,
}, info) => {
  await page.clock.setFixedTime(new Date('2026-10-31T06:00:00Z'));
  await signIn(page);
  const cases = [
    {
      route: '/advertising',
      region: 'Advertising invoice ledger',
      from: 'Invoice date from',
      to: 'Invoice date to',
      preset: 'month',
      expected: '2026-10-01',
      end: '2026-10-31',
    },
    {
      route: '/business',
      region: '',
      from: 'From',
      to: 'To',
      preset: 'week',
      expected: '2026-10-25',
      end: '2026-10-31',
    },
  ];
  for (const item of cases) {
    await page.goto(item.route);
    const scope = item.region
      ? page.getByRole('region', { name: item.region, exact: true })
      : page.locator('.business-tracking');
    await scope
      .getByLabel('Quick dates', { exact: true })
      .selectOption(item.preset);
    await expect(scope.getByLabel(item.from, { exact: true })).toHaveValue(
      item.expected,
    );
    await expect(scope.getByLabel(item.to, { exact: true })).toHaveValue(
      item.end,
    );
    await page.goto('/notes');
    await page.goBack();
    await expect(scope.getByLabel(item.from, { exact: true })).toHaveValue(
      item.expected,
    );
    await page.reload();
    await expect(scope.getByLabel(item.to, { exact: true })).toHaveValue(
      item.end,
    );
    for (const width of [320, 768, 1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      const form = scope.locator('.ledger-filters, .business-summary-filters');
      const button = form.getByRole('button', { name: /Apply.*filters/ });
      await button.scrollIntoViewIfNeeded();
      const controls = await form
        .locator('input, select, button')
        .evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { height: rect.height, bottom: rect.bottom };
          }),
        );
      for (const control of controls) expect(control.height).toBe(44);
      if (width === 1600) {
        const bottoms = controls.map((control) => control.bottom);
        expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(1);
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      if (width !== 768)
        await form.screenshot({
          path: info.outputPath(`${item.route.slice(1)}-${String(width)}.png`),
        });
    }
  }
});

test('settlements include all dates with automatic filters and bounded continuous scrolling', async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await signIn(page);
  const headers = { Origin: 'http://127.0.0.1:5174' };
  const brand = z.object({ item: z.object({ id: z.string() }) }).parse(
    await (
      await page.request.post('/api/manage/brands', {
        headers,
        data: { name: `All dates ${crypto.randomUUID()}`, makingCost: 0 },
      })
    ).json(),
  ).item;
  const invoices: string[] = [];
  for (let index = 0; index < 43; index++) {
    const response = await page.request.post('/api/manage/settlements', {
      headers,
      data: {
        brandId: brand.id,
        date: index === 42 ? '2020-01-01' : '2030-01-01',
        period: `All dates ${String(index)}`,
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
        productCost: 0,
        costPerPiece: null,
        agencyBasisPoints: 1500,
      },
    });
    expect(response.status()).toBe(201);
    invoices.push(
      z
        .object({ item: z.object({ invoiceNumber: z.string() }) })
        .parse(await response.json()).item.invoiceNumber,
    );
  }
  await page.evaluate((brandId) => {
    sessionStorage.setItem(
      'hexa-filters:settlements',
      JSON.stringify({
        from: '2026-11-01',
        to: '2026-11-02',
        brand: brandId,
        query: '',
      }),
    );
  }, brand.id);
  const requests: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/manage/settlements') requests.push(url);
  });
  await page.goto('/settlements');
  const ledger = page.getByRole('region', {
    name: 'Settlement invoice ledger',
    exact: true,
  });
  await expect(ledger.locator('input[type="date"]')).toHaveCount(0);
  await expect(ledger.getByLabel('Quick dates')).toHaveCount(0);
  await expect(
    ledger.getByRole('button', { name: 'Apply filters' }),
  ).toHaveCount(0);
  const box = page.getByRole('region', {
    name: 'Settlement invoices',
    exact: true,
  });
  await expect(box).toHaveAttribute('data-loaded-count', '20');
  await box.scrollIntoViewIfNeeded();
  await expect
    .poll(
      async () => {
        await box.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        return box.getAttribute('data-loaded-count');
      },
      { timeout: 15000 },
    )
    .toBe('43');
  await expect
    .poll(async () => {
      await box.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      return box.textContent();
    })
    .toContain('1 Jan 2020');
  expect(await box.locator('tr[data-index]').count()).toBeLessThan(35);
  expect(new Set(requests.map((url) => url.toString())).size).toBe(3);
  expect(
    requests.filter((url) => url.searchParams.has('beforeId')),
  ).toHaveLength(2);
  expect(
    requests.every(
      (url) => !url.searchParams.has('from') && !url.searchParams.has('to'),
    ),
  ).toBe(true);
  await expect(ledger.getByLabel('Brand', { exact: true })).toHaveValue(
    brand.id,
  );
  const search = ledger.getByLabel('Search invoice', { exact: true });
  await search.fill(invoices[42] ?? '');
  await expect(box).toHaveAttribute('data-loaded-count', '1');
  await expect(box).toContainText(invoices[42] ?? '');
  await expect.poll(() => box.evaluate((element) => element.scrollTop)).toBe(0);
  await page.reload();
  await expect(search).toHaveValue(invoices[42] ?? '');
  await expect(box).toHaveAttribute('data-loaded-count', '1');
  await search.fill('DOES-NOT-EXIST');
  await expect(
    ledger.getByText('No matching invoices', { exact: true }),
  ).toBeVisible();
  await search.clear();
  await expect(box).toHaveAttribute('data-loaded-count', '20');
  await ledger.getByLabel('Brand', { exact: true }).selectOption('');
  await expect
    .poll(() => requests.at(-1)?.searchParams.has('brandId'))
    .toBe(false);
  for (const width of [320, 768, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    const filters = ledger.locator('.settlement-filters');
    await filters.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const row = box.locator('tr[data-index]').first();
    const bounds = await row.boundingBox();
    if (!bounds) throw new Error('Settlement row missing');
    for (const action of await row
      .locator('.invoice-row-actions button')
      .all()) {
      const button = await action.boundingBox();
      if (!button) throw new Error('Settlement action missing');
      expect(button.x).toBeGreaterThanOrEqual(bounds.x);
      expect(button.x + button.width).toBeLessThanOrEqual(
        bounds.x + bounds.width + 1,
      );
    }
    await ledger.screenshot({
      path: info.outputPath(`settlement-ledger-${String(width)}.png`),
    });
  }
});
