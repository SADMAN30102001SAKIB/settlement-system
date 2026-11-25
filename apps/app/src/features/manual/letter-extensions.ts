import { Extension, Node } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { TableKit, TableView } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TextStyle } from '@tiptap/extension-text-style/text-style';
import { Color } from '@tiptap/extension-text-style/color';
import { BackgroundColor } from '@tiptap/extension-text-style/background-color';
import { FontSize } from '@tiptap/extension-text-style/font-size';
import {
  letterAlignments,
  letterBorders,
  letterFonts,
  letterImageSource,
  letterLink,
  letterSpacings,
} from '../../../shared/letter';

class LetterTableView extends TableView {
  constructor(node: ProseMirrorNode, min: number, view?: EditorView) {
    super(node, min, view);
    const border: unknown = node.attrs['letterBorder'];
    if (typeof border === 'string') this.table.dataset['letterBorder'] = border;
  }
}

const LetterFormatting = Extension.create({
  name: 'letterFormatting',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              letterFonts.find((font) => font === el.dataset['letterFont']) ??
              null,
            renderHTML: (attrs: Record<string, unknown>) => {
              const family = attrs['fontFamily'];
              return letterFonts.some((font) => font === family)
                ? { 'data-letter-font': family }
                : {};
            },
          },
        },
      },
      {
        types: ['paragraph'],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              letterAlignments.find((align) => align === el.style.textAlign) ??
              null,
            renderHTML: (attrs: Record<string, unknown>) => {
              const align = letterAlignments.find(
                (value) => value === attrs['textAlign'],
              );
              return align ? { style: `text-align: ${align}` } : {};
            },
          },
          lineSpacing: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              letterSpacings.find(
                (spacing) => spacing === Number(el.style.lineHeight),
              ) ?? null,
            renderHTML: (attrs: Record<string, unknown>) => {
              const spacing = letterSpacings.find(
                (value) => value === attrs['lineSpacing'],
              );
              const value = String(spacing);
              return spacing
                ? { style: `line-height: ${value}; min-height: ${value}em` }
                : {};
            },
          },
          indent: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              Math.min(6, Math.max(0, Number(el.dataset['letterIndent']) || 0)),
            renderHTML: (attrs: Record<string, unknown>) => {
              const indent = attrs['indent'];
              return typeof indent === 'number' && indent >= 1 && indent <= 6
                ? {
                    'data-letter-indent': indent,
                    style: `padding-inline-start: ${String(indent * 1.25)}em`,
                  }
                : {};
            },
          },
        },
      },
      {
        types: ['table'],
        attributes: {
          letterBorder: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              letterBorders.find(
                (border) => border === el.dataset['letterBorder'],
              ) ?? null,
            renderHTML: (attrs: Record<string, unknown>) => {
              const border = letterBorders.find(
                (value) => value === attrs['letterBorder'],
              );
              return border ? { 'data-letter-border': border } : {};
            },
          },
        },
      },
      {
        types: ['tableRow'],
        attributes: {
          letterRowHeight: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              Number.parseInt(el.style.height, 10) || null,
            renderHTML: (attrs: Record<string, unknown>) => {
              const height = attrs['letterRowHeight'];
              return typeof height === 'number' && height >= 16 && height <= 350
                ? { style: `height: ${String(height)}px` }
                : {};
            },
          },
        },
      },
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          letterCellAlignment: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              ['top', 'middle', 'bottom'].find(
                (key) => key === el.style.verticalAlign,
              ) ?? null,
            renderHTML: (attrs: Record<string, unknown>) => {
              const align = ['top', 'middle', 'bottom'].find(
                (key) => key === attrs['letterCellAlignment'],
              );
              return align ? { style: `vertical-align: ${align}` } : {};
            },
          },
        },
      },
    ];
  },
});

const LetterImage = Node.create({
  name: 'letterImage',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      width: { default: 1 },
      height: { default: 1 },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'img[data-letter-image]',
        getAttrs: (el) =>
          letterImageSource.safeParse(el.getAttribute('src')).success
            ? null
            : false,
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', { ...HTMLAttributes, 'data-letter-image': '' }];
  },
});
const LetterPageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-letter-break]' }];
  },
  renderHTML() {
    return [
      'div',
      {
        'data-letter-break': '',
        role: 'separator',
        'aria-label': 'Page break',
      },
    ];
  },
});

export function letterExtensions() {
  return [
    StarterKit.configure({
      blockquote: false,
      code: false,
      codeBlock: false,
      heading: false,
      horizontalRule: false,
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        isAllowedUri: (url) => letterLink.safeParse(url).success,
      },
    }),
    TextStyle,
    Color,
    BackgroundColor,
    FontSize,
    LetterFormatting,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({
      table: {
        resizable: true,
        View: LetterTableView,
        renderWrapper: true,
        cellMinWidth: 25,
      },
    }),
    LetterImage,
    LetterPageBreak,
  ];
}
