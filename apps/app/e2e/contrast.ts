import type { Page } from '@playwright/test';

export function contrastFailures(page: Page) {
  return page.evaluate(() => {
    type Color = [number, number, number, number];
    function color(value: string): Color {
      const numbers = value.match(/[\d.]+/g)?.map(Number);
      if (!value.startsWith('rgb') || numbers === undefined)
        throw new Error(`Unsupported computed color: ${value}`);
      return [
        numbers[0] ?? 0,
        numbers[1] ?? 0,
        numbers[2] ?? 0,
        numbers[3] ?? 1,
      ];
    }
    function blend(top: Color, bottom: Color): Color {
      return [
        top[0] * top[3] + bottom[0] * (1 - top[3]),
        top[1] * top[3] + bottom[1] * (1 - top[3]),
        top[2] * top[3] + bottom[2] * (1 - top[3]),
        1,
      ];
    }
    function luminance(value: Color) {
      const components = value.slice(0, 3).map((channel) => {
        const linear = channel / 255;
        return linear <= 0.04045
          ? linear / 12.92
          : ((linear + 0.055) / 1.055) ** 2.4;
      });
      return (
        (components[0] ?? 0) * 0.2126 +
        (components[1] ?? 0) * 0.7152 +
        (components[2] ?? 0) * 0.0722
      );
    }
    const failures: {
      text: string;
      selector: string;
      ratio: number;
      foreground: string;
      background: Color;
    }[] = [];
    const scope = document.querySelector('dialog[open]') ?? document.body;
    for (const element of scope.querySelectorAll<HTMLElement>('*')) {
      if (
        element.closest(
          '[aria-hidden="true"], .sr-only, .wordmark, .invoice-logo, .brand-mark, :disabled',
        )
      )
        continue;
      const style = getComputedStyle(element),
        rect = element.getBoundingClientRect();
      if (
        !rect.width ||
        !rect.height ||
        rect.bottom < 0 ||
        style.visibility !== 'visible' ||
        style.display === 'none'
      )
        continue;
      const text =
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
          ? element.value || element.placeholder
          : [...element.childNodes]
              .filter((node) => node.nodeType === Node.TEXT_NODE)
              .map((node) => node.textContent?.trim() ?? '')
              .join(' ');
      if (!text.trim()) continue;
      const ancestors: Element[] = [];
      for (
        let current: Element | null = element;
        current !== null;
        current = current.parentElement
      )
        ancestors.unshift(current);
      if (
        ancestors.some(
          (ancestor) =>
            getComputedStyle(ancestor).visibility !== 'visible' ||
            Number(getComputedStyle(ancestor).opacity) === 0,
        )
      )
        continue;
      let background: Color = [255, 255, 255, 1];
      for (const ancestor of ancestors)
        background = blend(
          color(getComputedStyle(ancestor).backgroundColor),
          background,
        );
      const placeholder =
        (element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement) &&
        !element.value &&
        element.placeholder;
      const foreground = placeholder
        ? getComputedStyle(element, '::placeholder').color
        : style.color;
      const ink = luminance(blend(color(foreground), background)),
        paper = luminance(background);
      const ratio =
        (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05);
      const large =
        parseFloat(style.fontSize) >= 24 ||
        (parseFloat(style.fontSize) >= 18.66 &&
          Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5))
        failures.push({
          text: text.trim().slice(0, 80),
          selector: `${element.tagName.toLowerCase()}.${element.className}`,
          ratio: Math.round(ratio * 100) / 100,
          foreground,
          background,
        });
    }
    return failures;
  });
}
