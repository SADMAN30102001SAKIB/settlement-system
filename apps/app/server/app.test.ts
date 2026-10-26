import { describe, expect, it } from 'vitest';

import { app } from './app';

describe('API', () => {
  it('serves health without querying D1', async () => {
    const response = await app.request(
      '/api/health',
      {},
      {
        get DB(): D1Database {
          throw new Error('Health must not access D1');
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each(['/api', '/api/unknown'])('returns JSON 404 for %s', async (path) => {
    const response = await app.request(path);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });
});
