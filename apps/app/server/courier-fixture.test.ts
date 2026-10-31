import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { URL } from 'node:url';
import { readSheet } from 'read-excel-file/node';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { expect, it } from 'vitest';
import {
  courierPdfRows,
  importMapping,
  mapOrder,
} from '@settlement/domain/imports';
import type { PdfCell } from '@settlement/domain/imports';

const folder = new URL('../../../assets/', import.meta.url);
const names = existsSync(folder) ? readdirSync(folder) : [];
const pdfName = names.find(
  (name) => name.startsWith('consignments') && name.endsWith('.pdf'),
);
const xlsxName = names.find(
  (name) => name.startsWith('consignments') && name.endsWith('.xlsx'),
);

it.skipIf(!names.includes('pathao_deliveries_2026-10-31.xlsx'))(
  'reconciles every Pathao source row with the admin’s collection and return rules',
  async () => {
    const raw = await readSheet(
      readFileSync(new URL('pathao_deliveries_2026-10-31.xlsx', folder)),
    );
    const rows = raw.map((row) =>
      row.map((cell) =>
        cell === null
          ? ''
          : cell instanceof Date
            ? cell.toISOString().slice(0, 10)
            : String(cell),
      ),
    );
    const mapping = importMapping(rows[0] ?? [], 'pathao');
    const parsed = rows
      .slice(1)
      .map((row) =>
        mapOrder(row, mapping, 'ISO', 'courier', false, false, 'pathao'),
      );
    expect(parsed).toHaveLength(216);
    expect(new Set(parsed.map((row) => row.id)).size).toBe(216);
    expect(parsed.filter((row) => row.status === 'Delivered')).toHaveLength(
      119,
    );
    expect(parsed.filter((row) => row.status === 'Cancelled')).toHaveLength(52);
    expect(parsed.filter((row) => row.status === 'Pending')).toHaveLength(45);
    expect(
      parsed.filter((row) => row.status === 'Partial Delivered'),
    ).toHaveLength(0);
    expect(parsed.reduce((sum, row) => sum + row.codAmount, 0)).toBe(204869000);
    expect(
      parsed.reduce((sum, row) => sum + (row.collectedAmount ?? 0), 0),
    ).toBe(117979000);
    expect(
      parsed
        .filter((row) => row.status === 'Delivered')
        .reduce((sum, row) => sum + row.codCharge, 0),
    ).toBe(922050);
    for (const [i, row] of parsed.entries()) {
      const source = raw[i + 1];
      if (!source) throw new Error('Missing source row');
      expect(row.id).toBe(String(source[0]));
      expect(row.codAmount).toBe(Math.round(Number(source[2]) * 1000));
      expect(row.collectedAmount).toBe(Math.round(Number(source[3]) * 1000));
      expect(row.codCharge).toBe(Math.round(Number(source[4]) * 1000));
      expect(row.shipping).toBe(Math.round(Number(source[5]) * 1000));
      expect(row.status).toBe(
        source[7] === 'Return'
          ? 'Cancelled'
          : Number(source[3]) > 0
            ? 'Delivered'
            : 'Pending',
      );
    }
  },
);

it.skipIf(pdfName === undefined || xlsxName === undefined)(
  'matches every cell of the supplied seven-page courier PDF against the original spreadsheet',
  async () => {
    if (pdfName === undefined || xlsxName === undefined)
      throw new Error('Missing local courier fixtures.');
    const workbook = await readSheet(readFileSync(new URL(xlsxName, folder)));
    const expected = workbook.map((row) =>
      row.map((cell) =>
        cell === null
          ? ''
          : cell instanceof Date
            ? cell.toISOString().slice(0, 10)
            : String(cell),
      ),
    );
    const task = getDocument({
      data: new Uint8Array(readFileSync(new URL(pdfName, folder))),
    });
    const document = await task.promise;
    try {
      const pages: PdfCell[][] = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
        const content = await (
          await document.getPage(pageNumber)
        ).getTextContent();
        const cells: PdfCell[] = [];
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          const x: unknown = item.transform[4];
          const y: unknown = item.transform[5];
          if (typeof x !== 'number' || typeof y !== 'number')
            throw new Error('Missing PDF coordinates.');
          cells.push({ text: item.str.trim(), x, y, width: item.width });
        }
        pages.push(cells);
      }
      const actual = courierPdfRows(pages);
      expect(actual).toEqual(expected);
      expect(actual).toHaveLength(392);
      const mapping = {
        orderDate: 0,
        id: 1,
        status: 2,
        deliveryDate: 3,
        codAmount: 4,
        shipping: 5,
        codCharge: 6,
      };
      const parsed = actual
        .slice(1)
        .map((row) => mapOrder(row, mapping, 'ISO', 'courier', true, true));
      expect(new Set(parsed.map((row) => row.id)).size).toBe(391);
      expect(parsed.filter((row) => row.status === 'Delivered')).toHaveLength(
        241,
      );
      expect(
        parsed.filter((row) => row.status === 'Partial Delivered'),
      ).toHaveLength(50);
      expect(parsed.filter((row) => row.status === 'Cancelled')).toHaveLength(
        57,
      );
      expect(parsed.filter((row) => row.status === 'Pending')).toHaveLength(43);
      expect(() =>
        actual.slice(1).map((row) => mapOrder(row, mapping, 'ISO', 'courier')),
      ).toThrow();
    } finally {
      await task.destroy();
    }
  },
  30_000,
);
