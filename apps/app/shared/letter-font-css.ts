import { googleFontAlias } from './letter-fonts';

function rangesWithoutBangla(range: string | undefined) {
  if (!range) return 'U+0-97F,U+A00-10FFFF';
  return range
    .split(',')
    .flatMap((part) => {
      const match = /^U\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(
        part.trim(),
      );
      if (!match?.[1] || !/^[0-9a-f]*\?*$/i.test(match[1])) return [];
      const start = Number.parseInt(match[1].replaceAll('?', '0'), 16);
      const end = Math.min(
        Number.parseInt(match[2] ?? match[1].replaceAll('?', 'F'), 16),
        0x10ffff,
      );
      const segments: [number, number][] = [
        [start, Math.min(end, 0x97f)],
        [Math.max(start, 0xa00), end],
      ];
      return segments
        .filter(([a, b]) => a <= b)
        .map(([a, b]) => `U+${a.toString(16)}-${b.toString(16)}`);
    })
    .join(',');
}

export function letterFontCss(family: string, source: string) {
  return [...source.matchAll(/@font-face\s*\{([^{}]+)\}/g)]
    .flatMap(([, body]) => {
      if (!body) return [];
      const style = /font-style:\s*(normal|italic);/.exec(body)?.[1];
      const weight = /font-weight:\s*([1-9]00(?: [1-9]00)?);/.exec(body)?.[1];
      const url =
        /url\((https:\/\/fonts\.gstatic\.com\/s\/[\w./-]+\.(?:woff2|woff|ttf))\)/.exec(
          body,
        )?.[1];
      const range = rangesWithoutBangla(
        /unicode-range:\s*([^;]+);/.exec(body)?.[1],
      );
      if (!style || !weight || !url || !range) return [];
      return `@font-face{font-family:${JSON.stringify(googleFontAlias(family))};font-style:${style};font-weight:${weight};font-display:swap;src:url(${url});unicode-range:${range}}`;
    })
    .join('\n');
}
