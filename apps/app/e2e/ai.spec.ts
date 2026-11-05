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
  await expect(
    form.getByLabel('Current administrator password', { exact: true }),
  ).toHaveCount(0);
  await expect(form).not.toContainText('application-level encryption');
  await form.getByRole('button', { name: 'Save AI connections' }).click();
  await expect(form.getByRole('status')).toHaveText('AI connections saved.');
  await expect(form.getByLabel('Gemini API key', { exact: true })).toHaveValue(
    '',
  );
  const status = await page.request.get('/api/manage/ai/credentials');
  expect(await status.text()).not.toContain('browser-test-fake');
  await page.evaluate(() => {
    document.documentElement.dataset['aiNavigationMarker'] = 'same-document';
  });
  const menu = page.getByRole('button', {
    name: 'Toggle navigation',
    exact: true,
  });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator('nav')
    .getByRole('link', { name: /AI Chat/ })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Ask about your advertising' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.dataset['aiNavigationMarker'],
    ),
  ).toBe('same-document');
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
  if (await menu.isVisible()) await menu.click();
  await page
    .locator('nav')
    .getByRole('link', { name: /AI Chat/ })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.dataset['aiNavigationMarker'],
    ),
  ).toBe('same-document');
  await expect(
    page.getByRole('textbox', { name: 'Message', exact: true }),
  ).toHaveValue('What was spend yesterday?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Verified result' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Copy response' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Refresh chat', exact: true }),
  ).toHaveCount(0);
  if (await page.locator('.ai-history-toggle').isVisible())
    await page.locator('.ai-history-toggle').click();
  await expect(
    page.getByRole('button', { name: /^Delete chat / }).first(),
  ).toBeVisible();
  if (await page.locator('.ai-history-toggle').isVisible())
    await page.locator('.ai-history-toggle').click();
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
    const edges = await page.evaluate(() => {
      const chat = document.querySelector('.ai-chat')?.getBoundingClientRect();
      const workspace = document
        .querySelector('.workspace-body')
        ?.getBoundingClientRect();
      const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
      return {
        left: chat?.left ?? -1,
        right: chat?.right ?? -1,
        top: chat?.top ?? -1,
        bottom: chat?.bottom ?? -1,
        workspaceLeft: workspace?.left ?? 0,
        workspaceRight: workspace?.right ?? 0,
        topbarBottom: topbar?.bottom ?? 0,
        viewportBottom: innerHeight,
      };
    });
    expect(Math.abs(edges.left - edges.workspaceLeft)).toBeLessThan(1);
    expect(Math.abs(edges.right - edges.workspaceRight)).toBeLessThan(1);
    expect(Math.abs(edges.top - edges.topbarBottom)).toBeLessThan(1);
    expect(Math.abs(edges.bottom - edges.viewportBottom)).toBeLessThan(1);
    const composer = await page.locator('.ai-composer').boundingBox();
    expect(composer?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect(composer?.width ?? Infinity).toBeLessThanOrEqual(
      await page.evaluate(() => innerWidth),
    );
    for (const height of [68, 140]) {
      await page
        .getByRole('textbox', { name: 'Message', exact: true })
        .evaluate((element, value) => {
          element.style.height = `${String(value)}px`;
        }, height);
      const bounds = await page.locator('.ai-composer').evaluate((element) => {
        const input = element
          .querySelector('textarea')
          ?.getBoundingClientRect();
        const button = element.querySelector('button')?.getBoundingClientRect();
        return {
          inputHeight: input?.height ?? 0,
          buttonHeight: button?.height ?? -1,
          inputY: input?.y ?? 0,
          buttonY: button?.y ?? -1,
        };
      });
      expect(Math.abs(bounds.inputHeight - bounds.buttonHeight)).toBeLessThan(
        0.5,
      );
      expect(Math.abs(bounds.inputY - bounds.buttonY)).toBeLessThan(0.5);
    }
    await page
      .getByRole('textbox', { name: 'Message', exact: true })
      .evaluate((element) => {
        element.style.removeProperty('height');
      });
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
  await page.goto('/settings');
  await page
    .locator('.ai-settings')
    .getByRole('button', { name: 'Disconnect', exact: true })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Disconnect', exact: true })
    .click();
  await expect(
    page
      .locator('.ai-settings')
      .getByRole('button', { name: 'Disconnect', exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('.ai-settings')
      .getByLabel('Current administrator password', { exact: true }),
  ).toHaveCount(0);
});
