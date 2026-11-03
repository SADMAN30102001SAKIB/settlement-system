import { useEffect } from 'react';
import { useEditor, EditorContent, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style/text-style';
import { Color } from '@tiptap/extension-text-style/color';
import { BackgroundColor } from '@tiptap/extension-text-style/background-color';
import type { JSONContent } from '@tiptap/react';
export function LetterEditor({
  value,
  onChange,
  disabled,
}: {
  value: JSONContent;
  onChange: (body: JSONContent) => void;
  disabled: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        link: false,
        dropcursor: false,
        gapcursor: false,
        trailingNode: false,
      }),
      TextStyle,
      Color,
      BackgroundColor,
    ],
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
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const attrs = current.getAttributes('textStyle');
      const color: unknown = attrs['color'],
        background: unknown = attrs['backgroundColor'];
      return {
        bold: current.isActive('bold'),
        italic: current.isActive('italic'),
        underline: current.isActive('underline'),
        strike: current.isActive('strike'),
        color: typeof color === 'string' ? color : '',
        background: typeof background === 'string' ? background : '',
      };
    },
  });
  useEffect(() => {
    editor.setEditable(!disabled);
  }, [editor, disabled]);
  return (
    <div className="letter-editor">
      <div
        className="letter-toolbar"
        role="toolbar"
        aria-label="Letter formatting"
      >
        {(['bold', 'italic', 'underline', 'strike'] as const).map((mark) => (
          <button
            type="button"
            className="secondary compact"
            key={mark}
            aria-label={
              mark === 'strike'
                ? 'Strikethrough'
                : mark.charAt(0).toUpperCase() + mark.slice(1)
            }
            aria-pressed={active[mark]}
            disabled={disabled}
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
            {mark === 'strike'
              ? 'Strike'
              : mark.charAt(0).toUpperCase() + mark.slice(1)}
          </button>
        ))}
        <label>
          Text color
          <select
            aria-label="Letter text color"
            value={active.color}
            disabled={disabled}
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
        <label>
          Highlight
          <select
            aria-label="Letter highlight"
            value={active.background}
            disabled={disabled}
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
        <button
          type="button"
          className="secondary compact"
          disabled={disabled}
          onClick={() => {
            editor.chain().focus().unsetAllMarks().run();
          }}
        >
          Clear formatting
        </button>
        <button
          type="button"
          className="secondary compact"
          disabled={disabled || !editor.can().undo()}
          onClick={() => {
            editor.chain().focus().undo().run();
          }}
        >
          Undo
        </button>
        <button
          type="button"
          className="secondary compact"
          disabled={disabled || !editor.can().redo()}
          onClick={() => {
            editor.chain().focus().redo().run();
          }}
        >
          Redo
        </button>
      </div>
      <EditorContent editor={editor} />
      <small className="caption">
        English or বাংলা · Bold, italic, underline, strikethrough, color and
        highlighting.
      </small>
    </div>
  );
}
