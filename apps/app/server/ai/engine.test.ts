import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runChat, providerError } from './engine';

afterEach(() => {
  vi.unstubAllGlobals();
});
const object = z.record(z.string(), z.unknown());
const field = {
  name: 'spend',
  levels: ['ad_account'],
  filterable: false,
  sortable: false,
  supported_filter_operators: [],
};
const schema = (name: string) => ({
  functionCall: { name: 'get_meta_tool_schema', args: { tool_name: name } },
});
const call = (name: string, args: Record<string, unknown> = {}) => ({
  functionCall: {
    name: 'read_meta_ads',
    args: { tool_name: name, arguments_json: JSON.stringify(args) },
  },
});
function fixture(
  mode: 'normal' | 'fallback' | 'quota' | 'denied' | 'unsafe' | 'limit',
) {
  let modelStep = 0,
    injected = false;
  const metaCalls: string[] = [];
  const modelRequests: Record<string, unknown>[] = [];
  const models: string[] = [];
  const gatewayHeaders: Headers[] = [];
  const actions = [
    schema('ads_get_ad_accounts'),
    call('ads_get_ad_accounts'),
    schema('ads_get_field_context'),
    call('ads_get_field_context', { field_names: ['spend'] }),
    schema('ads_get_ad_entities'),
    call('ads_get_ad_entities', { level: 'ad_account', fields: ['spend'] }),
  ];
  vi.stubGlobal(
    'fetch',
    async (input: string | URL | Request, init?: RequestInit) => {
      await Promise.resolve();
      const url = new URL(input instanceof Request ? input.url : input);
      if (init?.method !== 'POST') return new Response(null, { status: 405 });
      const request = object.parse(
        JSON.parse(typeof init.body === 'string' ? init.body : '{}') as unknown,
      );
      if (url.hostname === 'mcp.facebook.com') {
        expect(url.searchParams.has('key')).toBe(false);
        expect(new Headers(init.headers).has('cf-aig-authorization')).toBe(
          false,
        );
        const respond = (result: unknown) =>
          Response.json({ jsonrpc: '2.0', id: request['id'], result });
        if (request['method'] === 'initialize')
          return respond({
            protocolVersion: '2025-11-25',
            capabilities: { tools: {} },
            serverInfo: { name: 'fixture', version: '1' },
          });
        if (request['method'] === 'notifications/initialized')
          return new Response(null, { status: 202 });
        if (request['method'] === 'tools/list')
          return respond({
            tools: [
              'ads_get_ad_accounts',
              'ads_get_field_context',
              'ads_get_ad_entities',
              'ads_create_campaign',
            ].map((name) => ({
              name,
              inputSchema: { type: 'object' },
              annotations: { readOnlyHint: true, destructiveHint: false },
            })),
          });
        if (request['method'] === 'tools/call') {
          const params = z
            .object({ name: z.string() })
            .parse(request['params']);
          metaCalls.push(params.name);
          if (params.name === 'ads_create_campaign')
            throw new Error('A write reached Meta!');
          const data =
            params.name === 'ads_get_field_context'
              ? { fields: [field] }
              : params.name === 'ads_get_ad_entities'
                ? mode === 'denied'
                  ? { error_category: 'PERMISSION_DENIED' }
                  : { ad_entities: JSON.stringify([{ spend: 0 }]) }
                : { ad_accounts: [{ ad_account_id: 'fixture-account' }] };
          return respond({ content: [], structuredContent: data });
        }
      }
      if (url.hostname === 'gateway.ai.cloudflare.com') {
        expect(url.searchParams.get('key')).toBe('fixture-gemini-key');
        expect(url.searchParams.get('alt')).toBe('sse');
        expect(url.pathname).toMatch(
          /^\/v1\/fbca92db4dd551f67f6e982d4a70a914\/default\/google-ai-studio\/v1beta\/models\//,
        );
        gatewayHeaders.push(new Headers(init.headers));
        models.push(url.pathname);
        modelRequests.push(request);
        if (
          (mode === 'fallback' || mode === 'quota') &&
          modelStep === 2 &&
          !injected
        ) {
          injected = true;
          if (mode === 'quota')
            return Response.json(
              {
                error: {
                  code: 429,
                  message: 'Busy',
                  details: [{ retryDelay: '0.001s' }],
                },
              },
              { status: 429 },
            );
          return Response.json(
            {
              error: {
                code: 503,
                message: 'Unavailable',
                status: 'UNAVAILABLE',
              },
            },
            { status: 503 },
          );
        }
        const part =
          mode === 'limit'
            ? schema('ads_get_ad_accounts')
            : mode === 'unsafe' && modelStep === 1
              ? call('ads_create_campaign')
              : actions[modelStep];
        modelStep++;
        const content = part ?? {
          text: 'The returned spend is zero, not missing.',
        };
        return new Response(
          `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [content] }, finishReason: part ? 'STOP' : 'STOP' }] })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }
      throw new Error('Unexpected network request.');
    },
  );
  return { metaCalls, modelRequests, models, gatewayHeaders };
}
const options = () => ({
  geminiKey: 'fixture-gemini-key',
  metaToken: 'fixture-meta-token',
  gatewayToken: 'fixture-gateway-token',
  question: 'What was my spend yesterday?',
  history: [],
  signal: new AbortController().signal,
  check: async () => {
    await Promise.resolve();
  },
  emit: vi.fn(async () => {
    await Promise.resolve();
  }),
});

it('runs the real SDK streaming/tool loop and saves SDK history without losing zero', async () => {
  const f = fixture('normal'),
    opts = options();
  const result = await runChat(opts);
  expect(result.answer).toContain('zero');
  expect(f.gatewayHeaders.length).toBeGreaterThan(0);
  for (const headers of f.gatewayHeaders) {
    expect(headers.get('cf-aig-authorization')).toBe(
      'Bearer fixture-gateway-token',
    );
    expect(headers.get('cf-aig-skip-cache')).toBe('true');
    expect(headers.get('cf-aig-collect-log-payload')).toBe('false');
    expect(headers.get('cf-aig-max-attempts')).toBe('1');
    expect(headers.get('x-goog-api-key')).toBe('fixture-gemini-key');
  }
  expect(f.metaCalls).toEqual([
    'ads_get_ad_accounts',
    'ads_get_field_context',
    'ads_get_ad_entities',
  ]);
  expect(result.history.length).toBeGreaterThan(6);
  expect(opts.emit).toHaveBeenCalledWith({
    type: 'delta',
    text: result.answer,
  });
  expect(JSON.stringify(f.modelRequests)).toContain('row_count');
  expect(JSON.stringify(f.modelRequests[0]?.['tools'])).toContain(
    'read_meta_ads',
  );
  expect(JSON.stringify(f.modelRequests[0]?.['systemInstruction'])).toContain(
    'read-only Meta Ads analyst',
  );
  expect(JSON.stringify(f.modelRequests[0]?.['systemInstruction'])).toContain(
    '624037278949191',
  );
});
it('fails closed without gateway authentication instead of calling providers directly', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(runChat({ ...options(), gatewayToken: '' })).rejects.toThrow(
    'AI Gateway is not configured',
  );
  expect(fetch).not.toHaveBeenCalled();
});
it('switches models with pending tool results intact without replaying Meta reads', async () => {
  const f = fixture('fallback');
  await runChat(options());
  expect(f.metaCalls.filter((n) => n === 'ads_get_ad_accounts')).toHaveLength(
    1,
  );
  expect(f.modelRequests).toHaveLength(8);
  expect(f.modelRequests[2]?.['contents']).toEqual(
    f.modelRequests[3]?.['contents'],
  );
  expect(f.models.at(-1)).toContain('gemini-3.1-flash-lite');
});
it('honors a short quota delay without replaying Meta or losing pending results', async () => {
  const f = fixture('quota');
  await runChat(options());
  expect(f.metaCalls.filter((n) => n === 'ads_get_ad_accounts')).toHaveLength(
    1,
  );
  expect(f.modelRequests).toHaveLength(8);
  expect(f.models.at(-1)).toContain('gemini-3.5-flash-lite');
});
it('returns permission failures as evidence instead of fabricated zeros', async () => {
  const f = fixture('denied');
  await runChat(options());
  expect(JSON.stringify(f.modelRequests.at(-1))).toContain('PERMISSION_DENIED');
  expect(JSON.stringify(f.modelRequests.at(-1))).toContain('isError');
});
it('never dispatches a forbidden model tool and bounds repeated tool loops', async () => {
  const f = fixture('unsafe');
  await runChat(options());
  expect(f.metaCalls).not.toContain('ads_create_campaign');
  fixture('limit');
  await expect(runChat(options())).rejects.toThrow('round limit');
});
it('does not expose provider secrets or request details in generic failures', () => {
  expect(providerError(new Error('secret-token'))).not.toContain(
    'secret-token',
  );
  expect(providerError({ status: 401 })).toContain('credentials');
  expect(providerError({ status: 429 })).toContain('quota');
});
