import { writeFile } from 'node:fs/promises';
import { log } from 'node:console';
import { URL } from 'node:url';

const response = await globalThis.fetch(
  'https://fonts.google.com/metadata/fonts',
);
if (!response.ok)
  throw new Error(`Google Fonts catalog returned ${response.status}`);
const text = await response.text();
const { familyMetadataList: families } = JSON.parse(
  text.slice(text.indexOf('{')),
);
const catalog = {};
for (const { family, fonts, isOpenSource } of families.sort((a, b) =>
  a.family.localeCompare(b.family, 'en'),
)) {
  if (!isOpenSource) continue;
  if (!/^[\p{L}\p{N} .+'()-]{1,100}$/u.test(family))
    throw new Error(`Unexpected font name: ${family}`);
  const variants = Object.keys(fonts);
  const selected = [];
  for (const italic of [0, 1]) {
    const weights = variants
      .filter((variant) => variant.endsWith('i') === Boolean(italic))
      .map(Number.parseFloat);
    for (const preferred of [400, 700]) {
      const weight = weights.toSorted(
        (a, b) => Math.abs(a - preferred) - Math.abs(b - preferred),
      )[0];
      if (weight !== undefined && !selected.includes(`${italic},${weight}`))
        selected.push(`${italic},${weight}`);
    }
  }
  if (!selected.length) throw new Error(`No variants for ${family}`);
  catalog[family] = selected.join(';');
}
if (Object.keys(catalog).length < 1800)
  throw new Error('The Google Fonts catalog is incomplete.');
await writeFile(
  new URL('../shared/letter-font-catalog.json', import.meta.url),
  JSON.stringify(catalog, null, 2) + '\n',
);
log(`Saved ${Object.keys(catalog).length} Google Fonts families.`);
