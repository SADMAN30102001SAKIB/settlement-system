import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { paymentSummarySchema } from '../shared/receipts';
import { money } from '../src/lib/format';

const adminUsername = 'browser-admin';
const adminPassword = 'browser-test-long-password';
const headers = { Origin: 'http://127.0.0.1:5174' };
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-31T06:00:00Z'));
});
async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill(adminUsername);
  await page.getByLabel('Password', { exact: true }).fill(adminPassword);
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

async function checkPasswordButtons(page: Page) {
  for (const control of await page.locator('.password-control').all()) {
    const button = control.getByRole('button');
    await button.scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () =>
        !document
          .getAnimations()
          .some((animation) => animation instanceof CSSTransition),
    );
    const before = await button.boundingBox();
    await button.hover();
    await page.waitForFunction(
      () =>
        !document
          .getAnimations()
          .some((animation) => animation instanceof CSSTransition),
    );
    const hovered = await button.boundingBox();
    expect(Math.abs((hovered?.y ?? -100) - (before?.y ?? 0))).toBeLessThan(0.5);
    await button.click();
    await expect(control.locator('input')).toHaveAttribute('type', 'text');
    await button.hover();
    await page.waitForFunction(
      () =>
        !document
          .getAnimations()
          .some((animation) => animation instanceof CSSTransition),
    );
    const shown = await button.boundingBox();
    expect(Math.abs((shown?.y ?? -100) - (before?.y ?? 0))).toBeLessThan(0.5);
    await button.click();
    await expect(control.locator('input')).toHaveAttribute('type', 'password');
  }
}

test('admin provisions brand access and owners can only view and export their three document types', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180000);
  await signIn(page);
  const suffix = String(Date.now()),
    name = `AAA Owner ${testInfo.project.name} ${suffix}`,
    username = 'owner-' + suffix,
    otherUsername = 'other-owner-' + suffix,
    password = 'owner browser password passphrase',
    replacement = 'replacement owner browser password';
  const makeBrand = async (label: string) => {
    const response = await page.request.post('/api/manage/brands', {
      headers,
      data: { name: label, makingCost: 100000 },
    });
    expect(response.ok()).toBe(true);
    return z
      .object({ item: z.object({ id: z.string() }) })
      .parse(await response.json()).item.id;
  };
  const brandId = await makeBrand(name),
    otherId = await makeBrand('Other owner ' + suffix);
  await page.goto('/brands');
  const row = page.locator('.brand-row').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Login not configured');
  await row.getByRole('button', { name: 'Login access', exact: true }).click();
  const access = page.getByRole('dialog');
  await access.getByLabel('Brand username').fill(username);
  await checkPasswordButtons(page);
  await access.getByLabel('New brand password', { exact: true }).fill(password);
  await access
    .getByLabel('Confirm brand password', { exact: true })
    .fill(password);
  await access
    .getByLabel('Your administrator password', { exact: true })
    .fill(adminPassword);
  await access.getByRole('button', { name: 'Save brand access' }).click();
  await expect(access.getByRole('status')).toContainText('Brand access saved');
  await expect(row).toContainText('Login enabled');
  await expect(
    access.getByLabel('New brand password', { exact: true }),
  ).toHaveValue('');
  await access.screenshot({ path: testInfo.outputPath('brand-access.png') });
  await access.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(row).toContainText('Login enabled');
  expect(
    (
      await page.request.put('/api/manage/brand-access/' + otherId, {
        headers,
        data: {
          username: otherUsername,
          password,
          enabled: true,
          version: 0,
          currentPassword: adminPassword,
        },
      })
    ).ok(),
  ).toBe(true);
  const reportResponse = await page.request.post('/api/manage/settlements', {
    headers,
    data: {
      brandId,
      date: '2026-10-31',
      period: 'Owner October',
      rule: 'v3',
      deliveredQty: 4,
      deliveredUnits: 4,
      deliveredAmount: 600000,
      cancelledQty: 0,
      cancelledAmount: 0,
      partialQty: 0,
      partialAmount: 0,
      pendingQty: 0,
      shipping: 0,
      codCharge: 0,
      ads: 10000,
      productCost: 100000,
      costPerPiece: 25000,
      agencyBasisPoints: 1500,
    },
  });
  expect(reportResponse.ok()).toBe(true);
  const settlement = z
    .object({ item: z.object({ id: z.string(), invoiceNumber: z.string() }) })
    .parse(await reportResponse.json()).item;
  const adsResponse = await page.request.post('/api/manage/advertising', {
    headers,
    data: {
      brandId,
      date: '2026-10-31',
      period: 'Owner ads October',
      campaigns: [{ name: 'Owner campaign', amount: 100000 }],
    },
  });
  const adsId = z.object({ id: z.string() }).parse(await adsResponse.json()).id;
  const ads = z
    .object({ item: z.object({ invoiceNumber: z.string() }) })
    .parse(
      await (await page.request.get('/api/manage/advertising/' + adsId)).json(),
    ).item;
  const foreign = z.object({ id: z.string() }).parse(
    await (
      await page.request.post('/api/manage/advertising', {
        headers,
        data: {
          brandId: otherId,
          date: '2026-10-31',
          period: 'Private other brand',
          campaigns: [{ name: 'Private campaign', amount: 100000 }],
        },
      })
    ).json(),
  ).id;
  const receiptResponse = await page.request.post(
    '/api/manage/receipts/from-payment',
    {
      headers,
      data: {
        requestId: crypto.randomUUID(),
        target: { kind: 'ads', targetId: adsId },
        amount: 20000,
        date: '2026-10-31',
        note: 'Owner receipt',
        proofFileId: null,
      },
    },
  );
  const receipt = z
    .object({ item: z.object({ id: z.string(), number: z.string() }) })
    .parse(await receiptResponse.json()).item;
  for (const kind of ['watermark', 'signature'])
    expect(
      (
        await page.request.post('/api/manage/files/defaults/' + kind, {
          headers,
          data: {},
        })
      ).ok(),
    ).toBe(true);
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:5174',
    viewport: page.viewportSize() ?? { width: 1440, height: 900 },
  });
  const owner = await context.newPage();
  const requests: string[] = [];
  owner.on('request', (request) => {
    requests.push(new URL(request.url()).pathname);
  });
  try {
    await owner.goto('/brand/login');
    await owner.getByLabel('Username', { exact: true }).fill(username);
    await owner
      .getByLabel('Password', { exact: true })
      .fill('incorrect password');
    await owner
      .getByRole('button', { name: 'Sign in to brand portal' })
      .click();
    await expect(owner.getByRole('alert')).toContainText(
      'Incorrect username or password',
    );
    await owner.getByLabel('Password', { exact: true }).fill(password);
    await owner
      .getByRole('button', { name: 'Sign in to brand portal' })
      .click();
    await expect(
      owner.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
    await expect(owner.locator('.sidebar')).toHaveCount(0);
    let failSummary = true;
    await owner.route('**/api/portal/payment-summary', async (route) => {
      if (failSummary) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Temporary balance failure' }),
        });
      } else await route.continue();
    });
    const expectedBalances = async () => {
      const summary = paymentSummarySchema.parse(
        await (
          await page.request.get('/api/manage/receipts/account/' + brandId)
        ).json(),
      );
      return [
        summary.commission.due,
        summary.ads.due,
        summary.commission.paid,
        summary.ads.paid,
      ].map(money);
    };
    const documents = [
      ['Settlement invoices', settlement.invoiceNumber],
      ['Advertising invoices', ads.invoiceNumber],
      ['Payment receipts', receipt.number],
    ] as const;
    for (const theme of ['Light', 'Dark']) {
      await owner.getByLabel('Color theme').selectOption({ label: theme });
      for (const [label, number] of documents) {
        await owner.getByRole('tab', { name: label, exact: true }).click();
        await expect(owner.getByRole('tabpanel')).toContainText(number);
        if (label === 'Payment receipts') {
          if (theme === 'Light') {
            await expect(
              owner.getByRole('button', { name: 'Retry balances' }),
            ).toBeVisible();
            failSummary = false;
            await owner.getByRole('button', { name: 'Retry balances' }).click();
          }
          await expect(
            owner
              .getByRole('region', { name: 'Payment balances' })
              .locator('.metric strong'),
          ).toHaveText(await expectedBalances());
        } else
          await expect(
            owner.getByRole('region', { name: 'Payment balances' }),
          ).toHaveCount(0);
        const invoice = owner.getByRole('row').filter({ hasText: number });
        await invoice
          .getByRole('button', { name: 'View invoice', exact: true })
          .click();
        const preview = owner.getByRole('dialog');
        await expect(preview.locator('.invoice-document')).toBeVisible();
        await expect(
          preview.getByRole('button', {
            name: /Edit report|More actions|Reverse receipt|Delete receipt/,
          }),
        ).toHaveCount(0);
        await expect(preview.getByRole('combobox')).toHaveCount(0);
        await expect(preview.locator('.invoice-watermark')).toHaveAttribute(
          'src',
          /^\/api\/portal\/files\//,
        );
        await expect
          .poll(() =>
            preview
              .locator('.invoice-watermark')
              .evaluate((element: HTMLImageElement) => element.naturalWidth),
          )
          .toBeGreaterThan(0);
        const downloadEvent = owner.waitForEvent('download');
        await preview.getByRole('button', { name: /^Download.*PDF$/ }).click();
        const download = await downloadEvent,
          path = testInfo.outputPath(`${theme}-${number}.pdf`);
        await download.saveAs(path);
        expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
        expect(readFileSync(path).byteLength).toBeGreaterThan(1000);
        await preview.screenshot({
          path: testInfo.outputPath(
            `${theme}-${label.replaceAll(' ', '-')}.png`,
          ),
        });
        await preview
          .getByRole('button', { name: 'Close', exact: true })
          .click();
      }
      expect(
        await owner.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      ).toBe(false);
      await owner.screenshot({
        path: testInfo.outputPath(`portal-${theme}.png`),
        fullPage: true,
      });
    }
    expect(
      (
        await page.request.post('/api/manage/receipts/from-payment', {
          headers,
          data: {
            requestId: crypto.randomUUID(),
            target: { kind: 'ads', targetId: adsId },
            amount: 10000,
            date: '2026-10-31',
            note: 'Refresh balances',
            proofFileId: null,
          },
        })
      ).ok(),
    ).toBe(true);
    await owner.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      owner
        .getByRole('region', { name: 'Payment balances' })
        .locator('.metric strong'),
    ).toHaveText(await expectedBalances());
    expect(
      requests.some(
        (path) =>
          path.startsWith('/api/manage/') || path === '/api/auth/account',
      ),
    ).toBe(false);
    expect(
      (
        await owner.request.get('/api/portal/invoices/advertising/' + foreign)
      ).status(),
    ).toBe(404);
    expect((await owner.request.get('/api/manage/bootstrap')).status()).toBe(
      401,
    );
    await page.goto('/brands');
    await row
      .getByRole('button', { name: 'Login access', exact: true })
      .click();
    await access.getByLabel('Allow brand sign-in').uncheck();
    await access
      .getByLabel('Your administrator password', { exact: true })
      .fill(adminPassword);
    await access.getByRole('button', { name: 'Save brand access' }).click();
    await expect(access.getByRole('status')).toContainText(
      'Brand access disabled',
    );
    await expect(row).toContainText('Login disabled');
    await owner.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      owner.getByRole('button', { name: 'Sign in to brand portal' }),
    ).toBeVisible();
    await access.getByLabel('Allow brand sign-in').check();
    await access
      .getByLabel('New brand password', { exact: true })
      .fill(replacement);
    await access
      .getByLabel('Confirm brand password', { exact: true })
      .fill(replacement);
    await access
      .getByLabel('Your administrator password', { exact: true })
      .fill(adminPassword);
    await access.getByRole('button', { name: 'Save brand access' }).click();
    await expect(access.getByRole('status')).toContainText(
      'Brand access saved',
    );
    await owner.getByLabel('Username', { exact: true }).fill(username);
    await owner.getByLabel('Password', { exact: true }).fill(password);
    await owner
      .getByRole('button', { name: 'Sign in to brand portal' })
      .click();
    await expect(owner.getByRole('alert')).toContainText(
      'Incorrect username or password',
    );
    await owner.getByLabel('Password', { exact: true }).fill(replacement);
    await owner
      .getByRole('button', { name: 'Sign in to brand portal' })
      .click();
    await expect(
      owner.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
    await owner.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(owner.getByLabel('Username', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('administrator changes username/password without losing data and can sign in with the new credentials', async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await signIn(page);
  await page.goto('/account');
  await expect(
    page.getByLabel('Current password', { exact: true }),
  ).toBeVisible();
  await checkPasswordButtons(page);
  const username = `admin-${testInfo.project.name}-${String(Date.now())}`,
    password = 'changed browser admin password';
  const oldCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'hexa_session',
  );
  const staleTab = await page.context().newPage();
  await staleTab.goto('/account');
  await expect(
    staleTab.getByLabel('Current password', { exact: true }),
  ).toBeVisible();
  let changed = false,
    restored = false;
  try {
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page
      .getByLabel('Current password', { exact: true })
      .fill(adminPassword);
    await page.getByLabel('New password', { exact: true }).fill(password);
    await page
      .getByLabel('Confirm new password', { exact: true })
      .fill(password + ' mismatch');
    await page.getByRole('button', { name: 'Update sign-in details' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'New passwords do not match',
    );
    await page
      .getByLabel('Confirm new password', { exact: true })
      .fill(password);
    await page
      .getByLabel('Current password', { exact: true })
      .fill('incorrect password');
    await page.getByRole('button', { name: 'Update sign-in details' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Current password is incorrect',
    );
    await page
      .getByLabel('Current password', { exact: true })
      .fill(adminPassword);
    await page.route('**/api/auth/account', async (route) => {
      if (route.request().method() === 'PUT')
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Temporary account save failure' }),
        });
      else await route.continue();
    });
    await page.getByRole('button', { name: 'Update sign-in details' }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Temporary account save failure',
    );
    await expect(page.getByLabel('Username', { exact: true })).toHaveValue(
      username,
    );
    expect((await page.request.get('/api/manage/bootstrap')).status()).toBe(
      200,
    );
    await page.unroute('**/api/auth/account');
    await page.getByRole('button', { name: 'Update sign-in details' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Sign-in details updated',
    );
    changed = true;
    await staleTab
      .getByLabel('Username', { exact: true })
      .fill('stale-tab-change');
    await staleTab
      .getByLabel('Current password', { exact: true })
      .fill(password);
    await staleTab
      .getByRole('button', { name: 'Update sign-in details' })
      .click();
    await expect(staleTab.getByRole('alert')).toContainText(
      'Your account changed',
    );
    const currentAccount = z
      .object({ item: z.object({ username: z.string() }) })
      .parse(await (await page.request.get('/api/auth/account')).json());
    expect(currentAccount.item.username).toBe(username);
    await expect(
      page.getByLabel('Current password', { exact: true }),
    ).toHaveValue('');
    await page.screenshot({
      path: testInfo.outputPath('account-settings.png'),
      fullPage: true,
    });
    if (oldCookie)
      expect(
        (
          await page.request.get('/api/manage/bootstrap', {
            headers: { Cookie: oldCookie.name + '=' + oldCookie.value },
          })
        ).status(),
      ).toBe(401);
    await page.request.post('/api/auth/logout', { headers, data: {} });
    await page.goto('/');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page
      .getByRole('button', { name: 'Sign in to workspace', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'The numbers, in focus.' }),
    ).toBeVisible();
    await page.goto('/account');
    await page.getByLabel('Username', { exact: true }).fill(adminUsername);
    await page.getByLabel('Current password', { exact: true }).fill(password);
    await page.getByLabel('New password', { exact: true }).fill(adminPassword);
    await page
      .getByLabel('Confirm new password', { exact: true })
      .fill(adminPassword);
    await page.getByRole('button', { name: 'Update sign-in details' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Sign-in details updated',
    );
    restored = true;
  } finally {
    await staleTab.close();
    if (changed && !restored) {
      await page.request.post('/api/auth/login', {
        headers,
        data: { username: username, password },
      });
      const profile = z
        .object({ item: z.object({ version: z.number() }) })
        .parse(await (await page.request.get('/api/auth/account')).json()).item;
      expect(
        (
          await page.request.put('/api/auth/account', {
            headers,
            data: {
              username: adminUsername,
              currentPassword: password,
              password: adminPassword,
              version: profile.version,
            },
          })
        ).ok(),
      ).toBe(true);
    }
  }
});

async function createTestBrand(page: Page, name: string) {
  const response = await page.request.post('/api/manage/brands', {
    headers,
    data: { name, makingCost: 100000 },
  });
  expect(response.status()).toBe(201);
  return z
    .object({ item: z.object({ id: z.string() }) })
    .parse(await response.json()).item.id;
}
async function configureTestBrand(
  page: Page,
  brandId: string,
  username: string,
  password: string,
  version = 0,
) {
  const response = await page.request.put(
    '/api/manage/brand-access/' + brandId,
    {
      headers,
      data: {
        username,
        password,
        version,
        enabled: true,
        currentPassword: adminPassword,
      },
    },
  );
  expect(response.status()).toBe(200);
}
async function ownerSignIn(page: Page, username: string, password: string) {
  await page.goto('/brand/login');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in to brand portal' }).click();
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
}

test('brand access rejects duplicates and safely recovers from failed saves and lost responses', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  await signIn(page);
  const suffix = `${testInfo.project.name}-${String(Date.now())}`;
  const first = await createTestBrand(page, 'AAA Edge original ' + suffix);
  const name = 'AAA Edge recovery ' + suffix;
  const second = await createTestBrand(page, name);
  const password = 'edge browser brand password passphrase';
  const username = 'edge-original-' + suffix,
    replacement = 'edge-recovery-' + suffix;
  await configureTestBrand(page, first, username, password);
  await page.goto('/brands');
  const row = page.locator('.brand-row').filter({ hasText: name });
  await row.getByRole('button', { name: 'Login access', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Brand username').fill(username);
  await dialog.getByLabel('New brand password', { exact: true }).fill(password);
  await dialog
    .getByLabel('Confirm brand password', { exact: true })
    .fill(password);
  await dialog
    .getByLabel('Your administrator password', { exact: true })
    .fill(adminPassword);
  const save = dialog.getByRole('button', { name: 'Save brand access' });
  const stored = async () =>
    z
      .object({
        item: z.object({
          username: z.string(),
          enabled: z.boolean(),
          version: z.number(),
        }),
      })
      .parse(
        await (
          await page.request.get('/api/manage/brand-access/' + second)
        ).json(),
      ).item;
  await save.click();
  await expect(dialog.getByRole('alert')).toContainText('already assigned');
  expect((await stored()).version).toBe(0);
  await dialog.getByLabel('Brand username').fill(replacement);
  const path = '**/api/manage/brand-access/' + second;
  await page.route(path, async (route) => {
    if (route.request().method() === 'PUT')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary save failure' }),
      });
    else await route.continue();
  });
  await save.click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Temporary save failure',
  );
  await expect(dialog.getByLabel('Brand username')).toHaveValue(replacement);
  await expect(
    dialog.getByLabel('New brand password', { exact: true }),
  ).toHaveValue(password);
  expect((await stored()).version).toBe(0);
  await page.unroute(path);
  await page.route(path, async (route) => {
    if (route.request().method() === 'PUT') await route.abort('failed');
    else await route.continue();
  });
  await save.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(save).toBeEnabled();
  expect((await stored()).version).toBe(0);
  await page.unroute(path);
  await page.route(path, async (route) => {
    if (route.request().method() === 'PUT') {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort('failed');
    } else await route.continue();
  });
  await save.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(save).toBeEnabled();
  expect(await stored()).toEqual({
    username: replacement,
    enabled: true,
    version: 1,
  });
  await page.unroute(path);
  await save.click();
  await expect(dialog.getByRole('alert')).toContainText('Brand access changed');
  await dialog.getByRole('button', { name: 'Reload access' }).click();
  await expect(dialog.getByLabel('Brand username')).toHaveValue(replacement);
  await expect(
    dialog.getByLabel('New brand password', { exact: true }),
  ).toHaveValue('');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(row).toContainText('Login enabled');
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:5174',
  });
  try {
    const owner = await context.newPage();
    await ownerSignIn(owner, replacement, password);
    await expect(
      owner.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('brand portal handles empty and large ledgers, reset across tabs, and expired cookies', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240000);
  await signIn(page);
  const suffix = `${testInfo.project.name}-${String(Date.now())}`;
  const name = 'AAA Large portal ' + suffix;
  const brandId = await createTestBrand(page, name),
    other = await createTestBrand(page, 'Other private ledger ' + suffix);
  const username = 'large-owner-' + suffix,
    password = 'large owner browser password passphrase',
    replacement = 'reset large owner browser password';
  await configureTestBrand(page, brandId, username, password);
  const foreign = await page.request.post('/api/manage/advertising', {
    headers,
    data: {
      brandId: other,
      date: '2026-10-31',
      period: 'Foreign private invoice',
      campaigns: [{ name: 'Foreign campaign', amount: 100000 }],
    },
  });
  expect(foreign.status()).toBe(201);
  const context = await browser.newContext({
    baseURL: 'http://127.0.0.1:5174',
    viewport: page.viewportSize() ?? { width: 1440, height: 900 },
  });
  try {
    const owner = await context.newPage();
    await ownerSignIn(owner, username, password);
    const categories = [
      ['Settlement invoices', 'settlements'],
      ['Advertising invoices', 'advertising'],
      ['Payment receipts', 'receipts'],
    ] as const;
    for (const [label] of categories) {
      await owner.getByRole('tab', { name: label, exact: true }).click();
      await expect(owner.getByRole('tabpanel')).toContainText(
        `No ${label.toLowerCase()} have been shared`,
      );
    }
    await expect(
      owner
        .getByRole('region', { name: 'Payment balances' })
        .locator('.metric strong'),
    ).toHaveText(['৳0.00', '৳0.00', '৳0.00', '৳0.00']);
    for (let index = 0; index < 45; index++) {
      const [settlement, ads] = await Promise.all([
        page.request.post('/api/manage/settlements', {
          headers,
          data: {
            brandId,
            date: '2026-10-31',
            period: `Large ledger ${String(index)}`,
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
            productCost: 100000,
            costPerPiece: 100000,
            agencyBasisPoints: 1500,
          },
        }),
        page.request.post('/api/manage/advertising', {
          headers,
          data: {
            brandId,
            date: '2026-10-31',
            period: `Large ledger ${String(index)}`,
            campaigns: [{ name: 'Campaign', amount: 100000 }],
          },
        }),
      ]);
      expect(settlement.status()).toBe(201);
      expect(ads.status()).toBe(201);
      const adId = z.object({ id: z.string() }).parse(await ads.json()).id;
      const receipt = await page.request.post(
        '/api/manage/receipts/from-payment',
        {
          headers,
          data: {
            requestId: crypto.randomUUID(),
            target: { kind: 'ads', targetId: adId },
            amount: 10000,
            date: '2026-10-31',
            note: 'Large portal receipt',
            proofFileId: null,
          },
        },
      );
      expect(receipt.status()).toBe(201);
    }
    for (const [label, kind] of categories) {
      await owner.getByRole('tab', { name: label, exact: true }).click();
      await owner.getByRole('button', { name: 'Refresh', exact: true }).click();
      const list = owner.getByRole('region', { name: label, exact: true });
      await expect(list).toHaveAttribute('data-loaded-count', '20');
      await list.scrollIntoViewIfNeeded();
      await expect(async () => {
        await list.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await expect(list).toHaveAttribute('data-loaded-count', '45', {
          timeout: 500,
        });
        await expect(list.locator('tr[data-index="44"]')).toBeVisible({
          timeout: 500,
        });
      }).toPass({ timeout: 20000, intervals: [100, 250] });
      expect(await list.locator('tr[data-index]').count()).toBeLessThan(35);
      await expect(list).not.toContainText('Foreign private invoice');
      const ids = new Set<string>();
      let cursor = '';
      for (let batch = 0; batch < 3; batch++) {
        const response = await owner.request.get(
          '/api/portal/invoices?kind=' + kind + cursor,
        );
        const result = z
          .object({
            items: z.array(z.object({ id: z.string() })),
            next: z
              .object({ before: z.string(), beforeId: z.string() })
              .nullable(),
          })
          .parse(await response.json());
        result.items.forEach((item) => ids.add(item.id));
        cursor = result.next
          ? '&' + new URLSearchParams(result.next).toString()
          : '';
      }
      expect(ids.size).toBe(45);
      expect(cursor).toBe('');
    }
    const secondTab = await context.newPage();
    await secondTab.goto('/brand');
    await expect(
      secondTab.getByRole('heading', { name, exact: true }),
    ).toBeVisible();
    await configureTestBrand(page, brandId, username, replacement, 1);
    for (const tab of [owner, secondTab]) {
      await tab.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(
        tab.getByRole('button', { name: 'Sign in to brand portal' }),
      ).toBeVisible();
      await expect(tab.getByRole('tabpanel')).toHaveCount(0);
    }
    await owner.getByLabel('Username', { exact: true }).fill(username);
    await owner.getByLabel('Password', { exact: true }).fill(password);
    await owner
      .getByRole('button', { name: 'Sign in to brand portal' })
      .click();
    await expect(owner.getByRole('alert')).toContainText(
      'Incorrect username or password',
    );
    await ownerSignIn(owner, username, replacement);
    const cookie = (await context.cookies()).find(
      (item) => item.name === 'hexa_brand_session',
    );
    expect(cookie).toBeDefined();
    if (!cookie) throw new Error('Brand cookie missing');
    await context.addCookies([
      { ...cookie, expires: Math.floor(Date.now() / 1000) - 1 },
    ]);
    await owner.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(
      owner.getByRole('button', { name: 'Sign in to brand portal' }),
    ).toBeVisible();
    expect(
      (
        await owner.request.get('/api/portal/invoices?kind=settlements')
      ).status(),
    ).toBe(401);
    await expect(owner.getByRole('tabpanel')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
