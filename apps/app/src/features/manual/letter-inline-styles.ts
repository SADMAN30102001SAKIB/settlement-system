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
}
