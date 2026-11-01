import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

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
  await row.getByRole('button', { name: 'Login access', exact: true }).click();
  const access = page.getByRole('dialog');
  await access.getByLabel('Brand username').fill(username);
  await access.getByLabel('New brand password', { exact: true }).fill(password);
  await access
    .getByLabel('Confirm brand password', { exact: true })
    .fill(password);
  await access
    .getByLabel('Your administrator password', { exact: true })
    .fill(adminPassword);
  await access.getByRole('button', { name: 'Save brand access' }).click();
  await expect(access.getByRole('status')).toContainText('Brand access saved');
  await expect(
    access.getByLabel('New brand password', { exact: true }),
  ).toHaveValue('');
  await access.screenshot({ path: testInfo.outputPath('brand-access.png') });
  await access.getByRole('button', { name: 'Done', exact: true }).click();
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
  const username = `admin-${testInfo.project.name}-${String(Date.now())}`,
    password = 'changed browser admin password';
  const oldCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'hexa_session',
  );
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
    await page.getByRole('button', { name: 'Update sign-in details' }).click();
    await expect(page.getByRole('status')).toContainText(
      'Sign-in details updated',
    );
    changed = true;
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
