import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { z } from 'zod';

const origin = { Origin: 'http://127.0.0.1:5174' };
const created: string[] = [];
const brandResponse = z.object({ item: z.object({ id: z.string() }) });
test.afterEach(async ({ page }) => {
  for (const id of created.splice(0)) {
    expect(
      (
        await page.request.delete(`/api/manage/brands/${id}`, {
          headers: origin,
          data: {},
        })
      ).ok(),
    ).toBe(true);
  }
});
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
test('daily checklist persists per date, reconciles saves and continuously loads brands', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.clock.setFixedTime(new Date('2026-10-31T06:00:00Z'));
  await signIn(page);
  const suffix = crypto.randomUUID().slice(0, 8);
  const names: string[] = [];
  for (let i = 0; i < 23; i++) {
    const name = `000 Checklist ${test.info().project.name === 'mobile' ? '0' : '1'} ${suffix} ${String(i).padStart(2, '0')}`;
    names.push(name);
    const response = await page.request.post('/api/manage/brands', {
      headers: origin,
      data: { name, makingCost: null },
    });
    expect(response.status()).toBe(201);
    created.push(brandResponse.parse(await response.json()).item.id);
  }
  await page.goto('/notes');
  const section = page.getByRole('region', {
    name: 'Daily checklist',
    exact: true,
  });
  const date = page.getByLabel('Checklist date', { exact: true });
  await expect(date).toHaveValue('2026-10-31');
  const scroller = page.getByRole('region', { name: 'Daily checklist brands' });
  const orders = page.getByRole('checkbox', {
    name: `Orders entered for ${names[0] ?? ''}`,
    exact: true,
  });
  const ads = page.getByRole('checkbox', {
    name: `Ad cost entered for ${names[0] ?? ''}`,
    exact: true,
  });
  await expect(orders).toBeVisible();
  await orders.check();
  await expect(orders).toBeEnabled();
  await expect(orders).toBeChecked();
  await ads.check();
  await expect(ads).toBeEnabled();
  await page.reload();
  await expect(orders).toBeChecked();
  await expect(ads).toBeChecked();
  await page.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(date).toHaveValue('2026-10-30');
  await expect(orders).not.toBeChecked();
  await page.getByRole('button', { name: 'Next day', exact: true }).click();
  await expect(orders).toBeChecked();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/manage/daily-checklist/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await gate;
      await route.fulfill({
        status: 503,
        json: { error: 'Connection interrupted' },
      });
    } else await route.continue();
  });
  await orders.uncheck();
  await expect(date).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Previous day', exact: true }),
  ).toBeDisabled();
  release?.();
  await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
  await expect(orders).toBeChecked();
  await page.unroute('**/api/manage/daily-checklist/*');
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(orders).toBeEnabled();
  await expect(orders).not.toBeChecked();
  await expect(ads).toBeChecked();
  // A committed write whose response is lost is reconciled instead of duplicated.
  await page.route('**/api/manage/daily-checklist/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort();
    } else await route.continue();
  });
  await orders.check();
  await expect(orders).toBeEnabled();
  await expect(orders).toBeChecked();
  await expect(page.getByRole('button', { name: 'Retry save' })).toHaveCount(0);
  await page.unroute('**/api/manage/daily-checklist/*');
  const last = page.getByRole('checkbox', {
    name: `Orders entered for ${names[22] ?? ''}`,
    exact: true,
  });
  await expect(async () => {
    if (!(await last.isVisible()))
      await scroller.evaluate((element) => {
        element.scrollTop += element.clientHeight * 0.8;
      });
    await expect(last).toBeVisible();
  }).toPass({ timeout: 20000, intervals: [100, 250] });
  await last.check();
  await expect(last).toBeEnabled();
  const count = Number(await scroller.getAttribute('data-loaded-count'));
  expect(count).toBeGreaterThan(20);
  await date.fill('2026-10-29');
  await expect(date).toHaveValue('2026-10-29');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(orders).toBeChecked();
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
      await expect(orders).toBeVisible();
      if (width === 390)
        await section.screenshot({
          path: `.cloudflare/checklist-${test.info().project.name}-${theme}-phone.png`,
        });
    }
  }
  await section.screenshot({
    path: `.cloudflare/checklist-${test.info().project.name}.png`,
  });
});

test('daily checklist stale tabs preserve the latest state', async ({
  page,
  context,
}) => {
  await signIn(page);
  const name = `! Checklist tabs ${crypto.randomUUID().slice(0, 8)}`;
  const response = await page.request.post('/api/manage/brands', {
    headers: origin,
    data: { name, makingCost: null },
  });
  const brand = z
    .object({ item: z.object({ id: z.string() }) })
    .parse(await response.json());
  created.push(brand.item.id);
  await page.goto('/notes');
  await page.getByLabel('Checklist date', { exact: true }).fill('2026-09-01');
  const other = await context.newPage();
  await other.goto('/notes');
  await other.getByLabel('Checklist date', { exact: true }).fill('2026-09-01');
  const path = `/api/manage/daily-checklist/${brand.item.id}`;
  expect(
    (
      await page.request.patch(path, {
        headers: origin,
        data: {
          date: '2026-09-01',
          task: 'ordersDone',
          done: true,
          revision: 0,
        },
      })
    ).status(),
  ).toBe(200);
  await other
    .getByRole('checkbox', { name: `Ad cost entered for ${name}`, exact: true })
    .check();
  await expect(other.getByRole('button', { name: 'Retry save' })).toBeVisible();
  await expect(
    other.getByRole('checkbox', {
      name: `Orders entered for ${name}`,
      exact: true,
    }),
  ).toBeChecked();
  await other.getByRole('button', { name: 'Retry save' }).click();
  await expect(
    other.getByRole('checkbox', {
      name: `Ad cost entered for ${name}`,
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    other.getByRole('checkbox', {
      name: `Ad cost entered for ${name}`,
      exact: true,
    }),
  ).toBeChecked();
  await other.close();
});
