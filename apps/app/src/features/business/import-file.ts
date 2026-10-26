import { courierPdfRows, parseDelimited } from '@settlement/domain/imports';
import type { PdfCell } from '@settlement/domain/imports';

export async function readImport(file: File): Promise<string[][]> {
  if (file.size > 10_000_000)
    throw new Error('Choose a file smaller than 10 MB.');
  if (/\.(csv|tsv|txt)$/i.test(file.name))
    return parseDelimited(await file.text());
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser');
    const rows = await readSheet(file);
    if (rows.length > 2001)
      throw new Error('Import at most 2,000 orders at once.');
    return rows.map((row) =>
      row.map((cell) => {
        if (cell instanceof Date) return cell.toISOString().slice(0, 10);
        if (
          typeof cell === 'number' &&
          (!Number.isFinite(cell) || Math.abs(cell) > Number.MAX_SAFE_INTEGER)
        )
          throw new Error(
            'An Excel number exceeds safe precision. Export order IDs as text.',
          );
        return cell === null ? '' : String(cell);
      }),
    );
  }
  if (/\.pdf$/i.test(file.name)) {
    const pdfjs = await import('pdfjs-dist');
    const { default: workerUrl } =
      await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const task = pdfjs.getDocument({
      data: await file.arrayBuffer(),
    });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > 50)
        throw new Error('Import at most 50 PDF pages at once.');
      const pages: PdfCell[][] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const cells: PdfCell[] = [];
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          const x: unknown = item.transform[4];
          const y: unknown = item.transform[5];
          if (typeof x !== 'number' || typeof y !== 'number') continue;
          cells.push({ x, y, width: item.width, text: item.str.trim() });
        }
        pages.push(cells);
        page.cleanup();
      }
      const rows = courierPdfRows(pages);
      if (rows.length === 1)
        throw new Error(
          'This PDF has no readable orders. Use its original Excel/CSV; scanned amounts cannot be imported safely.',
        );
      if (rows.length > 2001)
        throw new Error('Too many extracted rows. Split the source document.');
      return rows;
    } finally {
      await task.destroy();
    }
  }
  throw new Error(
    'Use CSV, TSV, XLSX or a text-based PDF. Convert older XLS files to XLSX/CSV first.',
  );
}
