import { afterAll, beforeAll, expect, it } from 'vitest';
import { app } from './app';
import { testEnvironment } from './test-environment';
import { paymentAccountSchema, receiptSchema } from '../shared/receipts';
import { z } from 'zod';

let fixture: Awaited<ReturnType<typeof testEnvironment>>,
  cookie = '';
beforeAll(async () => {
  fixture = await testEnvironment();
  const response = await request('/api/auth/setup', 'POST', {
    username: 'admin',
    password: 'receipts integration password',
    setupToken: fixture.env.ADMIN_SETUP_TOKEN,
  });
  expect(response.status).toBe(201);
  const login = await request('/api/auth/login', 'POST', {
    username: 'admin',
    password: 'receipts integration password',
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
}, 15000);
afterAll(async () => {
  await fixture.runtime.dispose();
});

it('persists all five invoice labels without changing financial records or locking receipt-backed metadata', async () => {
  const source = await seed();
  const before = await account(source.brandId);
  const receipt = await create(await inputFor(source));
  const current = await account(source.brandId);
  for (const status of ['Unpaid', 'Paid', 'Due', 'Advance', 'N/A']) {
    for (const [kind, id] of [
      ['settlement', source.settlementId],
      ['ads', source.adId],
    ] as const) {
      expect(
        (
          await request(`/api/manage/invoice-status/${kind}/${id}`, 'PUT', {
            status,
          })
        ).status,
      ).toBe(200);
    }
    const settlement = await request(
      `/api/manage/settlements/${source.settlementId}`,
    );
    expect(
      z
        .object({ item: z.object({ statusOverride: z.string() }) })
        .parse(await settlement.json()).item.statusOverride,
    ).toBe(status);
    const ad = await request(`/api/manage/advertising/${source.adId}`);
    expect(
      z
        .object({ item: z.object({ statusOverride: z.string() }) })
        .parse(await ad.json()).item.statusOverride,
    ).toBe(status);
    expect(await account(source.brandId)).toEqual(current);
  }
  expect(before.version).toBeLessThan(current.version);
  const snapshot = z
    .object({ item: receiptSchema })
    .parse(
      await (await request(`/api/manage/receipts/${receipt.id}`)).json(),
    ).item;
  expect(snapshot.data).toEqual(receipt.data);
  expect(
    (
      await request(
        `/api/manage/invoice-status/ads/${crypto.randomUUID()}`,
        'PUT',
        { status: 'Paid' },
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await request(`/api/manage/invoice-status/ads/${source.adId}`, 'PUT', {
        status: 'Unknown',
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await request(`/api/manage/invoice-status/ads/${source.adId}`, 'PUT', {
        status: 'Paid',
        total: 0,
      })
    ).status,
  ).toBe(422);
}, 15000);

it('saves a separate receipt stamp choice without changing allocations, receipt state or historical figures', async () => {
  const source = await seed(),
    input = await inputFor(source);
  const receipt = await create({ ...input, stampStatus: 'Unpaid' });
  expect(receipt.stampStatus).toBe('Unpaid');
  const balances = await account(source.brandId);
  for (const status of ['Paid', 'Unpaid', 'Due']) {
    expect(
      (
        await request(`/api/manage/receipts/${receipt.id}/stamp`, 'PUT', {
          status,
        })
      ).status,
    ).toBe(200);
    const updated = z
      .object({ item: receiptSchema })
      .parse(
        await (await request(`/api/manage/receipts/${receipt.id}`)).json(),
      ).item;
    expect(updated.stampStatus).toBe(status);
    expect(updated.data).toEqual(receipt.data);
    expect(updated.total).toBe(receipt.total);
    expect(updated.reversedAt).toBeNull();
    expect(await account(source.brandId)).toEqual(balances);
  }
  for (const status of ['Advance', 'N/A', 'Recorded', 'Reversed']) {
    expect(
      (
        await request(`/api/manage/receipts/${receipt.id}/stamp`, 'PUT', {
          status,
        })
      ).status,
    ).toBe(422);
  }
  expect(
    (
      await request(`/api/manage/receipts/${receipt.id}/reverse`, 'POST', {
        reason: 'Correction test',
        version: balances.version,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(`/api/manage/receipts/${receipt.id}/stamp`, 'PUT', {
        status: 'Paid',
      })
    ).status,
  ).toBe(409);
}, 15000);

it('uploads, replaces and deletes private stamp artwork without breaking settings references', async () => {
  const bytes = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    ),
    (char) => char.charCodeAt(0),
  );
  for (const kind of ['paid', 'unpaid', 'due']) {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await app.request(
        `/api/manage/files/stamp-${kind}`,
        {
          method: 'POST',
          headers: {
            Origin: 'http://localhost',
            Cookie: cookie,
            'Content-Type': 'application/octet-stream',
            'X-File-Name': `${kind}.png`,
          },
          body: bytes,
        },
        fixture.env,
      );
      expect(response.status).toBe(201);
      ids.push(z.object({ id: z.string() }).parse(await response.json()).id);
    }
    const previous = ids[0],
      current = ids[1];
    if (!previous || !current) throw new Error('Missing uploaded stamp');
    const settings = await (await request('/api/manage/settings')).json();
    expect(
      z.object({ item: z.record(z.string(), z.unknown()) }).parse(settings)
        .item[`${kind}StampFileId`],
    ).toBe(current);
    expect((await request(`/api/manage/files/${previous}`)).status).toBe(200);
    expect(
      (await request(`/api/manage/files/${previous}`, 'DELETE', {})).status,
    ).toBe(200);
    expect(
      (await request(`/api/manage/files/${current}`, 'DELETE', {})).status,
    ).toBe(200);
    const updated = z
      .object({ item: z.record(z.string(), z.unknown()) })
      .parse(await (await request('/api/manage/settings')).json());
    expect(updated.item[`${kind}StampFileId`]).toBeNull();
  }
  expect(
    (await fixture.env.DB.prepare('PRAGMA foreign_key_check').all()).results,
  ).toHaveLength(0);
}, 15000);
function request(path: string, method = 'GET', body?: unknown) {
  return app.request(
    path,
    {
      method,
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    fixture.env,
  );
}
async function seed() {
  const b = await request('/api/manage/brands', 'POST', {
    name: crypto.randomUUID(),
    makingCost: 100000,
  });
  const brandId = z
    .object({ item: z.object({ id: z.string() }) })
    .parse(await b.json()).item.id;
  const base = {
    brandId,
    date: '2026-10-27',
    period: 'October',
    deliveredQty: 10,
    deliveredAmount: 100000000,
    cancelledQty: 0,
    cancelledAmount: 0,
    partialQty: 0,
    partialAmount: 0,
    pendingQty: 0,
    shipping: 0,
    codCharge: 0,
    ads: 0,
    productCost: 0,
    costPerPiece: null,
    agencyBasisPoints: 1500,
  };
  const s = await request('/api/manage/settlements', 'POST', base);
  expect(s.status).toBe(201);
  const settlementId = z
    .object({ item: z.object({ id: z.string() }) })
    .parse(await s.json()).item.id;
  const a = await request('/api/manage/advertising', 'POST', {
    brandId,
    date: '2026-10-27',
    period: 'October',
    campaigns: [{ name: 'Ads', amount: 20000000 }],
  });
  expect(a.status).toBe(201);
  const adId = z.object({ id: z.string() }).parse(await a.json()).id;
  return { brandId, settlementId, adId, base };
}
async function account(brandId: string) {
  const r = await request(`/api/manage/receipts/account/${brandId}`);
  expect(r.status).toBe(200);
  return paymentAccountSchema.parse(await r.json());
}
async function inputFor(
  source: Awaited<ReturnType<typeof seed>>,
  commission = 4000000,
  ads = 6000000,
) {
  const current = await account(source.brandId);
  return {
    requestId: crypto.randomUUID(),
    brandId: source.brandId,
    version: current.version,
    date: '2026-10-27',
    method: 'Bank transfer',
    reference: 'TX-1',
    note: 'Partial payment',
    proofFileId: null,
    allocations: [
      ...(commission
        ? [
            {
              kind: 'commission',
              invoiceId: source.settlementId,
              amount: commission,
            },
          ]
        : []),
      ...(ads ? [{ kind: 'ads', invoiceId: source.adId, amount: ads }] : []),
    ],
  };
}
async function create(input: unknown) {
  const r = await request('/api/manage/receipts', 'POST', input);
  expect(r.status).toBe(201);
  return z.object({ item: receiptSchema }).parse(await r.json()).item;
}

it('records split payments once, updates both ledgers and freezes each receipt snapshot', async () => {
  const s = await seed(),
    input = await inputFor(s),
    first = await create(input);
  expect(first.total).toBe(10000000);
  expect(first.data).toMatchObject({
    commissionBefore: 15000000,
    adsBefore: 22000000,
    commissionReceived: 4000000,
    adsReceived: 6000000,
    commissionAfter: 11000000,
    adsAfter: 16000000,
  });
  const retry = await create(input);
  expect(retry.id).toBe(first.id);
  const db = fixture.env.DB;
  expect(
    (
      await db
        .prepare('SELECT COUNT(*) AS n FROM payments WHERE receipt_id=?')
        .bind(first.id)
        .first<{ n: number }>()
    )?.n,
  ).toBe(2);
  expect((await account(s.brandId)).commission.due).toBe(11000000);
  expect((await account(s.brandId)).ads.due).toBe(16000000);
  const second = await create(await inputFor(s, 1000000, 2000000));
  expect(second.id).not.toBe(first.id);
  expect(second.number).not.toBe(first.number);
  expect(second.data).toMatchObject({
    commissionBefore: 11000000,
    adsBefore: 16000000,
    commissionAfter: 10000000,
    adsAfter: 14000000,
  });
  const saved = z
    .object({ item: receiptSchema })
    .parse(
      await (await request(`/api/manage/receipts/${first.id}`)).json(),
    ).item;
  expect(saved.data).toEqual(first.data);
  const ledger = z
    .object({ item: z.object({ paid: z.number() }) })
    .parse(
      await (await request(`/api/manage/settlements/${s.settlementId}`)).json(),
    );
  expect(ledger.item.paid).toBe(5000000);
  const ads = z
    .object({ item: z.object({ paid: z.number() }) })
    .parse(await (await request(`/api/manage/advertising/${s.adId}`)).json());
  expect(ads.item.paid).toBe(8000000);
  expect(
    (
      await request('/api/manage/receipts', 'POST', {
        ...input,
        note: 'Different request',
      })
    ).status,
  ).toBe(409);
}, 15000);

it('rejects wrong brands, duplicate allocations, overpayments and malformed money without partial writes', async () => {
  const s = await seed(),
    other = await seed(),
    input = await inputFor(s);
  for (const allocations of [
    [{ kind: 'ads', invoiceId: other.adId, amount: 1000 }],
    [input.allocations[0], input.allocations[0]],
    [{ kind: 'commission', invoiceId: s.settlementId, amount: 15000010 }],
    [{ kind: 'ads', invoiceId: s.adId, amount: 1 }],
    [{ kind: 'ads', invoiceId: s.adId, amount: 0 }],
    [],
  ])
    expect(
      (await request('/api/manage/receipts', 'POST', { ...input, allocations }))
        .status,
    ).toBe(422);
  expect((await account(s.brandId)).commission.paid).toBe(0);
  expect(
    (
      await fixture.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM payment_receipts WHERE brand_id=?',
      )
        .bind(s.brandId)
        .first<{ n: number }>()
    )?.n,
  ).toBe(0);
}, 15000);

it('serializes competing payments and rejects stale account snapshots atomically', async () => {
  const s = await seed(),
    a = await inputFor(s, 15000000, 0),
    b = { ...a, requestId: crypto.randomUUID() };
  const responses = await Promise.all([
    request('/api/manage/receipts', 'POST', a),
    request('/api/manage/receipts', 'POST', b),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  expect((await account(s.brandId)).commission.due).toBe(0);
  expect(
    (
      await fixture.env.DB.prepare(
        'SELECT COUNT(*) AS n FROM payment_receipts WHERE brand_id=?',
      )
        .bind(s.brandId)
        .first<{ n: number }>()
    )?.n,
  ).toBe(1);
  expect(
    (await fixture.env.DB.prepare('PRAGMA foreign_key_check').all()).results,
  ).toEqual([]);
}, 15000);

it('reverses every allocation together, retains original receipts and protects source invoice history', async () => {
  const s = await seed(),
    receipt = await create(await inputFor(s));
  const payment = await fixture.env.DB.prepare(
    'SELECT id FROM payments WHERE receipt_id=? LIMIT 1',
  )
    .bind(receipt.id)
    .first<{ id: string }>();
  expect(payment).not.toBeNull();
  expect(
    (await request(`/api/manage/payments/${payment?.id ?? ''}`, 'DELETE', {}))
      .status,
  ).toBe(409);
  expect(
    (
      await request(`/api/manage/settlements/${s.settlementId}`, 'PUT', {
        ...s.base,
        revision: 1,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request(`/api/manage/advertising/${s.adId}`, 'DELETE', {
        revision: 1,
      })
    ).status,
  ).toBe(409);
  const current = await account(s.brandId);
  expect(
    (
      await request(`/api/manage/receipts/${receipt.id}/reverse`, 'POST', {
        reason: 'Incorrect payment allocation',
        version: current.version,
      })
    ).status,
  ).toBe(200);
  expect((await account(s.brandId)).commission.due).toBe(15000000);
  expect((await account(s.brandId)).ads.due).toBe(22000000);
  const saved = z
    .object({ item: receiptSchema })
    .parse(
      await (await request(`/api/manage/receipts/${receipt.id}`)).json(),
    ).item;
  expect(saved.reversedAt).not.toBeNull();
  expect(saved.data).toEqual(receipt.data);
  expect(
    (
      await request(`/api/manage/receipts/${receipt.id}/reverse`, 'POST', {
        reason: 'Retry reversal',
        version: current.version,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(`/api/manage/settlements/${s.settlementId}`, 'PUT', {
        ...s.base,
        revision: 1,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(`/api/manage/settlements/${s.settlementId}`, 'DELETE', {
        revision: 2,
      })
    ).status,
  ).toBe(409);
  const corrected = await create(await inputFor(s, 5000000, 5000000));
  expect(corrected.id).not.toBe(receipt.id);
}, 15000);

it('preserves legacy payments and advertising advances without inventing historical receipts', async () => {
  const s = await seed();
  expect(
    (
      await request('/api/manage/payments', 'POST', {
        requestId: crypto.randomUUID(),
        target: { kind: 'brand', targetId: s.brandId },
        amount: 30000000,
        date: '2026-10-27',
        note: 'Prior advance',
      })
    ).status,
  ).toBe(201);
  const current = await account(s.brandId);
  expect(current.ads).toMatchObject({
    due: 0,
    credit: 8000000,
    paid: 30000000,
  });
  expect(
    z
      .object({ items: z.array(z.unknown()) })
      .parse(
        await (
          await request(`/api/manage/receipts?brandId=${s.brandId}`)
        ).json(),
      ).items,
  ).toHaveLength(0);
  expect(
    z
      .object({ items: z.array(z.unknown()) })
      .parse(
        await (
          await request(`/api/manage/receipts/legacy?brandId=${s.brandId}`)
        ).json(),
      ).items,
  ).toHaveLength(1);
  const receipt = await create(await inputFor(s, 1000000, 0));
  expect(receipt.data.adsCredit).toBe(8000000);
}, 15000);

it('makes existing invoice payment entry points create idempotent receipts with no double-counting', async () => {
  const s = await seed(),
    body = {
      requestId: crypto.randomUUID(),
      target: { kind: 'ads', targetId: s.adId },
      amount: 2000000,
      date: '2026-10-27',
      note: 'Invoice entry',
      proofFileId: null,
    };
  const first = await request(
    '/api/manage/receipts/from-payment',
    'POST',
    body,
  );
  expect(first.status).toBe(201);
  const item = z.object({ item: receiptSchema }).parse(await first.json()).item;
  const retry = await request(
    '/api/manage/receipts/from-payment',
    'POST',
    body,
  );
  expect(retry.status).toBe(200);
  expect(
    z.object({ item: receiptSchema }).parse(await retry.json()).item.id,
  ).toBe(item.id);
  expect((await account(s.brandId)).ads.paid).toBe(2000000);
}, 15000);

it('retries concurrent identical requests without duplicating payment rows', async () => {
  const s = await seed(),
    body = {
      requestId: crypto.randomUUID(),
      target: { kind: 'settlement', targetId: s.settlementId },
      amount: 1000000,
      date: '2026-10-27',
      note: 'Retry',
      proofFileId: null,
    };
  const responses = await Promise.all([
    request('/api/manage/receipts/from-payment', 'POST', body),
    request('/api/manage/receipts/from-payment', 'POST', body),
  ]);
  for (const response of responses)
    expect([200, 201]).toContain(response.status);
  const ids = await Promise.all(
    responses.map(
      async (response) =>
        z.object({ item: receiptSchema }).parse(await response.json()).item.id,
    ),
  );
  expect(ids[0]).toBe(ids[1]);
  expect((await account(s.brandId)).commission.paid).toBe(1000000);
}, 15000);

it('paginates brand receipt history without omissions and uses the brand/date index', async () => {
  const s = await seed(),
    first = await create(await inputFor(s));
  const source = await fixture.env.DB.prepare(
    'SELECT data FROM payment_receipts WHERE id=?',
  )
    .bind(first.id)
    .first<{ data: string }>();
  if (!source) throw new Error('Receipt snapshot missing');
  const ids = Array.from({ length: 23 }, () => crypto.randomUUID());
  await fixture.env.DB.batch(
    ids.map((id, index) =>
      fixture.env.DB.prepare(
        'INSERT INTO payment_receipts (id,number,brand_id,date,request_hash,data,total,created_at) VALUES (?,?,?,?,?,?,?,?)',
      ).bind(
        id,
        `PAGE-${id}`,
        s.brandId,
        '2026-10-27',
        id,
        source.data,
        10000,
        index,
      ),
    ),
  );
  const schema = z.object({
    items: z.array(receiptSchema),
    next: z.object({ before: z.string(), beforeId: z.string() }).nullable(),
  });
  const page = schema.parse(
    await (await request(`/api/manage/receipts?brandId=${s.brandId}`)).json(),
  );
  expect(page.items).toHaveLength(20);
  if (!page.next) throw new Error('Expected next receipt page');
  const next = schema.parse(
    await (
      await request(
        '/api/manage/receipts?' +
          new URLSearchParams({ brandId: s.brandId, ...page.next }).toString(),
      )
    ).json(),
  );
  expect(next.items).toHaveLength(4);
  expect(new Set([...page.items, ...next.items].map((row) => row.id))).toEqual(
    new Set([first.id, ...ids]),
  );
  const plan = await fixture.env.DB.prepare(
    'EXPLAIN QUERY PLAN SELECT id,date FROM payment_receipts WHERE brand_id=? ORDER BY date DESC,id DESC LIMIT 21',
  )
    .bind(s.brandId)
    .all<{ detail: string }>();
  expect(plan.results.map((row) => row.detail).join(' ')).toContain(
    'receipts_brand_date_idx',
  );
}, 15000);

it('records and reverses fifty allocations atomically without per-invoice write queries', async () => {
  const source = await seed();
  await fixture.env.DB.batch(
    Array.from({ length: 48 }, () => {
      const id = crypto.randomUUID();
      return fixture.env.DB.prepare(
        `INSERT INTO ad_invoices (id,invoice_number,brand_id,brand_name,date,period,normalized_period,total,vat_basis_points,revision,created_at,updated_at)
        SELECT ?,?,brand_id,brand_name,date,?,?,total,vat_basis_points,revision,created_at,updated_at FROM ad_invoices WHERE id=?`,
      ).bind(id, `BULK-${id}`, id, id, source.adId);
    }),
  );
  const before = await account(source.brandId);
  const receipt = await create({
    ...(await inputFor(source)),
    allocations: before.invoices.map((invoice) => ({
      kind: invoice.kind,
      invoiceId: invoice.id,
      amount: 1000,
    })),
  });
  expect(receipt.data.lines).toHaveLength(50);
  expect(receipt.total).toBe(50000);
  expect(
    await fixture.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM payments WHERE receipt_id=?',
    )
      .bind(receipt.id)
      .first<{ n: number }>(),
  ).toEqual({ n: 50 });
  const current = await account(source.brandId);
  expect(current.commission.paid + current.ads.paid).toBe(50000);
  const reversal = await request(
    `/api/manage/receipts/${receipt.id}/reverse`,
    'POST',
    { version: current.version, reason: 'Bulk correction verification' },
  );
  expect(reversal.status).toBe(200);
  const restored = await account(source.brandId);
  expect(restored.commission).toEqual(before.commission);
  expect(restored.ads).toEqual(before.ads);
  expect(
    (await fixture.env.DB.prepare('PRAGMA foreign_key_check').all()).results,
  ).toHaveLength(0);
}, 15000);
