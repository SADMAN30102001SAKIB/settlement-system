import {
  defaultLetterLayout,
  letterLayout,
  paperDimensions,
} from '../../../shared/letter';
import type { LetterLayout } from '../../../shared/letter';

export const defaultLetterLayoutKey = 'hexa-letter-page-setup';
export function newLetterLayout(): LetterLayout {
  try {
    const saved = letterLayout.safeParse(
      JSON.parse(localStorage.getItem(defaultLetterLayoutKey) ?? 'null'),
    );
    if (saved.success) return saved.data;
  } catch {
    return defaultLetterLayout;
  }
  return defaultLetterLayout;
}

export const sheetGap = 24;
export function sheetMetrics(layout: LetterLayout) {
  const { width, height } = paperDimensions(layout);
  return {
    width: Math.round(width * 96 * 64) / 64,
    height: Math.round(height * 96 * 64) / 64,
    left: layout.left * 96,
    right: layout.right * 96,
    top: layout.top * 96,
    bottom: layout.bottom * 96,
  };
}

export function sheetCount(flow: HTMLElement, layout: LetterLayout) {
  const { width, left, right } = sheetMetrics(layout);
  return Math.max(
    1,
    Math.round(
      (flow.scrollWidth + left + right + sheetGap) / (width + sheetGap),
    ),
  );
}

export function fitLetterTables(flow: HTMLElement) {
  const available = flow.clientWidth;
  if (!available) return;
  for (const table of flow.querySelectorAll<HTMLTableElement>('table')) {
    const columns = [...table.querySelectorAll<HTMLTableColElement>('col')];
    const widths = columns.map(
      (column) => Number.parseFloat(column.style.width) || 25,
    );
    const total = widths.reduce((sum, width) => sum + width, 0);
    const overflow = total > available;
    if (table.hasAttribute('data-letter-fit') !== overflow)
      table.toggleAttribute('data-letter-fit', overflow);
    if (!overflow) continue;
    for (const [index, column] of columns.entries()) {
      const width = widths[index];
      if (width === undefined) continue;
      const share = `${String((100 * width) / total)}%`;
      if (column.style.getPropertyValue('--letter-col-fit') !== share)
        column.style.setProperty('--letter-col-fit', share);
    }
  }
}
