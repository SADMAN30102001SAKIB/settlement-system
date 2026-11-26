import { expect, it } from 'vitest';
import { letterFontCss } from '../shared/letter-font-css';
import { googleLetterFonts, isLetterFont } from '../shared/letter-fonts';

it('keeps the full catalog and previous fonts, but accepts only known families', () => {
  expect(googleLetterFonts.length).toBeGreaterThan(1900);
  expect(isLetterFont('Georgia')).toBe(true);
  expect(isLetterFont('Lora')).toBe(true);
  expect(isLetterFont('unlisted')).toBe(false);
});

it('re-emits recognized font faces while leaving Bangla to the default font', () => {
  const css = letterFontCss(
    'Lora',
    `
    @font-face {
      font-style: italic; font-weight: 700;
      src: url(https://fonts.gstatic.com/s/lora/v1/sample.woff2) format('woff2');
      unicode-range: U+0000-00FF, U+0900-0AFF, U+1F??;
    }
    @font-face {
      font-style: normal; font-weight: 400;
      src: url(https://fonts.gstatic.com/s/lora/v1/bangla.woff2);
      unicode-range: U+0980-09FF;
    }
  `,
  );
  expect(css).toContain(
    'font-family:"Hexa Google Lora";font-style:italic;font-weight:700',
  );
  expect(css).toContain('unicode-range:U+0-ff,U+900-97f,U+a00-aff,U+1f00-1fff');
  expect(css).not.toContain('bangla.woff2');
});
