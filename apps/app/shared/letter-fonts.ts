import catalog from './letter-font-catalog.json' with { type: 'json' };

export const localLetterFonts = [
  'Arial',
  'Times New Roman',
  'Georgia',
  'Calibri',
] as const;
export const googleLetterFonts = Object.keys(catalog);
const variants = new Map(Object.entries(catalog));

export function googleFontVariants(family: string) {
  return variants.get(family);
}

export function isLetterFont(family: string) {
  return (
    localLetterFonts.some((font) => font === family) || variants.has(family)
  );
}

export function googleFontAlias(family: string) {
  return `Hexa Google ${family}`;
}
