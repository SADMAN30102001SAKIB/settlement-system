import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { app } from './app';
import { testEnvironment } from './test-environment';

let fixture: Awaited<ReturnType<typeof testEnvironment>>;
let cookie = '';
const itemId = z.object({ item: z.object({ id: z.string() }) });
beforeAll(async () => {
  fixture = await testEnvironment();
  expect(
    (
      await request('/api/auth/setup', 'POST', {
        username: 'admin',
        password: 'feature integration password',
        setupToken: fixture.env.ADMIN_SETUP_TOKEN,
      })
    ).status,
  ).toBe(201);
  const login = await request('/api/auth/login', 'POST', {
    username: 'admin',
    password: 'feature integration password',
  });
  cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
}, 15000);
afterAll(async () => {
  await fixture.runtime.dispose();
});
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

async function dailyPaginationTest() {
  const a = await brand('Pagination daily A'),
    b = await brand('Pagination daily B');
  const dates = Array.from({ length: 43 }, (_, i) =>
    new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10),
  );
  await fixture.env.DB.batch(
    dates.map((date, i) =>
      fixture.env.DB.prepare(
        'INSERT INTO daily_ads (brand_id,order_date,amount,updated_at) VALUES (?,?,?,1)',
      ).bind(a, date, (i + 1) * 10000),
    ),
  );
  await fixture.env.DB.prepare(
    "INSERT INTO orders (id,brand_id,order_date,status,quantity,cod_amount,shipping,cod_charge,ads,revision,created_at,updated_at) VALUES (?,?,?,'Pending',1,0,0,0,0,1,1,1)",
  )
    .bind(crypto.randomUUID(), b, dates[42])
    .run();
  const schema = z.object({
    days: z.array(
      z.object({
        brandId: z.string(),
        date: z.string(),
        count: z.number(),
        amount: z.number().nullable(),
      }),
    ),
    next: z.object({ before: z.string(), beforeBrand: z.string() }).nullable(),
  });
  const seen: string[] = [];
  let cursor: z.infer<typeof schema>['next'] = null;
  do {
    const params = new URLSearchParams({
      from: '2026-09-01',
      to: '2026-10-13',
      ...(cursor ?? {}),
    });
    const response = await request(
      `/api/manage/business/daily?${params.toString()}`,
    );
    expect(response.status).toBe(200);
    const page = schema.parse(await response.json());
    expect(page.days.length).toBeLessThanOrEqual(20);
    for (const day of page.days)
      if (day.brandId === a || day.brandId === b) {
        seen.push(day.brandId + day.date);
        expect(day.count).toBe(day.brandId === a ? 0 : 1);
      }
    cursor = page.next;
  } while (cursor);
  expect(new Set(seen).size).toBe(44);
  expect(seen).toHaveLength(44);
  const filtered = schema.parse(
    await (
      await request(
        `/api/manage/business/daily?from=2026-09-01&to=2026-10-13&brandId=${a}`,
      )
    ).json(),
  );
  expect(filtered.days).toHaveLength(20);
  expect(filtered.days.every((day) => day.brandId === a)).toBe(true);
  expect(filtered.days[0]?.amount).toBe(430000);
}

async function recordPaginationTest() {
  const brandId = await brand('Pagination records');
  const template = await fixture.env.DB.prepare(
    'SELECT id FROM settlements LIMIT 1',
  ).first<{ id: string }>();
  if (!template) throw new Error('Expected settlement fixture');
  const ids = Array.from({ length: 43 }, () => crypto.randomUUID());
  await fixture.env.DB.batch(
    ids.flatMap((key, index) => [
      fixture.env.DB.prepare(
        "INSERT INTO notes (id,brand_id,period,type,content,created_at,updated_at) VALUES (?,?,'Pagination','Other','note',?,1)",
      ).bind(key, brandId, index),
      fixture.env.DB.prepare(
        "INSERT INTO files (id,object_key,filename,mime,size,kind,created_at) VALUES (?,?,?,'image/png',10,'proof',?)",
      ).bind(key, key, key, index),
      fixture.env.DB.prepare(
        `INSERT INTO settlements (id,invoice_number,brand_id,brand_name,date,period,rule,delivered_qty,delivered_amount,cancelled_qty,cancelled_amount,partial_qty,partial_amount,shipping,cod_charge,ads,product_cost,agency_basis_points,gross,net,commission,created_at,updated_at)
      SELECT ?,?,?,brand_name,'2026-10-01','Pagination','v2',delivered_qty,delivered_amount,cancelled_qty,cancelled_amount,partial_qty,partial_amount,shipping,cod_charge,ads,product_cost,agency_basis_points,gross,net,commission,created_at,updated_at FROM settlements WHERE id=?`,
      ).bind(key, `PAGE-${key}`, brandId, template.id),
    ]),
  );
  const schema = z.object({
    items: z.array(z.object({ id: z.string() })),
    next: z.record(z.string(), z.union([z.string(), z.number()])).nullable(),
  });
  for (const path of [
    `notes?brandId=${brandId}`,
    `files?`,
    `progress?kind=settlements&brandId=${brandId}`,
    `settlements?brandId=${brandId}`,
  ]) {
    const firstResponse = await request(`/api/manage/${path}`);
    expect(firstResponse.status).toBe(200);
    const first = schema.parse(await firstResponse.json());
    expect(first.items).toHaveLength(20);
    expect(first.next).not.toBeNull();
    const cursor = new URLSearchParams(
      Object.entries(first.next ?? {}).map(([k, v]) => [k, String(v)]),
    );
    const second = schema.parse(
      await (await request(`/api/manage/${path}&${cursor.toString()}`)).json(),
    );
    expect(second.items).toHaveLength(20);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(40);
  }
  const summary = z.object({ summary: z.object({ count: z.number() }) });
  expect(
    summary.parse(
      await (
        await request(`/api/manage/settlements?brandId=${brandId}`)
      ).json(),
    ).summary.count,
  ).toBe(43);
}

it('paginates searchable brand directories and account overviews beyond twenty brands', async () => {
  const ids = Array.from({ length: 43 }, () => crypto.randomUUID());
  await fixture.env.DB.batch(
    ids.map((key, index) =>
      fixture.env.DB.prepare(
        'INSERT INTO brands (id,name,normalized_name,making_cost,created_at,updated_at) VALUES (?,?,?,0,1,1)',
      ).bind(
        key,
        `Pager ${String(index).padStart(2, '0')}`,
        `pager ${String(index).padStart(2, '0')}`,
      ),
    ),
  );
  const schema = z.object({
    items: z.array(z.object({ id: z.string() })),
    next: z.object({ after: z.string() }).nullable(),
  });
  for (const path of ['brands?q=Pager', 'advertising/overview?']) {
    let cursor: z.infer<typeof schema>['next'] = null;
    const seen: string[] = [];
    do {
      const response = await request(
        `/api/manage/${path}&${new URLSearchParams(cursor ?? {}).toString()}`,
      );
      expect(response.status).toBe(200);
      const page = schema.parse(await response.json());
      expect(page.items.length).toBeLessThanOrEqual(20);
      seen.push(
        ...page.items
          .filter((row) => ids.includes(row.id))
          .map((row) => row.id),
      );
      cursor = page.next;
    } while (cursor);
    expect(seen).toHaveLength(43);
    expect(new Set(seen)).toEqual(new Set(ids));
  }
  const literal = await brand('Pager % literal');
  const search = schema.parse(
    await (await request('/api/manage/brands?q=%25')).json(),
  );
  expect(search.items.map((row) => row.id)).toEqual([literal]);
}, 20000);
async function brand(name: string) {
  const response = await request('/api/manage/brands', 'POST', {
    name,
    makingCost: 100000,
  });
  expect(response.status).toBe(201);
  return itemId.parse(await response.json()).item.id;
}

it('atomically edits campaigns and applies direct, account and advance payments FIFO', async () => {
  const brandId = await brand('Advertising test');
  const input = {
    brandId,
    date: '2026-10-01',
    period: 'First day',
    campaigns: [{ name: 'Campaign A', amount: 100000 }],
  };
  const first = await request('/api/manage/advertising', 'POST', input);
  expect(first.status).toBe(201);
  const firstId = z.object({ id: z.string() }).parse(await first.json()).id;
  expect((await request('/api/manage/advertising', 'POST', input)).status).toBe(
    409,
  );
  const second = await request('/api/manage/advertising', 'POST', {
    ...input,
    date: '2026-10-02',
    period: 'Second day',
    campaigns: [{ name: 'B', amount: 200000 }],
  });
  const secondId = z.object({ id: z.string() }).parse(await second.json()).id;
  expect(
    (
      await request('/api/manage/payments', 'POST', {
        requestId: crypto.randomUUID(),
        target: { kind: 'brand', targetId: brandId },
        amount: 150000,
        date: '2026-10-03',
        note: '',
      })
    ).status,
  ).toBe(201);
  let account = z
    .object({
      invoices: z.array(z.object({ id: z.string(), paid: z.number() })),
      paid: z.number(),
      total: z.number(),
    })
    .parse(
      await (
        await request(`/api/manage/advertising/account/${brandId}`)
      ).json(),
    );
  expect(account.invoices.find((item) => item.id === firstId)?.paid).toBe(
    110000,
  );
  expect(account.invoices.find((item) => item.id === secondId)?.paid).toBe(
    40000,
  );
  const edit = {
    ...input,
    campaigns: [
      { name: 'Edited A', amount: 80000 },
      { name: 'Edited B', amount: 20000 },
    ],
    revision: 1,
  };
  expect(
    (await request(`/api/manage/advertising/${firstId}`, 'PUT', edit)).status,
  ).toBe(200);
  expect(
    (
      await request(`/api/manage/advertising/${firstId}`, 'PUT', {
        ...edit,
        campaigns: [{ name: 'Stale must not replace', amount: 1 }],
      })
    ).status,
  ).toBe(409);
  const detail = z
    .object({
      item: z.object({ campaigns: z.array(z.object({ name: z.string() })) }),
    })
    .parse(await (await request(`/api/manage/advertising/${firstId}`)).json());
  expect(detail.item.campaigns.map((line) => line.name)).toEqual([
    'Edited A',
    'Edited B',
  ]);
  expect(
    (
      await request('/api/manage/payments', 'POST', {
        requestId: crypto.randomUUID(),
        target: { kind: 'ads', targetId: secondId },
        amount: 250000,
        date: '2026-10-04',
        note: '',
      })
    ).status,
  ).toBe(201);
  account = z
    .object({
      invoices: z.array(z.object({ id: z.string(), paid: z.number() })),
      paid: z.number(),
      total: z.number(),
    })
    .parse(
      await (
        await request(`/api/manage/advertising/account/${brandId}`)
      ).json(),
    );
  expect(account.paid).toBe(400000);
  expect(account.total).toBe(330000);
  expect(account.invoices.find((item) => item.id === secondId)?.paid).toBe(
    290000,
  );
  expect(
    (
      await request(`/api/manage/advertising/${firstId}`, 'DELETE', {
        revision: 2,
      })
    ).status,
  ).toBe(200);
}, 15000);

it('keeps imports idempotent, advertising conserved, making costs snapshotted, and cross-brand imports atomic', async () => {
  const brandId = await brand('Business test'),
    otherBrandId = await brand('Other brand');
  expect(
    (
      await request('/api/manage/business/ads', 'PUT', {
        brandId,
        date: '2026-10-10',
        amount: 100000,
      })
    ).status,
  ).toBe(200);
  const base = {
    orderDate: '2026-10-10',
    deliveryDate: '2026-10-11',
    quantity: 1,
    partialQuantity: null,
    salesOverride: null,
    codAmount: 500000,
    shipping: 10000,
    codCharge: 5000,
  };
  const rows = [
    { ...base, id: 'business-1', status: 'Delivered' },
    { ...base, id: 'business-2', status: 'Cancelled' },
    { ...base, id: 'business-3', status: 'Pending', deliveryDate: null },
  ];
  for (let repeat = 0; repeat < 2; repeat++)
    expect(
      (await request('/api/manage/business/import', 'POST', { brandId, rows }))
        .status,
    ).toBe(200);
  const values = await fixture.env.DB.prepare(
    'SELECT id, ads, cost_per_piece FROM orders WHERE brand_id = ? ORDER BY id',
  )
    .bind(brandId)
    .all<{ id: string; ads: number; cost_per_piece: number }>();
  expect(values.results).toHaveLength(3);
  expect(values.results.reduce((sum, row) => sum + row.ads, 0)).toBe(100000);
  await request(`/api/manage/brands/${brandId}`, 'PUT', {
    name: 'Business test',
    makingCost: 200000,
  });
  await request('/api/manage/business/import', 'POST', {
    brandId,
    rows: [rows[0]],
  });
  expect(
    (
      await fixture.env.DB.prepare(
        'SELECT cost_per_piece FROM orders WHERE id = ?',
      )
        .bind('business-1')
        .first<{ cost_per_piece: number }>()
    )?.cost_per_piece,
  ).toBe(100000);
  const conflict = await request('/api/manage/business/import', 'POST', {
    brandId: otherBrandId,
    rows: [
      { ...base, id: 'new-before-conflict', status: 'Delivered' },
      rows[0],
    ],
  });
  expect(conflict.status).toBe(409);
  expect(
    await fixture.env.DB.prepare('SELECT id FROM orders WHERE id = ?')
      .bind('new-before-conflict')
      .first(),
  ).toBeNull();
  const report = await request(
    `/api/manage/business/report?from=2026-10-10&to=2026-10-10&brandId=${brandId}&basis=order&agencyBasisPoints=1500`,
  );
  expect(report.status).toBe(200);
  expect(
    z
      .object({
        totals: z.object({
          count: z.number(),
          revenue: z.number(),
          ads: z.number(),
          productCost: z.number(),
          shipping: z.number(),
          codCharge: z.number(),
          net: z.number(),
          commission: z.number(),
        }),
      })
      .parse(await report.json()),
  ).toEqual({
    totals: {
      count: 3,
      revenue: 495000,
      ads: 110000,
      productCost: 100000,
      shipping: 20000,
      codCharge: 5000,
      net: 265000,
      commission: 39750,
    },
  });
  const plan = await fixture.env.DB.prepare(
    'EXPLAIN QUERY PLAN SELECT id FROM orders WHERE brand_id = ? AND order_date >= ? AND order_date <= ? ORDER BY order_date DESC, id DESC LIMIT 101',
  )
    .bind(brandId, '2026-10-01', '2026-10-31')
    .all<{ detail: string }>();
  expect(
    plan.results.some((row) =>
      row.detail.includes('orders_brand_order_date_idx'),
    ),
  ).toBe(true);
}, 15000);

it('stores private images in R2, enforces authentication, and removes database references on deletion', async () => {
  const image = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx9sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const uploaded = await app.request(
    '/api/manage/files/watermark',
    {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        Cookie: cookie,
        'Content-Type': 'application/octet-stream',
        'X-File-Name': 'test.png',
      },
      body: image,
    },
    fixture.env,
  );
  expect(uploaded.status).toBe(201);
  const key = z.object({ id: z.string() }).parse(await uploaded.json()).id;
  const downloaded = await request(`/api/manage/files/${key}`);
  expect(downloaded.status).toBe(200);
  expect(downloaded.headers.get('Content-Type')).toBe('image/png');
  expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(image);
  expect(
    (await app.request(`/api/manage/files/${key}`, {}, fixture.env)).status,
  ).toBe(401);
  expect((await request(`/api/manage/files/${key}`, 'DELETE', {})).status).toBe(
    200,
  );
  expect((await request(`/api/manage/files/${key}`)).status).toBe(404);
  expect(
    (
      await fixture.env.DB.prepare(
        'SELECT watermark_file_id FROM settings WHERE id = 1',
      ).first<{ watermark_file_id: string | null }>()
    )?.watermark_file_id,
  ).toBeNull();
});

it('uses v3 by default, preserves saved rules, and reports automatic completion', async () => {
  const brandId = await brand('V3 invoice');
  const input = {
    brandId,
    date: '2026-10-20',
    period: 'V3 period',
    deliveredQty: 2,
    cancelledQty: 1,
    partialQty: 1,
    pendingQty: 1,
    deliveredAmount: 1000000,
    cancelledAmount: 500000,
    partialAmount: 200000,
    shipping: 200000,
    codCharge: 99999,
    deliveredCodCharge: 10000,
    partialCodCharge: 2000,
    vatBasisPoints: 1000,
    ads: 100000,
    productCost: 200000,
    costPerPiece: 100000,
    agencyBasisPoints: 1500,
  };
  const response = await request('/api/manage/settlements', 'POST', input);
  expect(response.status).toBe(201);
  const saved = z
    .object({
      item: z.object({
        id: z.string(),
        rule: z.string(),
        gross: z.number(),
        net: z.number(),
        commission: z.number(),
        revision: z.number(),
      }),
    })
    .parse(await response.json()).item;
  expect(saved).toMatchObject({
    rule: 'v3',
    gross: 988000,
    net: 688000,
    commission: 113200,
  });
  expect(
    (
      await request('/api/manage/settlements', 'POST', {
        ...input,
        period: 'Fractional VAT',
        ads: 45,
      })
    ).status,
  ).toBe(201);
  const summary = z
    .object({ summary: z.object({ ads: z.number() }) })
    .parse(
      await (
        await request(`/api/manage/settlements?brandId=${brandId}`)
      ).json(),
    );
  expect(summary.summary.ads).toBe(100045);
  expect(
    (
      await request(`/api/manage/settlements/${saved.id}`, 'PUT', {
        ...input,
        rule: 'v2',
        revision: saved.revision,
      })
    ).status,
  ).toBe(409);
  const progress = await request(
    `/api/manage/progress?kind=settlements&brandId=${brandId}`,
  );
  expect(progress.status).toBe(200);
  expect(
    z
      .object({ items: z.array(z.object({ id: z.string() })) })
      .parse(await progress.json()).items,
  ).toContainEqual({ id: saved.id });
});

it('lists all advertising brands and paginates invoices with VAT-inclusive account balances', async () => {
  const a = await brand('PDF requirements A'),
    b = await brand('PDF requirements B'),
    empty = await brand('PDF empty account');
  const ids: string[] = [];
  for (let i = 0; i < 24; i++) {
    const response = await request('/api/manage/advertising', 'POST', {
      brandId: i === 23 ? b : a,
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      period: `PDF requirement ${String(i)}`,
      campaigns: [{ name: 'Spend', amount: 100000 }],
    });
    expect(response.status).toBe(201);
    ids.push(z.object({ id: z.string() }).parse(await response.json()).id);
  }
  await request('/api/manage/payments', 'POST', {
    requestId: crypto.randomUUID(),
    target: { kind: 'brand', targetId: a },
    amount: 150000,
    date: '2026-10-25',
    note: '',
  });
  const overviewSchema = z.object({
    next: z.object({ after: z.string() }).nullable(),
    items: z.array(
      z.object({
        id: z.string(),
        count: z.number(),
        total: z.number(),
        paid: z.number(),
      }),
    ),
  });
  let overview = overviewSchema.parse(
    await (await request('/api/manage/advertising/overview')).json(),
  );
  while (overview.next) {
    const page = overviewSchema.parse(
      await (
        await request(
          '/api/manage/advertising/overview?' +
            new URLSearchParams(overview.next).toString(),
        )
      ).json(),
    );
    overview = { items: [...overview.items, ...page.items], next: page.next };
  }
  expect(overview.items.find((item) => item.id === empty)).toMatchObject({
    count: 0,
    total: 0,
    paid: 0,
  });
  expect(overview.items.find((item) => item.id === a)).toMatchObject({
    count: 23,
    total: 2530000,
    paid: 150000,
  });
  const schema = z.object({
    items: z.array(
      z.object({
        id: z.string(),
        brandId: z.string(),
        brandName: z.string(),
        total: z.number(),
        paid: z.number(),
      }),
    ),
    next: z.object({ before: z.string(), beforeId: z.string() }).nullable(),
  });
  const first = schema.parse(
    await (await request('/api/manage/advertising?q=PDF%20requirement')).json(),
  );
  expect(first.items).toHaveLength(20);
  expect(first.items.some((item) => item.brandId === b)).toBe(true);
  const next = first.next;
  if (next === null) throw new Error('Expected another ledger page');
  const second = schema.parse(
    await (
      await request(
        '/api/manage/advertising?' +
          new URLSearchParams({ q: 'PDF requirement', ...next }).toString(),
      )
    ).json(),
  );
  expect(second.items).toHaveLength(4);
  expect(
    new Set([...first.items, ...second.items].map((item) => item.id)),
  ).toEqual(new Set(ids));
  expect(
    [...first.items, ...second.items].find((item) => item.id === ids[0])?.paid,
  ).toBe(110000);
  const plans = await fixture.env.DB.prepare(
    'EXPLAIN QUERY PLAN SELECT id FROM ad_invoices WHERE brand_id = ? AND date >= ? ORDER BY date DESC,id DESC LIMIT 21',
  )
    .bind(a, '2026-10-01')
    .all<{ detail: string }>();
  expect(plans.results.map((row) => row.detail).join(' ')).toContain(
    'ad_invoices_brand_date_idx',
  );
}, 20000);

it('preserves original VAT rules when editing saved invoices', async () => {
  const brandId = await brand('Historical VAT');
  const legacy = await request('/api/manage/advertising', 'POST', {
    brandId,
    date: '2026-10-26',
    period: 'Old VAT',
    vatBasisPoints: 0,
    campaigns: [{ name: 'Old', amount: 2000000 }],
  });
  const key = z.object({ id: z.string() }).parse(await legacy.json()).id;
  expect(
    (
      await request(`/api/manage/advertising/${key}`, 'PUT', {
        brandId,
        date: '2026-10-26',
        period: 'Old VAT',
        vatBasisPoints: 1000,
        revision: 1,
        campaigns: [{ name: 'Old', amount: 2000000 }],
      })
    ).status,
  ).toBe(409);
  const detail = z
    .object({
      item: z.object({ total: z.number(), vatBasisPoints: z.number() }),
    })
    .parse(await (await request(`/api/manage/advertising/${key}`)).json());
  expect(detail.item).toMatchObject({ total: 2000000, vatBasisPoints: 0 });
});

it('excludes workspace expenses from brand reports and safely reallocates reassigned orders', async () => {
  const first = await brand('Reassign source'),
    second = await brand('Reassign target');
  const date = '2026-09-15';
  const row = {
    orderDate: date,
    deliveryDate: date,
    status: 'Delivered',
    quantity: 4,
    partialQuantity: null,
    salesOverride: null,
    codAmount: 500000,
    shipping: 60000,
    codCharge: 5000,
  };
  for (const [brandId, amount] of [
    [first, 100000],
    [second, 200000],
  ] as const) {
    expect(
      (
        await request('/api/manage/business/ads', 'PUT', {
          brandId,
          date,
          amount,
        })
      ).status,
    ).toBe(200);
  }
  expect(
    (
      await request('/api/manage/business/import', 'POST', {
        brandId: first,
        rows: [
          { ...row, id: 'move-a' },
          { ...row, id: 'move-b' },
        ],
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await request('/api/manage/business/import', 'POST', {
        brandId: second,
        rows: [{ ...row, id: 'move-c' }],
      })
    ).status,
  ).toBe(200);
  await request(`/api/manage/brands/${second}`, 'PUT', {
    name: 'Reassign target',
    makingCost: 150000,
  });
  expect(
    (
      await request('/api/manage/business/expenses', 'POST', {
        date,
        amount: 10000,
        description: 'Workspace only',
      })
    ).status,
  ).toBe(201);
  const reportSchema = z.object({
    totals: z.object({
      otherExpenses: z.number(),
      net: z.number(),
      productCost: z.number(),
    }),
    days: z.array(z.object({ net: z.number(), commission: z.number() })),
  });
  const filter = `/api/manage/business/report?from=${date}&to=${date}&basis=order&agencyBasisPoints=1500`;
  const selected = reportSchema.parse(
    await (await request(`${filter}&brandId=${first}`)).json(),
  );
  expect(selected.totals).toEqual({
    otherExpenses: 0,
    net: -40000,
    productCost: 800000,
  });
  const all = reportSchema.parse(await (await request(filter)).json());
  expect(all.totals.otherExpenses).toBe(10000);
  const edit = {
    brandId: second,
    revision: 1,
    quantity: 4,
    partialQuantity: null,
    salesOverride: null,
    costPerPiece: 100000,
  };
  expect(
    (await request('/api/manage/business/orders/move-a', 'PUT', edit)).status,
  ).toBe(200);
  const after = await fixture.env.DB.prepare(
    "SELECT id,brand_id,cost_per_piece,ads,revision FROM orders WHERE id IN ('move-a','move-b','move-c') ORDER BY id",
  ).all();
  expect(after.results).toEqual([
    {
      id: 'move-a',
      brand_id: second,
      cost_per_piece: 150000,
      ads: 100000,
      revision: 2,
    },
    {
      id: 'move-b',
      brand_id: first,
      cost_per_piece: 100000,
      ads: 100000,
      revision: 1,
    },
    {
      id: 'move-c',
      brand_id: second,
      cost_per_piece: 100000,
      ads: 100000,
      revision: 1,
    },
  ]);
  expect(
    (
      await request('/api/manage/business/orders/move-a', 'PUT', {
        ...edit,
        brandId: first,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await fixture.env.DB.prepare(
        "SELECT id,brand_id,cost_per_piece,ads,revision FROM orders WHERE id IN ('move-a','move-b','move-c') ORDER BY id",
      ).all()
    ).results,
  ).toEqual(after.results);
}, 15000);

it('restores original image assets privately and resets only company identity', async () => {
  for (const kind of ['watermark', 'signature']) {
    const response = await request(
      `/api/manage/files/defaults/${kind}`,
      'POST',
      {},
    );
    expect(response.status).toBe(201);
    const image = z.object({ id: z.string() }).parse(await response.json());
    const download = await request(`/api/manage/files/${image.id}`);
    expect(download.headers.get('Content-Type')).toBe('image/png');
    expect((await download.arrayBuffer()).byteLength).toBeGreaterThan(30000);
  }
  const before = await fixture.env.DB.prepare(
    'SELECT watermark_file_id,signature_file_id,agency_basis_points FROM settings',
  ).first();
  expect((await request('/api/manage/settings/reset', 'POST', {})).status).toBe(
    200,
  );
  expect(
    await fixture.env.DB.prepare(
      'SELECT watermark_file_id,signature_file_id,agency_basis_points FROM settings',
    ).first(),
  ).toEqual(before);
});

it(
  'paginates brand/day groups including advertising-only days without duplicates or omissions',
  dailyPaginationTest,
  20000,
);
it(
  'returns twenty notes, files, progress and settlements per cursor page while preserving all-range totals',
  recordPaginationTest,
  20000,
);
