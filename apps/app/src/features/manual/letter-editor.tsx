import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent, useEditorState } from '@tiptap/react';
import type { JSONContent } from '@tiptap/react';
import {
  letterAlignments,
  letterBorders,
  letterImageSource,
  letterLink,
  letterSpacings,
} from '../../../shared/letter';
import type { LetterLayout } from '../../../shared/letter';
import { CatalogDialog } from '../../components/catalog-dialog';
import { Alert, ErrorMessage, Field } from '../../components/ui';
import { formText } from '../../lib/format';
import { letterExtensions } from './letter-extensions';
import { applyLetterInlineStyles } from './letter-inline-styles';
import { LetterPageSetup } from './letter-page-setup';
import { LetterFontPicker } from './letter-font-picker';
import { LetterToolbarIcon } from './letter-toolbar-icon';
import { prepareLetterFonts } from './letter-font-loading';

async function letterImage(file: File) {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error('Choose a JPG, PNG, or WebP image under 10 MB.');
  const image = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  try {
    const size = Math.min(1, 1200 / Math.max(image.width, image.height));
    for (const scale of [size, size * 0.7, size * 0.45]) {
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) break;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL('image/png');
      if (letterImageSource.safeParse(png).success)
        return {
          src: png,
          alt: file.name.slice(0, 200),
          width: canvas.width,
          height: canvas.height,
        };
      context.globalCompositeOperation = 'destination-over';
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const jpeg = canvas.toDataURL('image/jpeg', 0.84);
      if (letterImageSource.safeParse(jpeg).success)
        return {
          src: jpeg,
          alt: file.name.slice(0, 200),
          width: canvas.width,
          height: canvas.height,
        };
    }
    throw new Error('This image could not be resized for the letter.');
  } finally {
    image.close();
  }
}

export function LetterEditor({
  value,
  onChange,
  disabled,
  layout,
  onLayout,
  renderSurface,
}: {
  value: JSONContent;
  onChange: (body: JSONContent) => void;
  disabled: boolean;
  layout: LetterLayout;
  onLayout: (value: LetterLayout) => void;
  renderSurface: (editor: ReactNode) => ReactNode;
}) {
  const [dialog, setDialog] = useState<
    'setup' | 'table' | 'link' | 'font' | null
  >(null);
  const [imagePending, setImagePending] = useState(false);
  const [error, setError] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    extensions: letterExtensions(),
    content: value,
    injectCSS: false,
    parseOptions: { preserveWhitespace: 'full' },
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': 'Letter body',
        'aria-multiline': 'true',
        class: 'letter-editor-body',
      },
    },
    onUpdate: ({ editor: current }) => {
      onChange(current.getJSON());
    },
  });
  useEffect(() => {
    const current = editor.view.dom;
    const apply = () => {
      applyLetterInlineStyles(current);
    };
    const observer = new MutationObserver(apply);
    observer.observe(current, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style'],
    });
    apply();
    void prepareLetterFonts(current).catch(() => undefined);
    return () => {
      observer.disconnect();
    };
  }, [editor]);
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const attrs = current.getAttributes('textStyle');
      const color: unknown = attrs['color'],
        background: unknown = attrs['backgroundColor'];
      const paragraph = current.getAttributes('paragraph');
      const font: unknown = attrs['fontFamily'];
      const fontSize: unknown = attrs['fontSize'];
      const href: unknown = current.getAttributes('link')['href'];
      return {
        bold: current.isActive('bold'),
        italic: current.isActive('italic'),
        underline: current.isActive('underline'),
        strike: current.isActive('strike'),
        color: typeof color === 'string' ? color : '',
        background: typeof background === 'string' ? background : '',
        font: typeof font === 'string' ? font : '',
        fontSize: typeof fontSize === 'string' ? fontSize : '',
        align: String(paragraph['textAlign'] ?? ''),
        spacing: String(paragraph['lineSpacing'] ?? ''),
        indent: Number(paragraph['indent'] ?? 0),
        link: typeof href === 'string' ? href : '',
        hasSelection: !current.state.selection.empty,
        bullet: current.isActive('bulletList'),
        numbered: current.isActive('orderedList'),
        checklist: current.isActive('taskList'),
        table: current.isActive('table'),
        border: String(
          current.getAttributes('table')['letterBorder'] ?? 'solid',
        ),
        height: String(
          current.getAttributes('tableRow')['letterRowHeight'] ?? '',
        ),
        undo: current.can().undo(),
        redo: current.can().redo(),
      };
    },
  });
  useEffect(() => {
    editor.setEditable(!disabled && !imagePending);
  }, [editor, disabled, imagePending]);
  const locked = disabled || imagePending;
  function button(
    label: string,
    action: () => void,
    pressed?: boolean,
    unavailable = false,
  ) {
    return (
      <button
        type="button"
        className="letter-tool"
        title={label}
        aria-label={label}
        aria-pressed={pressed}
        disabled={locked || unavailable}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={(event) => {
          event.currentTarget.closest('details')?.removeAttribute('open');
          action();
        }}
      >
        <LetterToolbarIcon name={label} />
        <span>{label}</span>
      </button>
    );
  }
  function indent(delta: number) {
    const chain = editor.chain().focus();
    if (editor.isActive('listItem') || editor.isActive('taskItem')) {
      const type = editor.isActive('taskItem') ? 'taskItem' : 'listItem';
      if (delta > 0) chain.sinkListItem(type).run();
      else chain.liftListItem(type).run();
    } else {
      chain
        .updateAttributes('paragraph', {
          indent: Math.max(0, Math.min(6, active.indent + delta)),
        })
        .run();
    }
  }
  function close() {
    setDialog(null);
  }
  return (
    <div className="letter-editor">
      <div
        className="letter-toolbar letter-format-toolbar"
        role="toolbar"
        aria-label="Letter formatting"
      >
        <div className="letter-tool-group">
          {button(
            'Undo',
            () => {
              editor.chain().focus().undo().run();
            },
            undefined,
            !active.undo,
          )}
          {button(
            'Redo',
            () => {
              editor.chain().focus().redo().run();
            },
            undefined,
            !active.redo,
          )}
        </div>
        <div className="letter-tool-group">
          <button
            type="button"
            className="letter-tool letter-font-trigger"
            aria-label="Font family"
            aria-haspopup="dialog"
            title={active.font || 'Choose font family'}
            disabled={locked}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              setDialog('font');
            }}
          >
            <span>{active.font || 'Default font'}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path d="m4 6 4 4 4-4" />
            </svg>
          </button>
          <label className="letter-tool-choice">
            <span className="sr-only">Font size</span>
            <select
              title="Font size"
              value={active.fontSize}
              disabled={locked}
              onChange={(event) => {
                const chain = editor.chain().focus();
                if (event.currentTarget.value)
                  chain.setFontSize(event.currentTarget.value).run();
                else chain.unsetFontSize().run();
              }}
            >
              <option value="">Default</option>
              {[
                8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72,
              ].map((size) => (
                <option key={size} value={`${String(size)}pt`}>
                  {size} pt
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="letter-tool-group">
          {(['bold', 'italic', 'underline', 'strike'] as const).map((mark) => (
            <button
              type="button"
              className="letter-tool"
              key={mark}
              title={
                mark === 'strike'
                  ? 'Strikethrough'
                  : mark.charAt(0).toUpperCase() + mark.slice(1)
              }
              aria-label={
                mark === 'strike'
                  ? 'Strikethrough'
                  : mark.charAt(0).toUpperCase() + mark.slice(1)
              }
              aria-pressed={active[mark]}
              disabled={locked}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                const chain = editor.chain().focus();
                if (mark === 'bold') chain.toggleBold().run();
                else if (mark === 'italic') chain.toggleItalic().run();
                else if (mark === 'underline') chain.toggleUnderline().run();
                else chain.toggleStrike().run();
              }}
            >
              <LetterToolbarIcon
                name={
                  mark === 'strike'
                    ? 'Strikethrough'
                    : mark.charAt(0).toUpperCase() + mark.slice(1)
                }
              />
            </button>
          ))}
        </div>
        <div className="letter-tool-group">
          <label className="letter-tool-choice">
            <LetterToolbarIcon name="Letter text color" />
            <select
              title="Text color"
              aria-label="Letter text color"
              value={active.color}
              disabled={locked}
              onChange={(e) => {
                const chain = editor.chain().focus();
                if (e.target.value) chain.setColor(e.target.value).run();
                else chain.unsetColor().run();
              }}
            >
              <option value="">Default</option>
              <option value="#172e28">Black</option>
              <option value="#174ea6">Blue</option>
              <option value="#b3261e">Red</option>
              <option value="#176b52">Green</option>
              {active.color &&
              !['#172e28', '#174ea6', '#b3261e', '#176b52'].includes(
                active.color,
              ) ? (
                <option value={active.color}>Custom</option>
              ) : null}
            </select>
          </label>
          <label className="letter-tool-choice">
            <LetterToolbarIcon name="Letter highlight" />
            <select
              title="Highlight"
              aria-label="Letter highlight"
              value={active.background}
              disabled={locked}
              onChange={(e) => {
                const chain = editor.chain().focus();
                if (e.target.value)
                  chain.setBackgroundColor(e.target.value).run();
                else chain.unsetBackgroundColor().run();
              }}
            >
              <option value="">None</option>
              <option value="#fff3a3">Yellow</option>
              <option value="#d8edcc">Green</option>
              <option value="#d9e8ff">Blue</option>
              {active.background &&
              !['#fff3a3', '#d8edcc', '#d9e8ff'].includes(active.background) ? (
                <option value={active.background}>Custom</option>
              ) : null}
            </select>
          </label>
        </div>
        <div className="letter-tool-group">
          <label className="letter-tool-choice">
            <LetterToolbarIcon name="Text alignment" />
            <select
              aria-label="Text alignment"
              title="Text alignment"
              value={active.align}
              disabled={locked}
              onChange={(event) => {
                editor
                  .chain()
                  .focus()
                  .updateAttributes('paragraph', {
                    textAlign: event.currentTarget.value || null,
                  })
                  .run();
              }}
            >
              <option value="">Default</option>
              {letterAlignments.map((align) => (
                <option key={align} value={align}>
                  {align.charAt(0).toUpperCase() + align.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="letter-tool-choice">
            <LetterToolbarIcon name="Line spacing" />
            <select
              aria-label="Line spacing"
              title="Line spacing"
              value={active.spacing}
              disabled={locked}
              onChange={(event) => {
                editor
                  .chain()
                  .focus()
                  .updateAttributes('paragraph', {
                    lineSpacing: Number(event.currentTarget.value) || null,
                  })
                  .run();
              }}
            >
              <option value="">Default</option>
              {letterSpacings.map((spacing) => (
                <option key={spacing}>{spacing}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="letter-tool-group">
          {button(
            'Insert link',
            () => {
              setDialog('link');
            },
            !!active.link,
          )}
          {button(imagePending ? 'Adding image…' : 'Insert image', () => {
            imageInput.current?.click();
          })}
          <input
            ref={imageInput}
            hidden
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="Upload letter image"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (!file) return;
              setError('');
              setImagePending(true);
              void letterImage(file)
                .then((attrs) => {
                  editor
                    .chain()
                    .focus()
                    .insertContent({ type: 'letterImage', attrs })
                    .run();
                })
                .catch((reason: unknown) => {
                  setError(ErrorMessage(reason));
                })
                .finally(() => {
                  setImagePending(false);
                });
            }}
          />
          {button(
            'Insert table',
            () => {
              setDialog('table');
            },
            undefined,
            active.table,
          )}
        </div>
        <div className="letter-tool-group">
          {button(
            'Checklist',
            () => {
              editor.chain().focus().toggleTaskList().run();
            },
            active.checklist,
          )}
          {button(
            'Bulleted list',
            () => {
              editor.chain().focus().toggleBulletList().run();
            },
            active.bullet,
          )}
          {button(
            'Numbered list',
            () => {
              editor.chain().focus().toggleOrderedList().run();
            },
            active.numbered,
          )}
        </div>
        <div className="letter-tool-group letter-tool-end">
          <details className="letter-more">
            <summary
              className="letter-tool"
              aria-label="More formatting"
              title="More formatting"
            >
              <LetterToolbarIcon name="More formatting" />
            </summary>
            <div className="letter-more-panel">
              {button('Decrease indent', () => {
                indent(-1);
              })}
              {button('Increase indent', () => {
                indent(1);
              })}
              {button('Clear formatting', () => {
                editor
                  .chain()
                  .focus()
                  .unsetAllMarks()
                  .updateAttributes('paragraph', {
                    textAlign: null,
                    lineSpacing: null,
                    indent: null,
                  })
                  .run();
              })}
              {button(
                'Insert page break',
                () => {
                  editor
                    .chain()
                    .focus()
                    .insertContent([
                      { type: 'pageBreak' },
                      { type: 'paragraph' },
                    ])
                    .run();
                },
                undefined,
                active.table ||
                  active.bullet ||
                  active.numbered ||
                  active.checklist,
              )}
            </div>
          </details>
          {button('Page setup', () => {
            setDialog('setup');
          })}
        </div>
      </div>
      {active.table ? (
        <div
          className="letter-toolbar letter-table-tools"
          role="toolbar"
          aria-label="Table tools"
        >
          {button('Add row above', () => {
            editor.chain().focus().addRowBefore().run();
          })}
          {button('Add row below', () => {
            editor.chain().focus().addRowAfter().run();
          })}
          {button('Remove row', () => {
            editor.chain().focus().deleteRow().run();
          })}
          {button('Add column left', () => {
            editor.chain().focus().addColumnBefore().run();
          })}
          {button('Add column right', () => {
            editor.chain().focus().addColumnAfter().run();
          })}
          {button('Remove column', () => {
            editor.chain().focus().deleteColumn().run();
          })}
          {button(
            'Merge cells',
            () => {
              editor.chain().focus().mergeCells().run();
            },
            undefined,
            !editor.can().mergeCells(),
          )}
          {button(
            'Split cell',
            () => {
              editor.chain().focus().splitCell().run();
            },
            undefined,
            !editor.can().splitCell(),
          )}
          {button('Remove table', () => {
            editor.chain().focus().deleteTable().run();
          })}
          <label>
            Table borders{' '}
            <select
              value={active.border}
              onChange={(event) => {
                editor
                  .chain()
                  .focus()
                  .updateAttributes('table', {
                    letterBorder: event.currentTarget.value,
                  })
                  .run();
              }}
            >
              {letterBorders.map((border) => (
                <option key={border}>{border}</option>
              ))}
            </select>
          </label>
          <label>
            Row height{' '}
            <select
              value={active.height}
              onChange={(event) => {
                editor
                  .chain()
                  .focus()
                  .updateAttributes('tableRow', {
                    letterRowHeight: Number(event.currentTarget.value) || null,
                  })
                  .run();
              }}
            >
              <option value="">Automatic</option>
              {[24, 32, 40, 48, 64, 80, 100, 140, 200, 300].map((size) => (
                <option key={size} value={size}>
                  {size} px
                </option>
              ))}
            </select>
          </label>
          <label>
            Cell alignment{' '}
            <select
              value={String(
                editor.getAttributes('tableCell')['letterCellAlignment'] ??
                  editor.getAttributes('tableHeader')['letterCellAlignment'] ??
                  '',
              )}
              onChange={(event) => {
                editor
                  .chain()
                  .focus()
                  .setCellAttribute(
                    'letterCellAlignment',
                    event.currentTarget.value || null,
                  )
                  .run();
              }}
            >
              <option value="">Default</option>
              <option value="top">Top</option>
              <option value="middle">Middle</option>
              <option value="bottom">Bottom</option>
            </select>
          </label>
          <small className="caption">
            Drag a column edge to resize. Drag across cells to select a range.
          </small>
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      {renderSurface(
        <EditorContent className="letter-edit-content" editor={editor} />,
      )}
      {dialog === 'font' ? (
        <LetterFontPicker
          current={active.font}
          onClose={close}
          onChoose={(family) => {
            close();
            editor
              .chain()
              .focus()
              .setMark('textStyle', { fontFamily: family || null })
              .removeEmptyTextStyle()
              .run();
          }}
        />
      ) : null}
      {dialog === 'setup' ? (
        <LetterPageSetup
          value={layout}
          onClose={close}
          onApply={(value) => {
            onLayout(value);
            close();
          }}
        />
      ) : null}
      {dialog === 'table'
        ? createPortal(
            <CatalogDialog title="Insert table" onClose={close} pending={false}>
              <form
                className="panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const data = new FormData(event.currentTarget);
                  close();
                  editor
                    .chain()
                    .focus()
                    .insertTable({
                      rows: Number(data.get('rows')),
                      cols: Number(data.get('columns')),
                      withHeaderRow: false,
                    })
                    .run();
                }}
              >
                <div className="form-grid">
                  <Field label="Rows">
                    <input
                      name="rows"
                      type="number"
                      min="1"
                      max="100"
                      required
                      defaultValue="3"
                    />
                  </Field>
                  <Field label="Columns">
                    <input
                      name="columns"
                      type="number"
                      min="1"
                      max="12"
                      required
                      defaultValue="3"
                    />
                  </Field>
                </div>
                <div className="actions">
                  <button type="button" className="secondary" onClick={close}>
                    Cancel
                  </button>
                  <button type="submit" className="primary">
                    Insert table
                  </button>
                </div>
              </form>
            </CatalogDialog>,
            document.body,
          )
        : null}
      {dialog === 'link' ? (
        <LinkDialog
          current={active.link}
          hasSelection={active.hasSelection}
          onClose={close}
          onApply={(href, text) => {
            close();
            const chain = editor.chain().focus().extendMarkRange('link');
            if (!href) chain.unsetLink().run();
            else if (active.hasSelection || active.link)
              chain.setLink({ href }).run();
            else
              chain
                .insertContent({
                  type: 'text',
                  text: text?.length ? text : href,
                  marks: [{ type: 'link', attrs: { href } }],
                })
                .run();
          }}
        />
      ) : null}
    </div>
  );
}

function LinkDialog({
  current,
  hasSelection,
  onClose,
  onApply,
}: {
  current: string;
  hasSelection: boolean;
  onClose: () => void;
  onApply: (href: string, text?: string) => void;
}) {
  const [error, setError] = useState('');
  return createPortal(
    <CatalogDialog title="Insert link" pending={false} onClose={onClose}>
      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const data = new FormData(event.currentTarget);
          const href = letterLink.safeParse(formText(data, 'href'));
          if (!href.success) {
            setError(href.error.issues[0]?.message ?? 'Check the link.');
            return;
          }
          onApply(href.data, formText(data, 'text'));
        }}
      >
        <Field label="Link address">
          <input
            name="href"
            required
            maxLength={2048}
            defaultValue={current}
            placeholder="https://example.com"
          />
        </Field>
        {!current && !hasSelection ? (
          <Field label="Link text (optional)">
            <input name="text" maxLength={200} />
          </Field>
        ) : null}
        {error ? <Alert>{error}</Alert> : null}
        <div className="actions">
          {current ? (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                onApply('');
              }}
            >
              Remove link
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Apply link
          </button>
        </div>
      </form>
    </CatalogDialog>,
    document.body,
  );
}
