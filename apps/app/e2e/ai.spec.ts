import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { z } from 'zod';

const password = 'browser-test-long-password';
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill('browser-admin');
  await page.getByLabel('Password', { exact: true }).fill(password);
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
test('AI connections and responsive streaming chat keep credentials private', async ({
  page,
}, testInfo) => {
  await login(page);
  await page.goto('/settings');
  const form = page.locator('.ai-settings');
  await form
    .getByLabel('Gemini API key', { exact: true })
    .fill('browser-test-fake-gemini');
  await form
    .getByLabel('Meta access token', { exact: true })
    .fill('browser-test-fake-meta');
  await form
    .getByLabel('Current administrator password', { exact: true })
    .fill(password);
  await form.getByRole('button', { name: 'Save AI connections' }).click();
  await expect(form.getByRole('status')).toHaveText('AI connections saved.');
  await expect(form.getByLabel('Gemini API key', { exact: true })).toHaveValue(
    '',
  );
  const status = await page.request.get('/api/manage/ai/credentials');
  expect(await status.text()).not.toContain('browser-test-fake');
  await page.goto('/ai-chat');
  await expect(
    page.getByRole('heading', { name: 'Ask about your advertising' }),
  ).toBeVisible();
  let chatId = '';
  await page.route(
    '**/api/manage/ai/conversations/*/messages',
    async (route) => {
      const req = route.request();
      chatId = new URL(req.url()).pathname.split('/')[5] ?? '';
      await route.fulfill({
        contentType: 'text/event-stream',
        body: 'data: {"type":"status","text":"Reading Meta…"}\n\ndata: {"type":"delta","text":"### Verified result\\n\\nSpend is **zero**, not unavailable.\\n\\n| Metric | Value |\\n|---|---|\\n| Spend | 0 |"}\n\ndata: {"type":"done"}\n\n',
      });
    },
  );
  // Keep the fixture response visible while exercising the real conversation creation endpoint.
  await page.route('**/api/manage/ai/conversations/*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const id = new URL(route.request().url()).pathname.split('/')[5] ?? '';
    await route.fulfill({
      json: {
        item: {
          id,
          title: 'My advertising question',
          createdAt: Date.now(),
          revision: 1,
        },
        items: [
          {
            id: crypto.randomUUID(),
            question: 'What was spend yesterday?',
            answer:
              '### Verified result\n\nSpend is **zero**, not unavailable.\n\n| Metric | Value |\n|---|---|\n| Spend | 0 |',
            status: 'complete',
            createdAt: Date.now(),
          },
        ],
        next: null,
      },
    });
  });
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('What was spend yesterday?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Verified result' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Copy response' }),
  ).toBeVisible();
  expect(chatId).not.toBe('');
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset['theme'] = value;
    }, theme);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    const composer = await page.locator('.ai-composer').boundingBox();
    expect(composer?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect(composer?.width ?? Infinity).toBeLessThanOrEqual(
      await page.evaluate(() => innerWidth),
    );
    await page.screenshot({
      path: testInfo.outputPath(`ai-${theme}.png`),
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'What would you like to understand?' }),
  ).toBeVisible();
  const list = z
    .object({ items: z.array(z.object({ id: z.string() })) })
    .parse(
      await (await page.request.get('/api/manage/ai/conversations')).json(),
    );
  expect(list.items.some((c) => c.id === chatId)).toBe(true);
});
