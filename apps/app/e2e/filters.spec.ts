import { test, expect } from '@playwright/test';

test('list filters survive navigation and reload with independent quick date ranges', async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date('2026-10-31T06:00:00Z'));
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
  const cases = [
    {
      route: '/settlements',
      region: 'Settlement invoice ledger',
      from: 'From',
      to: 'To',
      preset: 'previous',
      expected: '2026-09-01',
      end: '2026-09-30',
    },
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
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
    }
  }
  await page.goto('/settlements');
  await expect(page.getByLabel('From', { exact: true })).toHaveValue(
    '2026-09-01',
  );
});
