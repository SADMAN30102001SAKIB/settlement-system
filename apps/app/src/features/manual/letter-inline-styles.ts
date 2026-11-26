const properties = [
  'color',
  'background-color',
  'font-size',
  'text-align',
  'line-height',
  'padding-inline-start',
  'min-height',
  'vertical-align',
  'height',
  'width',
  'min-width',
];

export function applyLetterInlineStyles(root: Element) {
  const parser = root.ownerDocument.createElement('span').style;
  for (const element of root.querySelectorAll<HTMLElement>('[style]')) {
    const declared = element.getAttribute('style');
    if (!declared || element.style.length) continue;
    // A strict CSP ignores style attributes produced by DOMSerializer, but allows CSSOM properties.
    parser.cssText = declared;
    for (const key of properties) {
      const value = parser.getPropertyValue(key);
      if (value) element.style.setProperty(key, value);
    }
  }
  for (const node of root.querySelectorAll<HTMLElement>(
    '[data-letter-google]',
  )) {
    const family = node.dataset['letterFont'];
    if (!family || !googleFontVariants(family)) continue;
    const alias = JSON.stringify(googleFontAlias(family));
    if (node.style.getPropertyValue('--letter-google-family') !== alias)
      node.style.setProperty('--letter-google-family', alias);
  }
}
import {
  googleFontAlias,
  googleFontVariants,
} from '../../../shared/letter-fonts';
