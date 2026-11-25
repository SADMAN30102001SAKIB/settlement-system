import { useLayoutEffect, useMemo, useRef } from 'react';
import { generateHTML } from '@tiptap/core';
import type { LetterDocument } from '../../shared/letter';
import { letterExtensions } from '../features/manual/letter-extensions';
import { applyLetterInlineStyles } from '../features/manual/letter-inline-styles';
import '@fontsource-variable/noto-sans-bengali';

export function LetterBody({ body }: { body: LetterDocument }) {
  const html = useMemo(() => generateHTML(body, letterExtensions()), [body]);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (root.current) applyLetterInlineStyles(root.current);
  }, [html]);
  return (
    <div
      ref={root}
      className="letter-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
