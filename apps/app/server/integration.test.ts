import { readFileSync, readdirSync } from 'node:fs';
import { URL } from 'node:url';

import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';

import { app } from './app';
import { randomToken } from './auth/crypto';

let runtime: Miniflare;
let env: Env;
let cookie = '';
const setupToken = randomToken();

beforeAll(async () => {
  runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response(null); } };',
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
    r2Buckets: ['FILES'],
  });
  const binding = await runtime.getD1Database('DB');
  const folder = new URL(
    '../../../packages/database/migrations/',
    import.meta.url,
  );
  for (const filename of readdirSync(folder)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    const migration = readFileSync(new URL(filename, folder), 'utf8');
    await binding.batch(
      migration
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .map((statement) => binding.prepare(statement)),
    );
  }
  env = {
    DB: binding,
    FILES: (await runtime.getBindings<Pick<Env, 'FILES'>>()).FILES,
    ADMIN_SETUP_TOKEN: setupToken,
    PASSWORD_PEPPER: randomToken(),
  };
});

afterAll(async () => {
  await runtime.dispose();
});

async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  authenticated = true,
) {
  return app.request(
    path,
    {
      method,
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
        ...(authenticated && cookie ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
  );
}

it('protects setup, issues a private session, and persists/revises a real settlement in local D1', async () => {
  expect((await request('/api/manage/brands')).status).toBe(401);
  expect(
    (
      await request('/api/auth/setup', 'POST', {
        username: 'admin',
        password: 'a long integration test password',
        setupToken: randomToken(),
      })
    ).status,
  ).toBe(403);
  const setup = await request('/api/auth/setup', 'POST', {
    username: 'admin',
    password: 'a long integration test password',
    setupToken,
  });
  expect(setup.status).toBe(201);
  expect(
    (
      await request('/api/auth/setup', 'POST', {
        username: 'other',
        password: 'a long integration test password',
        setupToken,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request('/api/auth/login', 'POST', {
        username: 'admin',
        password: 'wrong',
      })
    ).status,
  ).toBe(401);
  const login = await request('/api/auth/login', 'POST', {
    username: 'admin',
    password: 'a long integration test password',
  });
  expect(login.status).toBe(200);
  const sessionCookie = login.headers.get('Set-Cookie');
  expect(sessionCookie).toContain('HttpOnly');
  expect(sessionCookie).toContain('SameSite=Strict');
  cookie = sessionCookie?.split(';')[0] ?? '';
  expect((await request('/api/auth/me')).status).toBe(200);
  const brandResponse = await request('/api/manage/brands', 'POST', {
    name: 'Test Brand',
    makingCost: 450000,
  });
  expect(brandResponse.status).toBe(201);
  const brands = await env.DB.prepare(
    'SELECT id FROM brands WHERE normalized_name = ? LIMIT 1',
  )
    .bind('test brand')
    .first<{ id: string }>();
  if (brands === null) throw new Error('Brand was not persisted.');
  expect(
    (
      await request('/api/manage/brands', 'POST', {
        name: 'TEST BRAND',
        makingCost: 450000,
      })
    ).status,
  ).toBe(409);
  const input = {
    brandId: brands.id,
    date: '2026-10-26',
    period: 'One day',
    rule: 'v2',
    deliveredQty: 1,
    deliveredAmount: 1280000,
    cancelledQty: 0,
    cancelledAmount: 0,
    partialQty: 0,
    partialAmount: 0,
    pendingQty: 0,
    shipping: 115000,
    codCharge: 12800,
    ads: 100000,
    productCost: 450000,
    costPerPiece: 450000,
    agencyBasisPoints: 1500,
  };
  expect(
    (await request('/api/manage/settlements', 'POST', { ...input, ads: -1 }))
      .status,
  ).toBe(422);
  const saved = await request('/api/manage/settlements', 'POST', input);
  expect(saved.status).toBe(201);
  const row = await env.DB.prepare(
    'SELECT id, invoice_number, net, commission FROM settlements LIMIT 1',
  ).first<{
    id: string;
    invoice_number: string;
    net: number;
    commission: number;
  }>();
  if (row === null) throw new Error('Report was not persisted.');
  expect(row.invoice_number).toBe('HEXA-20261026-001');
  expect(row.net).toBe(602200);
  expect(row.commission).toBe(90330);
  expect((await request(`/api/manage/settlements/${row.id}`)).status).toBe(200);
  const paymentInput = {
    requestId: crypto.randomUUID(),
    target: { kind: 'settlement', targetId: row.id },
    amount: 50000,
    date: '2026-10-26',
    note: 'Bank transfer',
  };
  expect(
    (
      await request('/api/manage/payments', 'POST', {
        ...paymentInput,
        amount: 1,
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await request('/api/manage/payments', 'POST', {
        ...paymentInput,
        target: { kind: 'settlement', targetId: crypto.randomUUID() },
      })
    ).status,
  ).toBe(404);
  const paymentResponse = await request(
    '/api/manage/payments',
    'POST',
    paymentInput,
  );
  expect(paymentResponse.status).toBe(201);
  const payment = z
    .object({ item: z.object({ id: z.uuid() }) })
    .parse(await paymentResponse.json());
  expect(
    (await request('/api/manage/payments', 'POST', paymentInput)).status,
  ).toBe(200);
  expect(
    (
      await request('/api/manage/payments', 'POST', {
        ...paymentInput,
        amount: 100000,
      })
    ).status,
  ).toBe(409);
  const paidDetail = await request(`/api/manage/settlements/${row.id}`);
  expect(
    z
      .object({
        item: z.object({ paid: z.number() }),
        payments: z.array(z.object({ amount: z.number() })),
      })
      .parse(await paidDetail.json()),
  ).toMatchObject({
    item: { paid: 50000 },
    payments: [{ amount: 50000 }],
  });
  const secondReport = await request('/api/manage/settlements', 'POST', {
    ...input,
    period: 'Another settlement',
  });
  expect(secondReport.status).toBe(201);
  const listWithPayments = await request('/api/manage/settlements');
  const ledger = z
    .object({ items: z.array(z.object({ id: z.string(), paid: z.number() })) })
    .parse(await listWithPayments.json());
  expect(ledger.items).toHaveLength(2);
  expect(ledger.items.find((item) => item.id === row.id)?.paid).toBe(50000);
  expect(ledger.items.find((item) => item.id !== row.id)?.paid).toBe(0);
  const revised = await request(`/api/manage/settlements/${row.id}`, 'PUT', {
    ...input,
    ads: 200000,
    revision: 1,
  });
  expect(revised.status).toBe(200);
  expect(
    z
      .object({ item: z.object({ paid: z.number(), revision: z.number() }) })
      .parse(await revised.json()),
  ).toEqual({ item: { paid: 50000, revision: 2 } });
  expect(
    (
      await request(`/api/manage/settlements/${row.id}`, 'PUT', {
        ...input,
        revision: 1,
      })
    ).status,
  ).toBe(409);
  expect(
    (await request(`/api/manage/payments/${payment.item.id}`, 'DELETE', {}))
      .status,
  ).toBe(200);
  const cleared = await request(`/api/manage/settlements/${row.id}`);
  expect(
    z
      .object({ item: z.object({ paid: z.number() }) })
      .parse(await cleared.json()),
  ).toEqual({ item: { paid: 0 } });
  const noteInput = {
    brandId: brands.id,
    period: 'October',
    type: 'Both done',
    content: 'Invoice sent.',
  };
  const noteResponse = await request('/api/manage/notes', 'POST', noteInput);
  expect(noteResponse.status).toBe(201);
  const note = z
    .object({ item: z.object({ id: z.uuid() }) })
    .parse(await noteResponse.json());
  expect(
    (
      await request(`/api/manage/notes/${note.item.id}`, 'PUT', {
        ...noteInput,
        content: 'Payment received.',
      })
    ).status,
  ).toBe(200);
  const noteList = await request('/api/manage/notes');
  expect(
    z
      .object({ items: z.array(z.object({ content: z.string() })) })
      .parse(await noteList.json()),
  ).toEqual({ items: [{ content: 'Payment received.' }] });
  expect(
    (await request(`/api/manage/notes/${note.item.id}`, 'DELETE', {})).status,
  ).toBe(200);
  expect(
    (
      await request(`/api/manage/settlements/${row.id}`, 'DELETE', {
        revision: 1,
      })
    ).status,
  ).toBe(409);
  expect((await request('/api/manage/settlements')).status).toBe(200);
  expect((await request('/api/auth/logout', 'POST', {})).status).toBe(200);
  expect((await request('/api/manage/brands')).status).toBe(401);
}, 15_000);

it('rejects cross-origin mutations before database work', async () => {
  const response = await app.request(
    '/api/auth/login',
    {
      method: 'POST',
      headers: {
        Origin: 'https://untrusted.invalid',
        'Content-Type': 'application/json',
      },
      body: '{}',
    },
    env,
  );
  expect(response.status).toBe(403);
});

it('supports the production-capped password work factor inside the Workers runtime', async () => {
  const worker = new Miniflare({
    modules: true,
    compatibilityDate: '2026-07-30',
    compatibilityFlags: ['nodejs_compat'],
    script: `import { createHmac, pbkdf2 } from 'node:crypto';
      export default { async fetch() {
        const input = createHmac('sha256', 'runtime-test-only-pepper').update('runtime-test-only').digest();
        const length = await new Promise((resolve, reject) => {
          pbkdf2(input, 'test-salt', 100000, 32, 'sha256', (error, key) => {
            if (error) reject(error); else resolve(key.length);
          });
        });
        return new Response(String(length));
      } };`,
  });
  try {
    const response = await worker.dispatchFetch('http://localhost/');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('32');
  } finally {
    await worker.dispose();
  }
});
