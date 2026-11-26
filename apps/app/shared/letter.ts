import { z } from 'zod';
import { isLetterFont } from './letter-fonts';

export const paperSizes = {
  Letter: [8.5, 11],
  Tabloid: [11, 17],
  Legal: [8.5, 14],
  Statement: [5.5, 8.5],
  Executive: [7.25, 10.5],
  Folio: [8.5, 13],
  A3: [297 / 25.4, 420 / 25.4],
  A4: [210 / 25.4, 297 / 25.4],
  A5: [148 / 25.4, 210 / 25.4],
} as const;
export const letterAlignments = ['left', 'center', 'right', 'justify'] as const;
export const letterSpacings = [1, 1.15, 1.5, 1.8, 2] as const;
export const letterBorders = ['none', 'solid', 'dashed', 'dotted'] as const;
const sides = z.number().min(0).max(8);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const paperSize = z.enum([
  'Letter',
  'Tabloid',
  'Legal',
  'Statement',
  'Executive',
  'Folio',
  'A3',
  'A4',
  'A5',
  'Custom',
]);
const layoutFields = z.strictObject({
  mode: z.enum(['pages', 'pageless']),
  size: paperSize,
  orientation: z.enum(['portrait', 'landscape']),
  width: z.number().min(3).max(24),
  height: z.number().min(3).max(24),
  color: hex,
  top: sides,
  right: sides,
  bottom: sides,
  left: sides,
});
export type LetterLayout = z.infer<typeof layoutFields>;
export function paperDimensions(layout: LetterLayout) {
  const [w, h] =
    layout.size === 'Custom'
      ? [layout.width, layout.height]
      : paperSizes[layout.size];
  return layout.orientation === 'landscape'
    ? { width: Math.max(w, h), height: Math.min(w, h) }
    : { width: Math.min(w, h), height: Math.max(w, h) };
}
export const letterLayout = layoutFields.refine((layout) => {
  const { width, height } = paperDimensions(layout);
  return (
    width - layout.left - layout.right >= 2 &&
    height - layout.top - layout.bottom >= 2
  );
}, 'Margins must leave at least 2 inches of space for the letter.');
export const defaultLetterLayout: LetterLayout = {
  mode: 'pages',
  size: 'A4',
  orientation: 'portrait',
  width: 8.27,
  height: 11.69,
  color: '#ffffff',
  top: 0.5,
  right: 0.5,
  bottom: 0.5,
  left: 0.5,
};

const color = z
  .string()
  .max(60)
  .regex(/^(?:#[0-9a-f]{3}(?:[0-9a-f]{3})?|rgba?\([\d\s.,%]+\))$/i);
const optionalColor = z.preprocess(
  (value) => (value === '' ? null : value),
  color.nullish(),
);
export const letterLink = z
  .string()
  .max(2048)
  .refine((value) => {
    if (/\s/u.test(value)) return false;
    for (const char of value) {
      const code = char.charCodeAt(0);
      if (code < 32 || code === 127) return false;
    }
    try {
      return ['http:', 'https:', 'mailto:', 'tel:'].includes(
        new URL(value).protocol,
      );
    } catch {
      return false;
    }
  }, 'Use a valid web, email, or telephone link.');
const mark = z.union([
  z.strictObject({ type: z.enum(['bold', 'italic', 'underline', 'strike']) }),
  z.strictObject({
    type: z.literal('textStyle'),
    attrs: z.strictObject({
      color: optionalColor,
      backgroundColor: optionalColor,
      fontFamily: z
        .string()
        .max(100)
        .refine(isLetterFont, 'Unknown letter font.')
        .nullish(),
      fontSize: z.preprocess(
        (value) => (value === '' ? null : value),
        z
          .string()
          .regex(/^(?:[8-9]|[1-6][0-9]|7[0-2])pt$/)
          .nullish(),
      ),
    }),
  }),
  z.strictObject({
    type: z.literal('link'),
    attrs: z.strictObject({
      href: letterLink,
      target: z.literal('_blank').nullish(),
      rel: z.literal('noopener noreferrer nofollow').nullish(),
      class: z.null().optional(),
      title: z.string().max(200).nullish(),
    }),
  }),
]);
const marks = z.array(mark).max(6).default([]);
const inline = z.union([
  z.strictObject({
    type: z.literal('text'),
    text: z.string().min(1).max(20000),
    marks,
  }),
  z.strictObject({ type: z.literal('hardBreak'), marks }),
]);
const paragraph = z.strictObject({
  type: z.literal('paragraph'),
  attrs: z
    .strictObject({
      textAlign: z.enum(letterAlignments).nullish(),
      lineSpacing: z.literal(letterSpacings).nullish(),
      indent: z.number().int().min(0).max(6).nullish(),
    })
    .optional(),
  content: z.array(inline).max(1000).default([]),
});
export const letterImageSource = z
  .string()
  .max(300000)
  .regex(
    /^data:image\/(?:jpeg;base64,\/9j\/|png;base64,iVBORw0KGgo)[A-Za-z0-9+/]*={0,2}$/,
  );
const image = z.strictObject({
  type: z.literal('letterImage'),
  attrs: z.strictObject({
    src: letterImageSource,
    alt: z.string().max(200),
    width: z.number().int().min(1).max(1600),
    height: z.number().int().min(1).max(1600),
  }),
});
const pageBreak = z.strictObject({ type: z.literal('pageBreak') });
const orderedAttrs = z.strictObject({
  start: z.number().int().min(1).max(10000).nullish(),
  type: z.enum(['1', 'a', 'A', 'i', 'I']).nullish(),
});
const list = z.union([
  z.strictObject({
    type: z.literal('bulletList'),
    get content() {
      return z.array(listItem).min(1).max(300);
    },
  }),
  z.strictObject({
    type: z.literal('orderedList'),
    attrs: orderedAttrs.optional(),
    get content() {
      return z.array(listItem).min(1).max(300);
    },
  }),
  z.strictObject({
    type: z.literal('taskList'),
    get content() {
      return z.array(taskItem).min(1).max(300);
    },
  }),
]);
const listItem = z.strictObject({
  type: z.literal('listItem'),
  get content(): z.ZodTuple<
    [typeof paragraph],
    z.ZodUnion<[typeof paragraph, typeof list]>
  > {
    return z.tuple([paragraph]).rest(z.union([paragraph, list]));
  },
});
const taskItem = z.strictObject({
  type: z.literal('taskItem'),
  attrs: z.strictObject({ checked: z.boolean() }).optional(),
  get content(): z.ZodTuple<
    [typeof paragraph],
    z.ZodUnion<[typeof paragraph, typeof list]>
  > {
    return z.tuple([paragraph]).rest(z.union([paragraph, list]));
  },
});
const cell = z.strictObject({
  type: z.enum(['tableCell', 'tableHeader']),
  attrs: z
    .strictObject({
      colspan: z.number().int().min(1).max(12).default(1),
      rowspan: z.number().int().min(1).max(100).default(1),
      colwidth: z.array(z.number().int().min(0).max(2200)).max(12).nullish(),
      align: z.enum(['left', 'center', 'right']).nullish(),
      letterCellAlignment: z.enum(['top', 'middle', 'bottom']).nullish(),
    })
    .default({ colspan: 1, rowspan: 1 }),
  content: z
    .array(z.union([paragraph, list, image]))
    .min(1)
    .max(100),
});
const table = z
  .strictObject({
    type: z.literal('table'),
    attrs: z
      .strictObject({ letterBorder: z.enum(letterBorders).nullish() })
      .optional(),
    content: z
      .array(
        z.strictObject({
          type: z.literal('tableRow'),
          attrs: z
            .strictObject({
              letterRowHeight: z.number().int().min(16).max(350).nullish(),
            })
            .optional(),
          content: z.array(cell).max(12).default([]),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine(({ content }) => {
    const occupied = content.map(() => Array<boolean>(12).fill(false));
    let width = 0;
    for (const [row, entry] of content.entries()) {
      let column = 0;
      for (const { attrs } of entry.content) {
        while (occupied[row]?.[column]) column++;
        if (
          column + attrs.colspan > 12 ||
          row + attrs.rowspan > content.length ||
          (attrs.colwidth && attrs.colwidth.length !== attrs.colspan)
        )
          return false;
        for (let y = row; y < row + attrs.rowspan; y++) {
          const slots = occupied[y];
          if (!slots) return false;
          for (let x = column; x < column + attrs.colspan; x++) {
            if (slots[x]) return false;
            slots[x] = true;
          }
        }
        column += attrs.colspan;
        width = Math.max(width, column);
      }
    }
    return (
      width > 0 && occupied.every((row) => row.slice(0, width).every(Boolean))
    );
  }, 'The letter contains an invalid table.');

const documentFields = z.strictObject({
  type: z.literal('doc'),
  content: z
    .array(z.union([paragraph, list, image, table, pageBreak]))
    .min(1)
    .max(300),
});
export type LetterDocument = z.infer<typeof documentFields>;
export const letterDocument = z
  .preprocess((value, ctx) => {
    // Bound recursion and work before validating rich nodes from the request.
    const stack: { node: unknown; depth: number }[] = [
      { node: value, depth: 0 },
    ];
    let nodes = 0;
    while (stack.length) {
      const item = stack.pop();
      if (!item) break;
      if (++nodes > 10000 || item.depth > 20) {
        ctx.addIssue({
          code: 'custom',
          message: 'The letter has too many nested elements.',
        });
        return z.NEVER;
      }
      if (
        item.node &&
        typeof item.node === 'object' &&
        'content' in item.node &&
        Array.isArray(item.node.content)
      ) {
        if (item.node.content.length > 1000) {
          ctx.addIssue({
            code: 'custom',
            message: 'A letter section contains too many elements.',
          });
          return z.NEVER;
        }
        for (const child of item.node.content)
          stack.push({ node: child, depth: item.depth + 1 });
      }
    }
    return value;
  }, documentFields)
  .refine(
    (doc) => new TextEncoder().encode(JSON.stringify(doc)).length <= 750000,
    'The letter is too large. Remove some content or images.',
  );
export function letterText(doc: LetterDocument) {
  function text(node: {
    type: string;
    text?: string;
    content?: readonly unknown[];
  }): string {
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'letterImage') return '\uFFFC';
    if (node.type === 'hardBreak') return '\n';
    return (
      (node.content as (typeof node)[] | undefined)
        ?.map(text)
        .join(node.type === 'paragraph' ? '' : '\n') ?? ''
    );
  }
  return text(doc);
}
