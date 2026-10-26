# Project conventions

- Use pnpm from the repository root. Run `pnpm check` before finishing a change.
- `apps/app/src` is browser-only React. `apps/app/server` is Hono on Workers.
  `packages/database` owns Drizzle, schema definitions, and generated SQL migrations.
- Keep one Worker deployment with static assets. Only `/api` and `/api/*` should
  invoke application code; do not proxy static files through Hono.
- Group business code by feature when features exist. Share code with actual
  consumers, not speculative generic repositories, services, or utility packages.
- Do not invent business entities until requirements are agreed.
- Validate untrusted input at API boundaries. Keep secrets and DB code out of the
  browser bundle. Never cache private API responses in a shared cache.
- Use explicit SQL projections, indexed filters and sorting, bounded page sizes,
  and keyset pagination. A LIMIT alone does not bound scanned rows. Review
  `EXPLAIN QUERY PLAN` and D1 `meta.rows_read` on representative data before
  claiming a query is optimized. Add indexes for actual access paths; extra
  indexes increase storage and writes.
- Avoid N+1 queries, unbounded scans, routine COUNTs, polling, and redundant API
  calls. Batch related operations when appropriate; batching reduces round trips,
  not rows scanned. Choose caching and invalidation from actual data semantics.
- Generate migrations with `pnpm db:generate`, review their SQL, then use
  `pnpm db:migrate:local`. The development-only UUID in Cloudflare config and the
  migration command must match. Never use this local placeholder ID in production.
- Local tests and D1 emulation are not proof of production performance or quotas.
  Never deploy, provision remote resources, or migrate remote D1 without approval.
- Cloudflare configuration uses `cf` and `cloudflare.config.ts`; do not add a
  second Wrangler configuration. Regenerate binding types instead of hand-writing Env.
- Keep all strict source checks enabled. `skipLibCheck` skips dependency declaration
  checking because Drizzle publishes optional-driver types; it does not skip our
  source checks. TypeScript and ESLint are pinned to the lint plugins' supported majors.
