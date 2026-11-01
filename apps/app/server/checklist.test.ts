import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import { app } from './app';
import { testEnvironment } from './test-environment';
import { checklistPage, checklistState } from '../shared/checklist';

let fixture: Awaited<ReturnType<typeof testEnvironment>>;
let cookie = '';
const ids: string[] = [];
function request(path: string, method = 'GET', body?: unknown) {
  return app.request(
    `/api/manage/daily-checklist${path}`,
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
  const setup = await app.request(
    '/api/auth/setup',
    {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'checklist-admin',
        password: 'checklist integration password',
        setupToken: fixture.env.ADMIN_SETUP_TOKEN,
      }),
    },
    fixture.env,
  );
  expect(setup.status).toBe(201);
  const login = await app.request(
    '/api/auth/login',
    {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'checklist-admin',
        password: 'checklist integration password',
      }),
    },
    fixture.env,
  );
  expect(login.status).toBe(200);
  cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
  for (let i = 0; i < 43; i++) ids.push(crypto.randomUUID());
  await fixture.env.DB.batch(
    ids.map((id, i) =>
      fixture.env.DB.prepare(
        'INSERT INTO brands (id,name,normalized_name,created_at,updated_at) VALUES (?,?,?,1,1)',
      ).bind(
        id,
        `Checklist ${String(i).padStart(2, '0')}`,
        `checklist ${String(i).padStart(2, '0')}`,
      ),
    ),
  );
}, 15000);
afterAll(async () => {
  await fixture.runtime.dispose();
});

it('requires admin access and validates checklist inputs', async () => {
  const saved = cookie;
  cookie = '';
  expect((await request('?date=2026-11-01')).status).toBe(401);
  cookie = saved;
  for (const query of [
    '?date=2026-02-30',
    '?date=nope',
    '?date=2026-11-01&extra=1',
  ])
    expect((await request(query)).status).toBe(422);
  expect(
    (await request(`/${crypto.randomUUID()}?date=2026-11-01`)).status,
  ).toBe(404);
  expect(
    (
      await request(`/${ids[0] ?? ''}`, 'PATCH', {
        date: '2026-11-01',
        task: 'unknown',
        done: true,
        revision: 0,
      })
    ).status,
  ).toBe(422);
});

it('lazily lists every brand without creating task records', async () => {
  const seen: string[] = [];
  let after = '';
  do {
    const response = await request(
      `?date=2026-11-01${after ? `&after=${encodeURIComponent(after)}` : ''}`,
    );
    expect(response.status).toBe(200);
    const page = checklistPage.parse(await response.json());
    expect(page.items.length).toBeLessThanOrEqual(20);
    for (const item of page.items) {
      seen.push(item.id);
      expect(item.ordersDone).toBe(false);
      expect(item.adsDone).toBe(false);
      expect(item.revision).toBe(0);
    }
    after = page.next?.after ?? '';
  } while (after);
  expect(new Set(seen).size).toBe(43);
  expect(
    await fixture.env.DB.prepare('SELECT COUNT(*) AS n FROM daily_tasks').first(
      'n',
    ),
  ).toBe(0);
});

it('saves independent dates and tasks, rejecting stale concurrent edits', async () => {
  const path = `/${ids[0] ?? ''}`;
  const body = {
    date: '2026-11-01',
    task: 'ordersDone',
    done: true,
    revision: 0,
  };
  const first = await request(path, 'PATCH', body);
  expect(first.status).toBe(200);
  expect(
    z.object({ item: checklistState }).parse(await first.json()).item,
  ).toEqual({ ordersDone: true, adsDone: false, revision: 1 });
  expect(
    (await request(path, 'PATCH', { ...body, task: 'adsDone' })).status,
  ).toBe(409);
  const concurrent = await Promise.all([
    request(path, 'PATCH', { ...body, task: 'adsDone', revision: 1 }),
    request(path, 'PATCH', { ...body, done: false, revision: 1 }),
  ]);
  expect(concurrent.map((result) => result.status).sort()).toEqual([200, 409]);
  const state = z
    .object({ item: checklistState })
    .parse(await (await request(`${path}?date=2026-11-01`)).json()).item;
  expect(state.revision).toBe(2);
  expect(
    (await request(path, 'PATCH', { ...body, date: '2026-11-02' })).status,
  ).toBe(200);
  const other = z
    .object({ item: checklistState })
    .parse(
      await (await request(`/${ids[1] ?? ''}?date=2026-11-01`)).json(),
    ).item;
  expect(other).toEqual({ ordersDone: false, adsDone: false, revision: 0 });
  expect(
    await fixture.env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first('n'),
  ).toBe(0);
  expect(
    await fixture.env.DB.prepare('SELECT COUNT(*) AS n FROM daily_ads').first(
      'n',
    ),
  ).toBe(0);
});

it('retains revisions when unchecked and cascades only the deleted brand checklist', async () => {
  const id = ids[2] ?? '';
  const body = {
    date: '2026-11-01',
    task: 'ordersDone',
    done: true,
    revision: 0,
  };
  expect((await request(`/${id}`, 'PATCH', body)).status).toBe(200);
  expect(
    (await request(`/${id}`, 'PATCH', { ...body, done: false, revision: 1 }))
      .status,
  ).toBe(200);
  expect((await request(`/${id}`, 'PATCH', body)).status).toBe(409);
  await fixture.env.DB.prepare('DELETE FROM brands WHERE id=?').bind(id).run();
  expect(
    await fixture.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM daily_tasks WHERE brand_id=?',
    )
      .bind(id)
      .first('n'),
  ).toBe(0);
  expect(
    await fixture.env.DB.prepare('SELECT COUNT(*) AS n FROM daily_tasks').first(
      'n',
    ),
  ).toBe(2);
  const plan = await fixture.env.DB.prepare(
    'EXPLAIN QUERY PLAN SELECT b.id FROM brands b LEFT JOIN daily_tasks t ON t.date=? AND t.brand_id=b.id WHERE b.normalized_name>? ORDER BY b.normalized_name LIMIT 21',
  )
    .bind('2026-11-01', 'checklist')
    .all();
  expect(JSON.stringify(plan.results)).toContain('INDEX');
});
