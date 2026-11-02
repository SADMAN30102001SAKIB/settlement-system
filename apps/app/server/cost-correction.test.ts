import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { app } from './app';
import { testEnvironment } from './test-environment';
import { costCorrectionPreview } from '../shared/cost-correction';
import { previewCostCorrection } from './catalog/cost-correction';

let fixture: Awaited<ReturnType<typeof testEnvironment>>;
let cookie = '';
function request(path: string, body?: unknown) {
  return app.request(
    `/api/manage/${path}`,
    {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    },
    fixture.env,
  );
}
beforeAll(async () => {
  fixture = await testEnvironment();
  const response = await app.request(
    '/api/auth/setup',
    {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'cost correction test password',
        setupToken: fixture.env.ADMIN_SETUP_TOKEN,
      }),
    },
    fixture.env,
  );
  expect(response.status).toBe(201);
  const login = await app.request(
    '/api/auth/login',
    {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'cost correction test password',
      }),
    },
    fixture.env,
  );
  expect(login.status).toBe(200);
  cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
}, 15000);
afterAll(async () => {
  await fixture.runtime.dispose();
});
async function setup() {
  const name = `Costs ${crypto.randomUUID()}`;
  const brand = z
    .object({ item: z.object({ id: z.string() }) })
    .parse(
      await (await request('brands', { name, makingCost: 450000 })).json(),
    ).item;
  const rows = ['Delivered', 'Pending', 'Cancelled', 'Partial Delivered'].map(
    (status) => ({
      id: crypto.randomUUID(),
      status,
      orderDate: '2026-10-20',
      deliveryDate: status === 'Pending' ? null : '2026-10-21',
      quantity: 2,
      partialQuantity: null,
      salesOverride: null,
      codAmount: 1000000,
      shipping: 0,
      codCharge: 0,
    }),
  );
  expect(
    (await request('business/import', { brandId: brand.id, rows })).status,
  ).toBe(200);
  return {
    brand,
    rows,
    input: { name, makingCost: 175000, from: '2026-10-01', to: '2026-10-31' },
  };
}
it('previews and atomically corrects matching costs, preserves invoices and audits the old costs exactly once', async () => {
  const { brand, rows, input } = await setup();
  await request('business/import', {
    brandId: brand.id,
    rows: [{ ...rows[0], id: 'outside-range', orderDate: '2026-09-01' }],
  });
  const saved = await request('settlements', {
    brandId: brand.id,
    date: '2026-10-21',
    period: 'Saved before correction',
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
    productCost: 450000,
    costPerPiece: 450000,
    agencyBasisPoints: 1500,
  });
  expect(saved.status).toBe(201);
  const invoice = await fixture.env.DB.prepare(
    'SELECT product_cost,commission FROM settlements WHERE brand_id=?',
  )
    .bind(brand.id)
    .first();
  const preview = costCorrectionPreview.parse(
    await (await request(`brand-costs/${brand.id}/preview`, input)).json(),
  );
  expect(preview).toMatchObject({
    count: 4,
    deliveredUnits: 2,
    before: 900000,
    after: 350000,
  });
  const payload = {
    ...input,
    requestId: crypto.randomUUID(),
    version: preview.version,
  };
  expect((await request(`brand-costs/${brand.id}`, payload)).status).toBe(200);
  expect((await request(`brand-costs/${brand.id}`, payload)).status).toBe(200);
  expect(
    (
      await request(`brand-costs/${brand.id}`, {
        ...payload,
        makingCost: 200000,
      })
    ).status,
  ).toBe(409);
  const orders = await fixture.env.DB.prepare(
    'SELECT cost_per_piece,revision FROM orders WHERE brand_id=? AND order_date>=?',
  )
    .bind(brand.id, input.from)
    .all();
  expect(orders.results).toHaveLength(4);
  expect(
    orders.results.every(
      (row) => row['cost_per_piece'] === 175000 && row['revision'] === 2,
    ),
  ).toBe(true);
  expect(
    await fixture.env.DB.prepare('SELECT cost_per_piece FROM orders WHERE id=?')
      .bind('outside-range')
      .first(),
  ).toEqual({ cost_per_piece: 450000 });
  expect(
    await fixture.env.DB.prepare(
      'SELECT product_cost,commission FROM settlements WHERE brand_id=?',
    )
      .bind(brand.id)
      .first(),
  ).toEqual(invoice);
  const audit = await fixture.env.DB.prepare(
    'SELECT snapshot,actor FROM order_cost_corrections WHERE id=?',
  )
    .bind(payload.requestId)
    .first<{ snapshot: string; actor: string }>();
  expect(audit?.actor).toBe('admin');
  const snapshot = z
    .object({ orders: z.array(z.object({ id: z.string(), cost: z.number() })) })
    .parse(JSON.parse(audit?.snapshot ?? '{}'));
  expect(snapshot.orders.map((row) => row.id).sort()).toEqual(
    rows.map((row) => row.id).sort(),
  );
  expect(snapshot.orders.every((row) => row.cost === 450000)).toBe(true);
  expect(
    (await request('business/import', { brandId: brand.id, rows })).status,
  ).toBe(200);
  expect(
    await fixture.env.DB.prepare('SELECT cost_per_piece FROM orders WHERE id=?')
      .bind(rows[0]?.id ?? '')
      .first(),
  ).toEqual({ cost_per_piece: 175000 });
}, 15000);

it('rejects stale previews and rolls back changes if an order changes during the write', async () => {
  const { brand, rows, input } = await setup();
  const preview = await previewCostCorrection(fixture.env.DB, brand.id, input);
  await fixture.env.DB.prepare(
    'UPDATE orders SET revision=revision+1 WHERE id=?',
  )
    .bind(rows[0]?.id ?? '')
    .run();
  expect(
    (
      await request(`brand-costs/${brand.id}`, {
        ...input,
        requestId: crypto.randomUUID(),
        version: preview.version,
      })
    ).status,
  ).toBe(409);
  await expect(
    fixture.env.DB.prepare(
      'INSERT INTO order_cost_corrections (id,brand_id,name,making_cost,from_date,to_date,version,snapshot,actor,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        crypto.randomUUID(),
        brand.id,
        input.name,
        input.makingCost,
        input.from,
        input.to,
        preview.version,
        JSON.stringify(preview.snapshot),
        'admin',
        Date.now(),
      )
      .run(),
  ).rejects.toThrow('COST_CORRECTION_STALE');
  expect(
    await fixture.env.DB.prepare('SELECT making_cost FROM brands WHERE id=?')
      .bind(brand.id)
      .first(),
  ).toEqual({ making_cost: 450000 });
  expect(
    await fixture.env.DB.prepare(
      'SELECT COUNT(*) AS count FROM order_cost_corrections WHERE brand_id=?',
    )
      .bind(brand.id)
      .first(),
  ).toEqual({ count: 0 });
  expect(
    (
      await request(`brand-costs/${brand.id}/preview`, {
        ...input,
        from: '2027-01-01',
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await app.request(
        `/api/manage/brand-costs/${brand.id}/preview`,
        {
          method: 'POST',
          headers: {
            Origin: 'http://localhost',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        },
        fixture.env,
      )
    ).status,
  ).toBe(401);
}, 15000);

it('limits corrections and keeps unrelated brands unchanged, including duplicate-name failures', async () => {
  const a = await setup(),
    b = await setup();
  const input = { ...a.input, name: b.input.name };
  const preview = costCorrectionPreview.parse(
    await (await request(`brand-costs/${a.brand.id}/preview`, input)).json(),
  );
  expect(
    (
      await request(`brand-costs/${a.brand.id}`, {
        ...input,
        requestId: crypto.randomUUID(),
        version: preview.version,
      })
    ).status,
  ).toBe(409);
  expect(
    await fixture.env.DB.prepare('SELECT making_cost FROM brands WHERE id=?')
      .bind(a.brand.id)
      .first(),
  ).toEqual({ making_cost: 450000 });
  expect(
    await fixture.env.DB.prepare('SELECT cost_per_piece FROM orders WHERE id=?')
      .bind(b.rows[0]?.id ?? '')
      .first(),
  ).toEqual({ cost_per_piece: 450000 });
  await fixture.env.DB.prepare(
    `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<2001)
    INSERT INTO orders (id,brand_id,order_date,status,quantity,cost_per_piece,cod_amount,shipping,cod_charge,ads,revision,created_at,updated_at)
    SELECT 'bulk-'||x,?,'2026-10-20','Pending',1,450000,0,0,0,0,1,1,1 FROM n`,
  )
    .bind(a.brand.id)
    .run();
  expect(
    (await request(`brand-costs/${a.brand.id}/preview`, a.input)).status,
  ).toBe(422);
}, 15000);
