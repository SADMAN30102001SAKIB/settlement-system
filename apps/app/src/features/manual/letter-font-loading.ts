import {
  googleFontAlias,
  googleFontVariants,
} from '../../../shared/letter-fonts';
import { letterFontCss } from '../../../shared/letter-font-css';

const stylesheets = new WeakMap<Document, Map<string, Promise<void>>>();
const fontCss = new Map<string, Promise<string>>();

function fetchFontCss(family: string) {
  const previous = fontCss.get(family);
  if (previous) return previous;
  const variants = googleFontVariants(family);
  if (!variants) return Promise.reject(new Error('Unknown letter font.'));
  const url = new URL('https://fonts.googleapis.com/css2');
  url.searchParams.set('family', `${family}:ital,wght@${variants}`);
  url.searchParams.set('display', 'swap');
  const request = fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  })
    .then(async (response) => {
      if (response.ok) {
        const css = letterFontCss(family, await response.text());
        if (css) return css;
      }
      throw new Error('No compatible font faces were returned.');
    })
    .catch((cause: unknown) => {
      fontCss.delete(family);
      throw new Error(`Could not load ${family}. Try again.`, { cause });
    });
  fontCss.set(family, request);
  return request;
}

function loadStylesheet(doc: Document, family: string) {
  let current = stylesheets.get(doc);
  if (!current) {
    current = new Map();
    stylesheets.set(doc, current);
  }
  const previous = current.get(family);
  if (previous) return previous;
  const pending = fetchFontCss(family).then((css) => {
    const view = doc.defaultView;
    if (!view) throw new Error('The letter preview is no longer open.');
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync(css);
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  });
  current.set(family, pending);
  void pending.catch(() => current.delete(family));
  return pending;
}

export async function prepareLetterFont(doc: Document, family: string) {
  if (!googleFontVariants(family)) return;
  await loadStylesheet(doc, family);
  await doc.fonts.load(`16px ${JSON.stringify(googleFontAlias(family))}`, 'Aa');
}

export async function prepareLetterFonts(root: HTMLElement) {
  const doc = root.ownerDocument;
  const selections = [
    ...root.querySelectorAll<HTMLElement>('[data-letter-google]'),
  ].flatMap((node) => {
    const family = node.dataset['letterFont'];
    return family && googleFontVariants(family) ? [{ node, family }] : [];
  });
  await Promise.all(
    [...new Set(selections.map(({ family }) => family))].map((family) =>
      loadStylesheet(doc, family),
    ),
  );
  await Promise.all(
    selections.map(({ node, family }) => {
      const style = doc.defaultView?.getComputedStyle(node);
      return doc.fonts.load(
        `${style?.fontStyle ?? 'normal'} ${style?.fontWeight ?? '400'} 16px ${JSON.stringify(googleFontAlias(family))}`,
        node.textContent,
      );
    }),
  );
  await doc.fonts.ready;
}
