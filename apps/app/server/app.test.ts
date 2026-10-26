import { describe, expect, it } from 'vitest';

import { app } from './app';

describe('API', () => {
  it('fails safely when the initial admin secret has not been configured', async () => {
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
          password: 'a long test-only password',
          setupToken: 'x'.repeat(32),
        }),
      },
      {
        ADMIN_SETUP_TOKEN: '',
        PASSWORD_PEPPER: '',
        get FILES(): R2Bucket {
          throw new Error('Files must not be accessed');
        },
        get DB(): D1Database {
          throw new Error('Setup without a secret must not access D1');
        },
      },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error:
        'Admin setup is not configured. Set ADMIN_SETUP_TOKEN before creating the admin account.',
    });
  });
  it('serves health without querying D1', async () => {
    const response = await app.request(
      '/api/health',
      {},
      {
        ADMIN_SETUP_TOKEN: '',
        PASSWORD_PEPPER: '',
        get FILES(): R2Bucket {
          throw new Error('Files must not be accessed');
        },
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
