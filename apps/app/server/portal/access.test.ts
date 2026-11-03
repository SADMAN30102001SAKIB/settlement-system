import { beforeAll, afterAll, it, expect } from 'vitest';
import { z } from 'zod';
import { app } from '../app';
import { testEnvironment } from '../test-environment';
import { receiptSchema, paymentSummarySchema } from '../../shared/receipts';
import { portalListSchema } from '../../shared/access';
import { digest } from '../auth/crypto';

let fixture: Awaited<ReturnType<typeof testEnvironment>>;
let adminCookie = '',
  aCookie = '',
  bCookie = '',
  a = '',
  b = '',
  adsA = '',
  adsB = '',
  receiptA = '',
  receiptB = '';
const adminPassword = 'administrator passphrase for access tests';
const brandPassword = 'brand portal passphrase for secure access';
const origin = 'https://example.test';
const itemId = z.object({ item: z.object({ id: z.string() }) });
const reportSchema = z.object({ brandId: z.string() });
const adDetailSchema = z.object({
  item: z.object({
    paid: z.number(),
    campaigns: z.array(z.object({ name: z.string(), amount: z.number() })),
  }),
});
function call(
  path: string,
  method = 'GET',
  body?: unknown,
  cookie = adminCookie,
  ip = '198.51.100.11',
) {
  return app.request(
    origin + path,
    {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Cookie: cookie,
        'CF-Connecting-IP': ip,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    fixture.env,
  );
}
function cookieFrom(response: Response) {
  return response.headers.get('Set-Cookie')?.split(';')[0] ?? '';
}
async function makeBrand(name: string) {
  const response = await call('/api/manage/brands', 'POST', {
    name,
    makingCost: 10000,
  });
  expect(response.status).toBe(201);
  return itemId.parse(await response.json()).item.id;
}
async function provision(
  brandId: string,
  username: string,
  version = 0,
  password = brandPassword,
  enabled = true,
) {
  return call(`/api/manage/brand-access/${brandId}`, 'PUT', {
    username,
    version,
    password,
    enabled,
    currentPassword: adminPassword,
  });
}
async function login(
  username: string,
  password = brandPassword,
  ip = '198.51.100.11',
) {
  return call('/api/brand-auth/login', 'POST', { username, password }, '', ip);
}
beforeAll(async () => {
  fixture = await testEnvironment();
  expect(
    (
      await call('/api/auth/setup', 'POST', {
        username: 'admin',
        password: adminPassword,
        setupToken: fixture.env.ADMIN_SETUP_TOKEN,
      })
    ).status,
  ).toBe(201);
  const response = await call(
    '/api/auth/login',
    'POST',
    { username: 'admin', password: adminPassword },
    '',
  );
  adminCookie = cookieFrom(response);
  expect(adminCookie).not.toBe('');
  a = await makeBrand('Portal brand A');
  b = await makeBrand('Portal brand B');
  expect((await provision(a, '01700000001')).status).toBe(200);
  expect((await provision(b, '01700000002')).status).toBe(200);
  const aLogin = await login('01700000001');
  expect(aLogin.status).toBe(200);
  aCookie = cookieFrom(aLogin);
  expect(aLogin.headers.get('Set-Cookie')).toContain('HttpOnly');
  expect(aLogin.headers.get('Set-Cookie')).toContain('Secure');
  expect(aLogin.headers.get('Set-Cookie')).toContain('SameSite=Strict');
  bCookie = cookieFrom(await login('01700000002'));
  for (const [owner, set] of [
    [a, 'a'],
    [b, 'b'],
  ] as const) {
    const response = await call('/api/manage/advertising', 'POST', {
      brandId: owner,
      date: '2026-10-31',
      period: 'Portal October',
      campaigns: [{ name: 'Campaign', amount: 100000 }],
    });
    expect(response.status).toBe(201);
    const key = z.object({ id: z.string() }).parse(await response.json()).id;
    const receipt = await call('/api/manage/receipts/from-payment', 'POST', {
      requestId: crypto.randomUUID(),
      target: { kind: 'ads', targetId: key },
      amount: 10000,
      date: '2026-10-31',
      note: 'Portal payment',
      proofFileId: null,
    });
    expect(receipt.status).toBe(201);
    const receiptId = itemId.parse(await receipt.json()).item.id;
    if (set === 'a') {
      adsA = key;
      receiptA = receiptId;
    } else {
      adsB = key;
      receiptB = receiptId;
    }
  }
}, 30000);
afterAll(async () => {
  await fixture.runtime.dispose();
});

it(
  'keeps administrator and brand sessions separate and rejects all brand mutations',
  { timeout: 20000 },
  async () => {
    expect(
      (await call('/api/portal/settings', 'GET', undefined, '')).status,
    ).toBe(401);
    expect((await call('/api/portal/settings')).status).toBe(401);
    for (const path of [
      '/api/manage/bootstrap',
      '/api/manage/brands',
      '/api/auth/account',
      '/api/manage/brand-access/' + a,
    ])
      expect((await call(path, 'GET', undefined, aCookie)).status).toBe(401);
    expect(
      (await call('/api/manage/brands/' + a, 'DELETE', {}, aCookie)).status,
    ).toBe(401);
    expect(
      (await call('/api/manage/advertising/' + adsA, 'DELETE', {}, aCookie))
        .status,
    ).toBe(401);
    expect(
      (
        await call(
          '/api/portal/invoices/advertising/' + adsA,
          'DELETE',
          {},
          aCookie,
        )
      ).status,
    ).toBe(404);
    expect((await call('/api/manage/advertising/' + adsA)).status).toBe(200);
    expect(
      (
        await call(
          '/api/portal/settings',
          'GET',
          undefined,
          aCookie.replace('hexa_brand_session', 'hexa_session'),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          '/api/manage/bootstrap',
          'GET',
          undefined,
          aCookie.replace('hexa_brand_session', 'hexa_session'),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          '/api/portal/settings',
          'GET',
          undefined,
          adminCookie.replace('hexa_session', 'hexa_brand_session'),
        )
      ).status,
    ).toBe(401);
  },
);

it(
  'scopes invoice lists, details, pagination and receipts to the authenticated brand',
  { timeout: 20000 },
  async () => {
    const ids: string[] = [];
    for (let i = 0; i < 23; i++) {
      const key = crypto.randomUUID();
      ids.push(key);
      await fixture.env.DB.prepare(
        "INSERT INTO settlements (id,brand_id,invoice_number,brand_name,date,period,delivered_qty,delivered_amount,cancelled_qty,cancelled_amount,partial_qty,partial_amount,shipping,cod_charge,ads,product_cost,agency_basis_points,gross,net,commission,created_at,updated_at) VALUES (?,?,?,'Portal brand A','2026-10-31','October',1,10000,0,0,0,0,0,0,0,0,1500,10000,10000,1500,1,1)",
      )
        .bind(key, a, 'PORTAL-A-' + String(i))
        .run();
    }
    const other = crypto.randomUUID();
    await fixture.env.DB.prepare(
      "INSERT INTO settlements (id,brand_id,invoice_number,brand_name,date,period,delivered_qty,delivered_amount,cancelled_qty,cancelled_amount,partial_qty,partial_amount,shipping,cod_charge,ads,product_cost,agency_basis_points,gross,net,commission,created_at,updated_at) VALUES (?,?,?,'Portal brand B','2026-10-31','October',1,10000,0,0,0,0,0,0,0,0,1500,10000,10000,1500,1,1)",
    )
      .bind(other, b, 'PORTAL-B')
      .run();
    const page = portalListSchema.parse(
      await (
        await call(
          '/api/portal/invoices?kind=settlements',
          'GET',
          undefined,
          aCookie,
        )
      ).json(),
    );
    expect(page.items).toHaveLength(20);
    expect(page.items.every((row) => row.number.startsWith('PORTAL-A-'))).toBe(
      true,
    );
    expect(page.next).not.toBeNull();
    const next = portalListSchema.parse(
      await (
        await call(
          '/api/portal/invoices?kind=settlements&' +
            new URLSearchParams(page.next ?? {}).toString(),
          'GET',
          undefined,
          aCookie,
        )
      ).json(),
    );
    expect(next.items).toHaveLength(3);
    expect(
      new Set([...page.items, ...next.items].map((row) => row.id)).size,
    ).toBe(23);
    expect(next.next).toBeNull();
    expect(
      reportSchema.parse(
        z
          .object({ item: reportSchema })
          .parse(
            await (
              await call(
                '/api/portal/invoices/settlements/' + (ids[0] ?? ''),
                'GET',
                undefined,
                aCookie,
              )
            ).json(),
          ).item,
      ).brandId,
    ).toBe(a);
    for (const [kind, own, foreign] of [
      ['settlements', ids[0] ?? '', other],
      ['advertising', adsA, adsB],
      ['receipts', receiptA, receiptB],
    ] as const) {
      expect(
        (
          await call(
            `/api/portal/invoices/${kind}/${own}`,
            'GET',
            undefined,
            aCookie,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await call(
            `/api/portal/invoices/${kind}/${foreign}`,
            'GET',
            undefined,
            aCookie,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            `/api/portal/invoices/${kind}/${own}`,
            'GET',
            undefined,
            bCookie,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await call(
            `/api/portal/invoices?kind=${kind}&brandId=${b}`,
            'GET',
            undefined,
            aCookie,
          )
        ).status,
      ).toBe(422);
    }
    const ad = z
      .object({ item: adDetailSchema.shape.item })
      .parse(
        await (
          await call(
            '/api/portal/invoices/advertising/' + adsA,
            'GET',
            undefined,
            aCookie,
          )
        ).json(),
      ).item;
    expect(ad.paid).toBe(10000);
    expect(ad.campaigns).toHaveLength(1);
    const receipt = z
      .object({ item: receiptSchema })
      .parse(
        await (
          await call(
            '/api/portal/invoices/receipts/' + receiptA,
            'GET',
            undefined,
            aCookie,
          )
        ).json(),
      ).item;
    expect(receipt.brandId).toBe(a);
    expect(receipt.data.lines.every((row) => row.invoiceId === adsA)).toBe(
      true,
    );
    const plan = await fixture.env.DB.prepare(
      'EXPLAIN QUERY PLAN SELECT id,invoice_number,date,period FROM settlements WHERE brand_id=? ORDER BY date DESC,id DESC LIMIT 21',
    )
      .bind(a)
      .all<{ detail: string }>();
    expect(
      plan.results.some((row) =>
        row.detail.includes('settlements_brand_date_idx'),
      ),
    ).toBe(true);
  },
);

it(
  'serves only current invoice artwork, never private proof uploads or file listings',
  { timeout: 20000 },
  async () => {
    const artwork = crypto.randomUUID(),
      proof = crypto.randomUUID();
    for (const [key, kind] of [
      [artwork, 'watermark'],
      [proof, 'proof'],
    ] as const) {
      await fixture.env.FILES.put(
        'portal/' + key,
        new Uint8Array([137, 80, 78, 71]),
      );
      await fixture.env.DB.prepare(
        "INSERT INTO files (id,object_key,filename,mime,size,kind,created_at) VALUES (?,?,'image.png','image/png',4,?,1)",
      )
        .bind(key, 'portal/' + key, kind)
        .run();
    }
    await fixture.env.DB.prepare(
      'UPDATE settings SET watermark_file_id=? WHERE id=1',
    )
      .bind(artwork)
      .run();
    const response = await call(
      '/api/portal/files/' + artwork,
      'GET',
      undefined,
      aCookie,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(
      (await call('/api/portal/files/' + proof, 'GET', undefined, aCookie))
        .status,
    ).toBe(404);
    expect(
      (await call('/api/manage/files/' + proof, 'GET', undefined, aCookie))
        .status,
    ).toBe(401);
    expect(
      (await call('/api/portal/files', 'GET', undefined, aCookie)).status,
    ).toBe(404);
    expect(
      (await call('/api/portal/files/' + artwork, 'GET', undefined, '')).status,
    ).toBe(401);
  },
);

it(
  'protects credential management, username uniqueness and reset/disable session revocation',
  { timeout: 20000 },
  async () => {
    const access = await call('/api/manage/brand-access/' + a);
    expect(await access.text()).not.toMatch(/password|hash/i);
    expect(
      (
        await call('/api/manage/brand-access/' + a, 'PUT', {
          username: '01700000001',
          version: 1,
          enabled: true,
          currentPassword: 'wrong',
        })
      ).status,
    ).toBe(403);
    expect((await call('/api/manage/bootstrap')).status).toBe(200);
    expect((await provision(b, '01700000001', 1)).status).toBe(409);
    const c = await makeBrand('Portal reset brand');
    expect((await provision(c, '01700000003')).status).toBe(200);
    const old = cookieFrom(await login('01700000003'));
    const replacement = 'replacement brand password passphrase';
    expect((await provision(c, '01700000003', 1, replacement)).status).toBe(
      200,
    );
    expect(
      (await call('/api/portal/settings', 'GET', undefined, old)).status,
    ).toBe(401);
    expect((await login('01700000003')).status).toBe(401);
    const newer = cookieFrom(await login('01700000003', replacement));
    expect(
      (await provision(c, '01700000003', 2, replacement, false)).status,
    ).toBe(200);
    expect(
      (await call('/api/portal/settings', 'GET', undefined, newer)).status,
    ).toBe(401);
    expect((await login('01700000003', replacement)).status).toBe(401);
    expect(
      (await provision(c, '01700000003', 3, replacement, true)).status,
    ).toBe(200);
    const results = await Promise.all([
      provision(c, '01700000003', 4, replacement),
      provision(c, '01700000003', 4, replacement),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([200, 409]);
    expect((await provision(c, '01700000003', 0, replacement)).status).toBe(
      409,
    );
  },
);

it(
  'clears brand sessions on logout and bounds failed login attempts',
  { timeout: 20000 },
  async () => {
    const session = await login('01700000001');
    const cookie = cookieFrom(session);
    expect(
      (await call('/api/brand-auth/logout', 'POST', {}, cookie)).status,
    ).toBe(200);
    expect(
      (await call('/api/portal/settings', 'GET', undefined, cookie)).status,
    ).toBe(401);
    for (let i = 0; i < 5; i++)
      expect(
        (await login('01999999999', 'wrong', '198.51.100.99')).status,
      ).toBe(401);
    expect((await login('01999999999', 'wrong', '198.51.100.100')).status).toBe(
      429,
    );
  },
);

it(
  'returns the same balances as the admin, scoped only to the signed-in brand',
  { timeout: 20000 },
  async () => {
    const expected = paymentSummarySchema.parse(
      await (await call('/api/manage/receipts/account/' + a)).json(),
    );
    const response = await call(
      '/api/portal/payment-summary',
      'GET',
      undefined,
      aCookie,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);
    expect(expected.ads.paid).toBe(10000);
    expect(expected.ads.due).toBeGreaterThan(0);
    expect(
      (await call('/api/portal/payment-summary', 'GET', undefined, '')).status,
    ).toBe(401);
    expect(
      (
        await call(
          '/api/portal/payment-summary?brandId=' + b,
          'GET',
          undefined,
          aCookie,
        )
      ).status,
    ).toBe(422);
    const empty = await makeBrand('Empty portal balance');
    expect((await provision(empty, 'empty-balance-owner')).status).toBe(200);
    const cookie = cookieFrom(await login('empty-balance-owner'));
    const zero = { billed: 0, paid: 0, due: 0, credit: 0 };
    expect(
      await (
        await call('/api/portal/payment-summary', 'GET', undefined, cookie)
      ).json(),
    ).toEqual({
      commission: zero,
      ads: zero,
      commissionBasisPoints: 1500,
      advance: { received: 0, used: 0, balance: 0 },
      totalPaid: 0,
      totalReceived: 0,
    });
  },
);

it(
  'rejects expired administrator and brand sessions at the server boundary',
  { timeout: 20000 },
  async () => {
    const owner = cookieFrom(await login('01700000001'));
    const administrator = cookieFrom(
      await call(
        '/api/auth/login',
        'POST',
        { username: 'admin', password: adminPassword },
        '',
      ),
    );
    for (const [table, cookie] of [
      ['brand_sessions', owner],
      ['sessions', administrator],
    ] as const) {
      expect(cookie).not.toBe('');
      await fixture.env.DB.prepare(
        `UPDATE ${table} SET expires_at=? WHERE token_hash=?`,
      )
        .bind(Date.now() - 1, await digest(cookie.split('=')[1] ?? ''))
        .run();
    }
    expect(
      (await call('/api/portal/payment-summary', 'GET', undefined, owner))
        .status,
    ).toBe(401);
    expect(
      (await call('/api/manage/bootstrap', 'GET', undefined, administrator))
        .status,
    ).toBe(401);
    expect(
      await (
        await call('/api/brand-auth/status', 'GET', undefined, owner)
      ).json(),
    ).toEqual({ brand: null });
    expect(
      await (
        await call('/api/auth/status', 'GET', undefined, administrator)
      ).json(),
    ).toEqual({ initialized: true, username: null });
    expect((await call('/api/manage/bootstrap')).status).toBe(200);
  },
);

it(
  'changes the admin login username/password, preserves data and revokes old sessions only',
  { timeout: 20000 },
  async () => {
    const other = cookieFrom(
      await call(
        '/api/auth/login',
        'POST',
        { username: 'admin', password: adminPassword },
        '',
      ),
    );
    expect(
      (
        await call('/api/auth/account', 'PUT', {
          username: 'owner-new',
          currentPassword: 'wrong',
          version: 0,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('/api/auth/account', 'PUT', {
          username: '',
          currentPassword: adminPassword,
          version: 0,
        })
      ).status,
    ).toBe(422);
    const newPass = 'new administrator password passphrase';
    const changed = await call('/api/auth/account', 'PUT', {
      username: 'owner-new',
      currentPassword: adminPassword,
      password: newPass,
      version: 0,
    });
    expect(changed.status).toBe(200);
    const fresh = cookieFrom(changed);
    expect(fresh).not.toBe('');
    expect(
      (await call('/api/manage/bootstrap', 'GET', undefined, adminCookie))
        .status,
    ).toBe(401);
    expect(
      (await call('/api/manage/bootstrap', 'GET', undefined, other)).status,
    ).toBe(401);
    expect(
      (await call('/api/manage/bootstrap', 'GET', undefined, fresh)).status,
    ).toBe(200);
    expect(
      (await call('/api/portal/settings', 'GET', undefined, aCookie)).status,
    ).toBe(200);
    expect(
      (
        await call(
          '/api/auth/login',
          'POST',
          { username: 'admin', password: newPass },
          '',
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          '/api/auth/login',
          'POST',
          { username: 'owner-new', password: adminPassword },
          '',
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await call(
          '/api/auth/login',
          'POST',
          { username: 'owner-new', password: newPass },
          '',
        )
      ).status,
    ).toBe(200);
    expect(
      (await call('/api/manage/advertising/' + adsA, 'GET', undefined, fresh))
        .status,
    ).toBe(200);
    const usernameOnly = await call(
      '/api/auth/account',
      'PUT',
      { username: 'owner-next', currentPassword: newPass, version: 1 },
      fresh,
    );
    expect(usernameOnly.status).toBe(200);
    expect(
      (
        await call(
          '/api/auth/login',
          'POST',
          { username: 'owner-next', password: newPass },
          '',
        )
      ).status,
    ).toBe(200);
    adminCookie = cookieFrom(usernameOnly);
  },
);
