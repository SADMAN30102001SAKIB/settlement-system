import { z } from 'zod';
const color = z
  .string()
  .max(60)
  .regex(/^(?:#[0-9a-f]{3}(?:[0-9a-f]{3})?|rgba?\([\d\s.,%]+\))$/i);
const mark = z.union([
  z
    .object({ type: z.enum(['bold', 'italic', 'underline', 'strike']) })
    .strict(),
  z
    .object({
      type: z.literal('textStyle'),
      attrs: z
        .object({
          color: z.preprocess(
            (value) => (value === '' ? null : value),
            color.nullable().optional(),
          ),
          backgroundColor: z.preprocess(
            (value) => (value === '' ? null : value),
            color.nullable().optional(),
          ),
        })
        .strict(),
    })
    .strict(),
]);
const inline = z.union([
  z
    .object({
      type: z.literal('text'),
      text: z.string().min(1).max(20000),
      marks: z.array(mark).max(5).default([]),
    })
    .strict(),
  z
    .object({
      type: z.literal('hardBreak'),
      marks: z.array(mark).max(5).default([]),
    })
    .strict(),
]);
export const letterDocument = z
  .object({
    type: z.literal('doc'),
    content: z
      .array(
        z
          .object({
            type: z.literal('paragraph'),
            content: z.array(inline).max(1000).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(300),
  })
  .strict()
  .refine(
    (doc) => JSON.stringify(doc).length <= 200000,
    'The letter is too large.',
  );
export type LetterDocument = z.infer<typeof letterDocument>;
export function letterText(doc: LetterDocument) {
  return doc.content
    .map((p) =>
      p.content.map((n) => (n.type === 'text' ? n.text : '\n')).join(''),
    )
    .join('\n');
}
