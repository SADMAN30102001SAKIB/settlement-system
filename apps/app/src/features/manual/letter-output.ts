import type { LetterLayout } from '../../../shared/letter';
import { paperDimensions } from '../../../shared/letter';
import {
  fitLetterTables,
  sheetCount,
  sheetGap,
  sheetMetrics,
} from './letter-layout';
import { applyLetterInlineStyles } from './letter-inline-styles';

export function printLetter(layout: LetterLayout) {
  const { width, height } = paperDimensions(layout);
  const toInches = (value: number) => `${String(value)}in`;
  const size = [width, height].map(toInches).join(' ');
  const margins = [layout.top, layout.right, layout.bottom, layout.left]
    .map(toInches)
    .join(' ');
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(
    `@page { size: ${size}; margin: ${margins}; background: ${layout.color}; } @media print { body { --letter-print-color: ${layout.color}; } }`,
  );
  const clean = () => {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (value) => value !== sheet,
    );
  };
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  window.addEventListener('afterprint', clean, { once: true });
  window.print();
}

export async function downloadLetter(
  root: HTMLElement,
  filename: string,
  layout: LetterLayout,
) {
  const track = root.querySelector<HTMLElement>('.letter-sheets-track');
  const flow = track?.querySelector<HTMLElement>('.letter-sheet-flow');
  if (!track || !flow) return;
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]).catch((cause: unknown) => {
    window.dispatchEvent(new Event('pdf:loadError'));
    throw new Error(
      'PDF tools could not load. Reload the app and try again, or use Print.',
      { cause },
    );
  });
  await document.fonts.ready;
  await Promise.all(
    [...track.querySelectorAll('img')].map((image) =>
      image.decode().catch(() => undefined),
    ),
  );
  const { width, height } = sheetMetrics(layout);
  const physical = paperDimensions(layout);
  const format = [physical.width, physical.height];
  const orientation = layout.orientation;
  const pdf = new jsPDF({ unit: 'in', format, orientation, compress: true });
  const pages = sheetCount(flow, layout);
  if (pages > 100)
    throw new Error(
      'This letter is over 100 pages. Choose a larger paper size or remove some content.',
    );
  const bounds = track.getBoundingClientRect();
  const scale = bounds.height / height || 1;
  const links = [
    ...track.querySelectorAll<HTMLAnchorElement>('a[href]'),
  ].flatMap((link) =>
    [...link.getClientRects()].map((rect) => ({
      url: link.href,
      x: (rect.left - bounds.left) / scale,
      y: (rect.top - bounds.top) / scale,
      w: rect.width / scale,
      h: rect.height / scale,
    })),
  );
  for (let index = 0; index < pages; index++) {
    const offset = index * (width + sheetGap);
    const canvas = await html2canvas(track, {
      scale: Math.min(2, 2400 / Math.max(width, height)),
      width,
      height,
      x: offset,
      backgroundColor: layout.color,
      logging: false,
      windowWidth: 1440,
      onclone: (cloned) => {
        const view = cloned.querySelector<HTMLElement>(
          '.letter-saved .letter-sheets-viewport',
        );
        if (!view) return;
        view.style.overflow = 'visible';
        view.scrollLeft = 0;
        view.style.setProperty('--letter-scale', '1');
        const target = view.querySelector<HTMLElement>('.letter-sheets-track');
        if (target) {
          target.style.background = 'none';
          applyLetterInlineStyles(target);
          const rendered =
            target.querySelector<HTMLElement>('.letter-sheet-flow');
          if (rendered) fitLetterTables(rendered);
        }
      },
    });
    if (index) pdf.addPage(format, orientation);
    pdf.addImage(
      canvas,
      'PNG',
      0,
      0,
      physical.width,
      physical.height,
      undefined,
      'FAST',
    );
    for (const { url, x, y, w, h } of links) {
      if (x >= offset && x + w <= offset + width && y >= 0 && y + h <= height)
        pdf.link(
          ((x - offset) * physical.width) / width,
          (y * physical.height) / height,
          (w * physical.width) / width,
          (h * physical.height) / height,
          { url },
        );
    }
    canvas.width = 0;
    canvas.height = 0;
  }
  await pdf.save(`${filename}.pdf`, { returnPromise: true });
}
