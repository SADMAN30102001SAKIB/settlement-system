import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const headers = { Origin: 'http://127.0.0.1:5174' };
const baseline = process.env['MOBILE_LAYOUT_BASELINE'] === '1';
const compare = process.env['MOBILE_LAYOUT_COMPARE'] === '1';
const folder = '.cloudflare/mobile-layout-baselines';

async function ready(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  await expect(page.locator('.skeleton').first()).not.toBeVisible();
}

test('mobile admin and brand pages remain readable while desktop stays unchanged', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(360000);
  await page.clock.setFixedTime(new Date('2026-11-08T06:00:00Z'));
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
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post('/api/manage/' + path, {
      headers,
      data,
    });
    expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
    return response.json() as Promise<unknown>;
  };
  const itemId = z.object({ item: z.object({ id: z.string() }) });
  const brand = itemId.parse(
    await post('brands', {
      name: `Mobile review ${info.project.name}`,
      makingCost: 175000,
    }),
  ).item.id;
  const settlement = itemId.parse(
    await post('settlements', {
      brandId: brand,
      date: '2026-11-08',
      period: '20 October – 7 November 2026',
      deliveredQty: 241,
      deliveredAmount: 274531000,
      cancelledQty: 57,
      cancelledAmount: 0,
      partialQty: 50,
      partialAmount: 7925000,
      pendingQty: 43,
      shipping: 34195000,
      codCharge: 2811760,
      ads: 25000000,
      productCost: 42175000,
      costPerPiece: 175000,
      agencyBasisPoints: 1500,
    }),
  ).item.id;
  const ad = z.object({ id: z.string() }).parse(
    await post('advertising', {
      brandId: brand,
      date: '2026-11-08',
      period: '20 October – 7 November 2026',
      vatBasisPoints: 1000,
      campaigns: [
        {
          name: 'Daily advertising campaign — customer acquisition',
          amount: 123456780,
        },
      ],
    }),
  ).id;
  const receipt = itemId.parse(
    await post('receipts/from-payment', {
      requestId: crypto.randomUUID(),
      target: { kind: 'ads', targetId: ad },
      amount: 10000000,
      date: '2026-11-08',
      note: 'Bank transfer — first instalment',
      proofFileId: null,
    }),
  ).item.id;
  await post('notes', {
    brandId: brand,
    period: '20 October – 7 November 2026',
    type: 'Other',
    content:
      'Order import checked. বিজ্ঞাপনের খরচ এবং চালানের তথ্য যাচাই করতে হবে। Follow up with the brand tomorrow.',
  });
  await post('business/import', {
    brandId: brand,
    mode: 'courier',
    rows: Array.from({ length: 25 }, (_, i) => ({
      id: `REVIEW-${info.project.name}-${String(i).padStart(3, '0')}`,
      orderDate: '2026-11-05',
      deliveryDate: '2026-11-07',
      status: 'Delivered',
      quantity: 1,
      partialQuantity: null,
      salesOverride: null,
      codAmount: 1200000,
      shipping: 60000,
      codCharge: 12000,
    })),
  });
  await post('challans', {
    requestId: crypto.randomUUID(),
    brandId: brand,
    date: '2026-11-08',
    quantityMilli: 25000,
    unitCost: 175000,
  });
  for (const kind of ['watermark', 'signature'])
    await post('files/defaults/' + kind, {});
  const manual = itemId.parse(
    await post('manual-invoices', {
      requestId: isMobile
        ? '10000000-0000-4000-8000-000000000002'
        : '10000000-0000-4000-8000-000000000001',
      date: '2026-11-08',
      title: 'Office supplies',
      recipient: 'Hexa Agency studio',
      notes: 'Prepared for office use.',
      stamp: 'Paid',
      lines: [
        {
          description: 'Lighting equipment and installation / লাইটিং সামগ্রী',
          quantityMilli: 2500,
          price: 123456780,
        },
        { description: 'Office supplies', quantityMilli: 1000, price: 125000 },
      ],
    }),
  ).item.id;
  const letter = itemId.parse(
    await post('manual-invoices', {
      requestId: isMobile
        ? '20000000-0000-4000-8000-000000000002'
        : '20000000-0000-4000-8000-000000000001',
      kind: 'letter',
      date: '2026-11-08',
      title: 'Official letter',
      recipient: 'Brand owner',
      notes: '',
      stamp: null,
      lines: [],
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Dear Sir,', marks: [{ type: 'bold' }] },
            ],
          },
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'আপনার সহযোগিতার জন্য ধন্যবাদ। Please review the enclosed statement and contact our office with any questions.',
              },
            ],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'With regards,\nHexa Agency' }],
          },
        ],
      },
    }),
  ).item.id;
  const access = await page.request.put(`/api/manage/brand-access/${brand}`, {
    headers,
    data: {
      username: `review-${info.project.name}`,
      password: 'review brand secure password',
      enabled: true,
      version: 0,
      currentPassword: 'browser-test-long-password',
    },
  });
  expect(access.ok()).toBe(true);
  mkdirSync(folder, { recursive: true });
  const desktopChanges: string[] = [];
  const capture = async (name: string) => {
    await ready(page);
    const width = page.viewportSize()?.width ?? 0;
    const image = await page.screenshot({
      fullPage: isMobile,
      animations: 'disabled',
      caret: 'hide',
    });
    const key = `${info.project.name}-${String(width)}-${name}.png`;
    if (baseline) writeFileSync(join(folder, key), image);
    else {
      writeFileSync(info.outputPath(key), image);
      await info.attach(key, { body: image, contentType: 'image/png' });
      if (compare && !isMobile) {
        const assetAreas = await page
          .locator('.invoice-watermark')
          .evaluateAll((images) =>
            images.map((image) => {
              const box = image.getBoundingClientRect();
              return {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
              };
            }),
          );
        const difference = await page.evaluate(
          async ({ before, after, assetAreas }) => {
            const decode = async (encoded: string) => {
              const image = await createImageBitmap(
                await (await fetch(`data:image/png;base64,${encoded}`)).blob(),
              );
              const canvas = document.createElement('canvas');
              canvas.width = image.width;
              canvas.height = image.height;
              const context = canvas.getContext('2d');
              if (!context) throw new Error('Canvas unavailable');
              context.drawImage(image, 0, 0);
              // Asset loading can differ from the baseline; compare document layout separately.
              for (const area of assetAreas)
                context.clearRect(
                  Math.floor(area.x) - 2,
                  Math.floor(area.y) - 2,
                  Math.ceil(area.width) + 4,
                  Math.ceil(area.height) + 4,
                );
              image.close();
              return context.getImageData(0, 0, canvas.width, canvas.height)
                .data;
            };
            const a = await decode(before),
              b = await decode(after);
            if (a.length !== b.length) return -1;
            let changed = 0;
            for (let i = 0; i < a.length; i++)
              if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > 1) changed++;
            return changed;
          },
          {
            before: readFileSync(join(folder, key)).toString('base64'),
            after: image.toString('base64'),
            assetAreas,
          },
        );
        if (difference !== 0)
          desktopChanges.push(`${key}: ${String(difference)} changed channels`);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${name}: page overflow`,
      ).toBe(true);
      if (isMobile) {
        const broken = await page
          .locator(
            '.scroll-list td[data-label="Date"], td[data-label="Invoice / date"] > small, td[data-label="Receipt / date"] > small, .portal-invoice-table td:first-child > small',
          )
          .evaluateAll((nodes) =>
            nodes
              .filter((node) => {
                const range = document.createRange();
                range.selectNodeContents(node);
                return range.getClientRects().length > 1;
              })
              .map((node) => node.textContent),
          );
        expect(broken, `${name}: wrapped dates`).toEqual([]);
      }
    }
  };
  const sizes = isMobile ? [390, 320, 600] : [1440, 768];
  const routes = [
    ['settlements', '/settlements'],
    ['brands', '/brands'],
    ['notes', '/notes'],
    ['advertising', '/advertising'],
    ['payments', '/payments'],
    ['brand-payments', `/payments/brand/${brand}`],
    ['business', '/business'],
    ['manual', '/manual-invoices'],
    ['files', '/files'],
    ['settings', '/settings'],
    ['account', '/account'],
    ['ai', '/ai-chat'],
    ['editor', '/settlements/new'],
    ['settlement-preview', `/settlements/${settlement}`],
    ['ad-preview', `/advertising/${ad}`],
    ['receipt-preview', `/payments/${receipt}`],
  ];
  for (const width of sizes) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, path] of routes) {
      await page.goto(path ?? '/');
      await capture(name ?? 'page');
    }
    await page.goto('/manual-invoices');
    for (const [id, name] of [
      [manual, 'itemized-preview'],
      [letter, 'letter-preview'],
    ]) {
      const number = z
        .object({ item: z.object({ number: z.string() }) })
        .parse(
          await (
            await page.request.get('/api/manage/manual-invoices/' + (id ?? ''))
          ).json(),
        ).item.number;
      await page
        .locator('.document-row')
        .filter({ hasText: number })
        .getByRole('button', { name: 'View / PDF', exact: true })
        .click();
      await expect(page.locator('.invoice-document')).toBeVisible();
      await capture(name ?? 'manual-preview');
      if (!baseline && isMobile) {
        const preview = page.locator('.document-preview');
        const paper = page.locator('.invoice-document');
        const box = await paper.boundingBox(),
          outer = await preview.boundingBox();
        expect(box).not.toBeNull();
        expect(outer).not.toBeNull();
        expect(Math.abs((box?.width ?? 0) - (outer?.width ?? 0))).toBeLessThan(
          2,
        );
        await page
          .getByRole('button', { name: 'Actual size', exact: true })
          .click();
        expect((await paper.boundingBox())?.width).toBe(794);
        await page
          .getByRole('button', { name: 'Fit to screen', exact: true })
          .click();
        if (width === 390) {
          const download = page.waitForEvent('download');
          await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Download PDF', exact: true })
            .click();
          const path = info.outputPath(`${name ?? 'document'}.pdf`);
          await (await download).saveAs(path);
          const { getDocument } =
            await import('pdfjs-dist/legacy/build/pdf.mjs');
          const task = getDocument({
            data: new Uint8Array(readFileSync(path)),
          });
          try {
            const pdf = await task.promise;
            expect(pdf.numPages).toBe(1);
            const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 });
            expect(viewport.width).toBeCloseTo(595.28, 1);
            expect(viewport.height).toBeCloseTo(841.89, 1);
          } finally {
            await task.destroy();
          }
        }
      }
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Close', exact: true })
        .click();
    }
  }
  await page.request.post('/api/brand-auth/login', {
    headers,
    data: {
      username: `review-${info.project.name}`,
      password: 'review brand secure password',
    },
  });
  for (const width of sizes) {
    await page.setViewportSize({ width, height: 900 });
    for (const kind of ['settlements', 'advertising', 'receipts']) {
      await page.goto(`/brand?type=${kind}`);
      await capture('portal-' + kind);
      await page
        .getByRole('button', { name: 'View invoice', exact: true })
        .first()
        .click();
      await expect(page.locator('.invoice-document')).toBeVisible();
      await capture('portal-' + kind + '-preview');
    }
  }
  if (!baseline && isMobile) {
    await page.setViewportSize({ width: 390, height: 900 });
    for (const [name, path] of routes) {
      await page.goto(path ?? '/');
      await page.locator('html').evaluate((element) => {
        element.dataset['theme'] = 'dark';
      });
      await capture(`dark-${name ?? 'page'}`);
    }
  }
  expect(desktopChanges, 'Desktop screenshot regressions').toEqual([]);
});
