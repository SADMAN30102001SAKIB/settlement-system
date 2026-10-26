import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Miniflare } from 'miniflare';
import { expect, it } from 'vitest';

it('migrates legacy/v2 invoices without changing amounts or losing linked payments', async () => {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response(null); } };',
    compatibilityDate: '2026-07-30',
    d1Databases: ['DB'],
  });
  try {
    const db = await runtime.getD1Database('DB');
    async function migrate(file: string) {
      const sql = readFileSync(
        new URL(
          `../../../packages/database/migrations/${file}`,
          import.meta.url,
        ),
        'utf8',
      );
      await db.batch(
        sql
          .split('--> statement-breakpoint')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => db.prepare(part)),
      );
    }
    await migrate('0000_easy_microbe.sql');
    await migrate('0001_nervous_magma.sql');
    await db
      .prepare(
        "INSERT INTO brands (id,name,normalized_name,making_cost,created_at,updated_at) VALUES ('brand','Brand','brand',100000,1,1)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO files (id,object_key,filename,mime,size,kind,created_at) VALUES ('proof','proof','proof.png','image/png',100,'proof',1)",
      )
      .run();
    for (const rule of ['legacy', 'v2']) {
      await db
        .prepare(
          `INSERT INTO settlements (id,invoice_number,brand_id,brand_name,date,period,rule,delivered_qty,delivered_amount,cancelled_qty,cancelled_amount,partial_qty,partial_amount,shipping,cod_charge,ads,product_cost,agency_basis_points,gross,net,commission,created_at,updated_at) VALUES (?,?,'brand','Brand','2026-10-01','October',?,1,500000,1,100000,1,50000,10000,5000,20000,100000,1500,435000,315000,47250,1,1)`,
        )
        .bind(rule, rule, rule)
        .run();
      await db
        .prepare(
          "INSERT INTO payments (id,settlement_id,amount,date,proof_file_id,created_at) VALUES (?,?,10000,'2026-10-01','proof',1)",
        )
        .bind(`payment-${rule}`, rule)
        .run();
    }
    await db
      .prepare(
        "INSERT INTO payments (id,brand_id,amount,date,proof_file_id,created_at) VALUES ('advance','brand',20000,'2026-10-01','proof',1)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO ad_invoices (id,invoice_number,brand_id,brand_name,date,period,normalized_period,total,created_at,updated_at) VALUES ('ads','ADS-1','brand','Brand','2026-10-01','October','october',100000,1,1)",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO payments (id,ad_invoice_id,amount,date,proof_file_id,created_at) VALUES ('ad-payment','ads',10000,'2026-10-01','proof',1)",
      )
      .run();
    const before = await db.prepare('SELECT * FROM payments ORDER BY id').all();
    const invoices = await db
      .prepare(
        'SELECT id,rule,gross,net,commission,revision FROM settlements ORDER BY id',
      )
      .all();
    await migrate('0002_brief_whiplash.sql');
    expect(
      (await db.prepare('SELECT * FROM payments ORDER BY id').all()).results,
    ).toEqual(before.results);
    expect(
      (
        await db
          .prepare(
            'SELECT id,rule,gross,net,commission,revision FROM settlements ORDER BY id',
          )
          .all()
      ).results,
    ).toEqual(invoices.results);
    expect(
      (await db.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
    expect(
      (
        await db
          .prepare(
            'SELECT delivered_cod_charge,partial_cod_charge,vat_basis_points FROM settlements',
          )
          .all()
      ).results,
    ).toEqual([
      {
        delivered_cod_charge: 0,
        partial_cod_charge: 0,
        vat_basis_points: 1000,
      },
      {
        delivered_cod_charge: 0,
        partial_cod_charge: 0,
        vat_basis_points: 1000,
      },
    ]);
  } finally {
    await runtime.dispose();
  }
}, 20000);
