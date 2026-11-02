import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { calculateSettlement } from '@settlement/domain/settlement';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { app } from './app';
import { testEnvironment } from './test-environment';
import {
  paymentAccountSchema,
  commissionOutstandingLabel,
} from '../shared/receipts';

let fixture: Awaited<ReturnType<typeof testEnvironment>>;
let cookie = '';
function request(path: string, method = 'GET', body?: unknown) {
  return app.request(
    `/api/manage${path}`,
    {
      method,
      headers: {
        Origin: 'http://localhost',
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    fixture.env,
  );
}
beforeAll(async () => {
  fixture = await testEnvironment();
  const credentials = {
    username: 'vat-admin',
    password: 'vat integration test password',
  };
  await app.request(
    '/api/auth/setup',
    {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...credentials,
        setupToken: fixture.env.ADMIN_SETUP_TOKEN,
      }),
    },
    fixture.env,
  );
  const login = await app.request(
    '/api/auth/login',
    {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    },
    fixture.env,
  );
  cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
}, 15000);
afterAll(async () => {
  await fixture.runtime.dispose();
});
const input = {
  date: '2026-11-02',
  period: 'November',
  rule: 'v3' as const,
  deliveredQty: 1,
  deliveredAmount: 12000000,
  cancelledQty: 0,
  cancelledAmount: 0,
  partialQty: 0,
  partialAmount: 0,
  pendingQty: 0,
  shipping: 0,
  codCharge: 0,
  ads: 2000000,
  productCost: 0,
  costPerPiece: 0,
  agencyBasisPoints: 1500,
};
async function brand() {
  const response = await request('/brands', 'POST', {
    name: `VAT ${crypto.randomUUID()}`,
    makingCost: 0,
  });
  return z
    .object({ item: z.object({ id: z.string() }) })
    .parse(await response.json()).item.id;
}
async function invoice(brandId: string, extra: Record<string, unknown> = {}) {
  const response = await request('/settlements', 'POST', {
    ...input,
    brandId,
    ...extra,
  });
  expect(response.status).toBe(201);
  return z
    .object({
      item: z.object({
        id: z.string(),
        commission: z.number(),
        net: z.number(),
        advertisingVatOnly: z.boolean(),
        revision: z.number(),
      }),
    })
    .parse(await response.json()).item;
}
async function account(brandId: string) {
  return paymentAccountSchema.parse(
    await (await request(`/receipts/account/${brandId}`)).json(),
  );
}

it('bills commission without VAT and advertising with VAT, using saved outstanding rates', async () => {
  const brandId = await brand();
  const first = await invoice(brandId);
  expect(first).toMatchObject({
    commission: 1500000,
    net: 10000000,
    advertisingVatOnly: true,
  });
  const ad = await request('/advertising', 'POST', {
    brandId,
    date: input.date,
    period: input.period,
    vatBasisPoints: 1000,
    campaigns: [{ name: 'Campaign', amount: input.ads }],
  });
  expect(ad.status).toBe(201);
  expect(await account(brandId)).toMatchObject({
    commissionBasisPoints: 1500,
    commission: { billed: 1500000, due: 1500000 },
    ads: { billed: 2200000, due: 2200000 },
  });
  await fixture.env.DB.prepare(
    'UPDATE settings SET agency_basis_points=2000 WHERE id=1',
  ).run();
  expect((await account(brandId)).commissionBasisPoints).toBe(1500);
  const second = await invoice(brandId, { agencyBasisPoints: 2000 });
  expect((await account(brandId)).commissionBasisPoints).toBeNull();
  expect(commissionOutstandingLabel(null)).toBe('Commission outstanding');
  expect(commissionOutstandingLabel(1250)).toBe('12.5% Commission outstanding');
  expect(
    (await request(`/settlements/${second.id}`, 'DELETE', { revision: 1 }))
      .status,
  ).toBe(200);
  expect((await account(brandId)).commissionBasisPoints).toBe(1500);
  expect(
    (await request(`/settlements/${first.id}`, 'DELETE', { revision: 1 }))
      .status,
  ).toBe(200);
  expect(await account(brandId)).toMatchObject({
    commissionBasisPoints: 2000,
    commission: { billed: 0, due: 0 },
  });
});

it('corrects only matching unpaid VAT-added invoices and leaves payments and other historical rules untouched', async () => {
  const brandId = await brand();
  const unpaid = await invoice(brandId, { advertisingVatOnly: false });
  const paid = await invoice(brandId, { advertisingVatOnly: false });
  const receiptBacked = await invoice(brandId, { advertisingVatOnly: false });
  const loss = await invoice(brandId, {
    advertisingVatOnly: false,
    deliveredAmount: 1000000,
  });
  const fractional = await invoice(brandId, {
    advertisingVatOnly: false,
    ads: 290,
  });
  const oldDeducted = await invoice(brandId, {
    advertisingVatOnly: false,
    vatAddedToAgency: false,
  });
  expect(unpaid.commission).toBe(1700000);
  expect(oldDeducted.commission).toBe(1470000);
  const current = await account(brandId);
  const receiptId = crypto.randomUUID();
  expect(
    (
      await request('/receipts', 'POST', {
        requestId: receiptId,
        brandId,
        version: current.version,
        date: input.date,
        method: 'Cash',
        reference: '',
        note: '',
        allocations: [
          { kind: 'commission', invoiceId: receiptBacked.id, amount: 100000 },
        ],
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await request(`/receipts/${receiptId}/reverse`, 'POST', {
        reason: 'Preserve receipt history',
        version: (await account(brandId)).version,
      })
    ).status,
  ).toBe(200);
  const receiptBefore = await (await request(`/receipts/${receiptId}`)).json();
  await fixture.env.DB.prepare(
    "INSERT INTO payments (id,settlement_id,amount,date,note,created_at) VALUES (?,?,100000,'2026-11-02','Historical payment',1)",
  )
    .bind(crypto.randomUUID(), paid.id)
    .run();
  const correction = readFileSync(
    new URL(
      '../../../packages/database/migrations/0017_commission_vat_correction.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await fixture.env.DB.prepare(correction).run();
  const read = (id: string) =>
    fixture.env.DB.prepare(
      'SELECT commission,advertising_vat_only AS advertisingVatOnly,revision FROM settlements WHERE id=?',
    )
      .bind(id)
      .first();
  expect(await read(unpaid.id)).toEqual({
    commission: 1500000,
    advertisingVatOnly: 1,
    revision: 2,
  });
  expect(await read(paid.id)).toEqual({
    commission: 1700000,
    advertisingVatOnly: 0,
    revision: 1,
  });
  expect(await read(oldDeducted.id)).toEqual({
    commission: 1470000,
    advertisingVatOnly: 0,
    revision: 1,
  });
  expect(await read(receiptBacked.id)).toEqual({
    commission: 1700000,
    advertisingVatOnly: 0,
    revision: 1,
  });
  expect(await (await request(`/receipts/${receiptId}`)).json()).toEqual(
    receiptBefore,
  );
  expect(await read(loss.id)).toMatchObject({
    commission: -150000,
    advertisingVatOnly: 1,
  });
  expect(await read(fractional.id)).toMatchObject({
    commission: calculateSettlement({
      ...input,
      ads: 290,
      advertisingVatOnly: true,
    }).commission,
    advertisingVatOnly: 1,
  });
  expect(
    await fixture.env.DB.prepare(
      'SELECT SUM(amount) AS n FROM payments WHERE settlement_id=?',
    )
      .bind(paid.id)
      .first('n'),
  ).toBe(100000);
  expect((await fixture.env.DB.prepare(correction).run()).meta.changes).toBe(0);
  expect(
    (
      await request(`/settlements/${unpaid.id}`, 'PUT', {
        ...input,
        brandId,
        revision: 2,
        advertisingVatOnly: false,
      })
    ).status,
  ).toBe(409);
});
