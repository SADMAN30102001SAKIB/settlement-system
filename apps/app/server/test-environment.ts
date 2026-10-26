import { readFileSync, readdirSync } from 'node:fs';
import { URL } from 'node:url';
import { Miniflare } from 'miniflare';
import { randomToken } from './auth/crypto';

export async function testEnvironment() {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response(null); } };',
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
    r2Buckets: ['FILES'],
  });
  const bindings = await runtime.getBindings<Pick<Env, 'DB' | 'FILES'>>();
  const folder = new URL(
    '../../../packages/database/migrations/',
    import.meta.url,
  );
  for (const filename of readdirSync(folder)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const migration = readFileSync(new URL(filename, folder), 'utf8');
    await bindings.DB.batch(
      migration
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .map((statement) => bindings.DB.prepare(statement)),
    );
  }
  return {
    runtime,
    env: { ...bindings, ADMIN_SETUP_TOKEN: randomToken() } satisfies Env,
  };
}
