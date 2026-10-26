import { sql } from 'drizzle-orm';
import { Miniflare } from 'miniflare';
import { expect, it } from 'vitest';

import { createDatabase } from './client';

it('executes a parameterized Drizzle query against local D1', async () => {
  const runtime = new Miniflare({
    modules: true,
    script:
      'export default { fetch() { return new Response(null, { status: 204 }); } };',
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
  });

  try {
    const binding = await runtime.getD1Database('DB');
    const database = createDatabase(binding);
    const result = await database.get<{ value: number }>(
      sql`SELECT ${1} AS value`,
    );
    expect(result).toEqual({ value: 1 });
  } finally {
    await runtime.dispose();
  }
});
