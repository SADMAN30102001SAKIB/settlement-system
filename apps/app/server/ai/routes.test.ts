import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { testEnvironment } from '../test-environment';
import { app } from '../app';
import { aiTurnList, aiCredentialStatus } from '../../shared/ai';
import type { runChat as run } from './engine';
import { runChat } from './engine';
import { z } from 'zod';

vi.mock('./engine', () => ({
  runChat: vi.fn(),
  providerError: () => 'Provider request failed. Try again.',
}));
let setup: Awaited<ReturnType<typeof testEnvironment>>;
let cookie = '';
const password = 'local-ai-test-administrator-password';
const keys = {
  geminiKey: 'fake-gemini-key-for-tests',
  metaToken: 'fake-meta-token-for-tests',
};
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  authenticated = true,
) {
  return app.request(
    `/api/${path}`,
    {
      method,
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
        ...(authenticated ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    setup.env,
  );
}
beforeAll(async () => {
  setup = await testEnvironment();
  const r = await request(
    'auth/setup',
    'POST',
    { username: 'ai-admin', password, setupToken: setup.env.ADMIN_SETUP_TOKEN },
    false,
  );
  expect(r.status).toBe(201);
  const login = await request(
    'auth/login',
    'POST',
    { username: 'ai-admin', password },
    false,
  );
  cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  expect(cookie).not.toBe('');
});
afterAll(async () => {
  await setup.runtime.dispose();
});
it('keeps credentials isolated, password-confirmed and concurrency-safe', async () => {
  expect(
    (await request('manage/ai/credentials', 'GET', undefined, false)).status,
  ).toBe(401);
  expect(
    (
      await request('manage/ai/credentials', 'PUT', {
        ...keys,
        password: 'incorrect',
        revision: 0,
      })
    ).status,
  ).toBe(403);
  let response = await request('manage/ai/credentials', 'PUT', {
    ...keys,
    password,
    revision: 0,
  });
  expect(response.status).toBe(200);
  expect(aiCredentialStatus.parse(await response.json())).toEqual({
    configured: true,
    revision: 1,
  });
  expect(
    (
      await request('manage/ai/credentials', 'PUT', {
        ...keys,
        password,
        revision: 0,
      })
    ).status,
  ).toBe(409);
  response = await request('manage/ai/credentials');
  const output = await response.text();
  expect(output).not.toContain(keys.geminiKey);
  expect(output).not.toContain(keys.metaToken);
  expect(await (await request('manage/bootstrap')).text()).not.toContain(
    keys.geminiKey,
  );
  expect(await (await request('manage/settings')).text()).not.toContain(
    keys.metaToken,
  );
  expect(
    (
      await request('manage/ai/credentials', 'PUT', {
        geminiKey: 'replacement-gemini-key',
        password,
        revision: 1,
      })
    ).status,
  ).toBe(200);
  expect(
    await setup.env.DB.prepare(
      'SELECT meta_token AS token FROM ai_credentials WHERE id=1',
    ).first('token'),
  ).toBe(keys.metaToken);
});
it('streams and saves turns, supplies only server-owned context, and does not replay duplicate submissions', async () => {
  const id = crypto.randomUUID(),
    turnId = crypto.randomUUID();
  await request('manage/ai/conversations', 'POST', { id });
  vi.mocked(runChat).mockImplementation(async (options) => {
    await options.check();
    await options.emit({ type: 'delta', text: 'Verified response' });
    return {
      answer: 'Verified response',
      history: [
        { role: 'user', parts: [{ text: options.question }] },
        { role: 'model', parts: [{ text: 'Verified response' }] },
      ],
    };
  });
  const r = await request(`manage/ai/conversations/${id}/messages`, 'POST', {
    id: turnId,
    question: 'Hello',
    revision: 0,
  });
  expect(r.headers.get('content-type')).toContain('text/event-stream');
  const data = await r.text();
  expect(data).toContain('Verified response');
  expect(data).toContain('"done"');
  const saved = aiTurnList.parse(
    await (await request(`manage/ai/conversations/${id}`)).json(),
  );
  expect(saved.items[0]).toMatchObject({
    status: 'complete',
    answer: 'Verified response',
  });
  expect(
    (
      await request(`manage/ai/conversations/${id}/messages`, 'POST', {
        id: turnId,
        question: 'Hello',
        revision: 1,
      })
    ).status,
  ).toBe(409);
  expect(runChat).toHaveBeenCalledTimes(1);
  expect(
    (
      await request(`manage/ai/conversations/${id}/messages`, 'POST', {
        id: crypto.randomUUID(),
        question: 'Follow up',
        revision: 0,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await request(`manage/ai/conversations/${id}/messages`, 'POST', {
        id: crypto.randomUUID(),
        question: 'Follow up',
        revision: 1,
        history: [],
      })
    ).status,
  ).toBe(422);
  const next = await request(`manage/ai/conversations/${id}/messages`, 'POST', {
    id: crypto.randomUUID(),
    question: 'Follow up',
    revision: 1,
  });
  await next.text();
  expect(vi.mocked(runChat).mock.calls.at(-1)?.[0].history).toHaveLength(2);
  expect(
    (await request(`manage/ai/conversations/${id}`, 'DELETE', {})).status,
  ).toBe(200);
  expect(
    await setup.env.DB.prepare(
      'SELECT id FROM ai_turns WHERE conversation_id=?',
    )
      .bind(id)
      .first(),
  ).toBe(null);
});
it('denies a valid brand login access to AI chats and never includes tokens in portal settings', async () => {
  const brand = z.object({ item: z.object({ id: z.string() }) }).parse(
    await (
      await request('manage/brands', 'POST', {
        name: 'AI isolation brand',
        makingCost: 0,
      })
    ).json(),
  );
  const provision = await request(
    `manage/brand-access/${brand.item.id}`,
    'PUT',
    {
      username: 'ai-brand-owner',
      password: 'brand-owner-test-password',
      enabled: true,
      version: 0,
      currentPassword: password,
    },
  );
  expect(provision.status).toBe(200);
  const login = await request(
    'brand-auth/login',
    'POST',
    { username: 'ai-brand-owner', password: 'brand-owner-test-password' },
    false,
  );
  const brandCookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  expect(brandCookie).not.toBe('');
  const portal = await app.request(
    '/api/portal/settings',
    { headers: { Cookie: brandCookie } },
    setup.env,
  );
  expect(portal.status).toBe(200);
  const output = await portal.text();
  expect(output).not.toContain(keys.metaToken);
  expect(output).not.toContain('replacement-gemini-key');
  for (const path of ['credentials', 'conversations'])
    expect(
      (
        await app.request(
          `/api/manage/ai/${path}`,
          { headers: { Cookie: brandCookie } },
          setup.env,
        )
      ).status,
    ).toBe(401);
});
it('cancels an active turn and rejects its late completion without changing business data', async () => {
  const id = crypto.randomUUID();
  await request('manage/ai/conversations', 'POST', { id });
  let release: ((value: Awaited<ReturnType<typeof run>>) => void) | undefined;
  vi.mocked(runChat).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const response = await request(
    `manage/ai/conversations/${id}/messages`,
    'POST',
    { id: crypto.randomUUID(), question: 'Long request', revision: 0 },
  );
  const consume = response.text();
  await vi.waitFor(() => {
    expect(release).toBeDefined();
  });
  expect(
    (await request(`manage/ai/conversations/${id}`, 'DELETE', {})).status,
  ).toBe(409);
  expect(
    (
      await request(`manage/ai/conversations/${id}/messages`, 'POST', {
        id: crypto.randomUUID(),
        question: 'Concurrent',
        revision: 1,
      })
    ).status,
  ).toBe(409);
  await request(`manage/ai/conversations/${id}/cancel`, 'POST', {});
  release?.({ answer: 'Must not be saved', history: [] });
  await consume;
  const saved = aiTurnList.parse(
    await (await request(`manage/ai/conversations/${id}`)).json(),
  );
  expect(saved.items[0]?.status).toBe('cancelled');
  expect(saved.items[0]?.answer).not.toBe('Must not be saved');
});
it('has bounded indexed conversation/message lists and recovers failed provider turns', async () => {
  const id = crypto.randomUUID();
  await request('manage/ai/conversations', 'POST', { id });
  vi.mocked(runChat).mockRejectedValue(new Error('secret provider failure'));
  const r = await request(`manage/ai/conversations/${id}/messages`, 'POST', {
    id: crypto.randomUUID(),
    question: 'Fail',
    revision: 0,
  });
  expect(await r.text()).not.toContain('secret provider failure');
  expect(
    aiTurnList.parse(
      await (await request(`manage/ai/conversations/${id}`)).json(),
    ).items[0]?.status,
  ).toBe('error');
  expect(
    (await request(`manage/ai/conversations/${id}`, 'DELETE', {})).status,
  ).toBe(200);
  const plans = await setup.env.DB.prepare(
    'EXPLAIN QUERY PLAN SELECT id FROM ai_turns WHERE conversation_id=? AND sequence<? ORDER BY sequence DESC LIMIT 21',
  )
    .bind(id, 100)
    .all();
  expect(JSON.stringify(plans.results)).toContain(
    'ai_turns_conversation_sequence_idx',
  );
  expect((await request('manage/ai/conversations?before=12')).status).toBe(422);
  const disconnected = await request('manage/ai/credentials', 'DELETE', {
    password,
    revision: 2,
  });
  expect(
    z.object({ configured: z.boolean() }).parse(await disconnected.json())
      .configured,
  ).toBe(false);
});
