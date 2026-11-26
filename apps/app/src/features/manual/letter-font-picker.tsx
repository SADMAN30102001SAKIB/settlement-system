import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  googleLetterFonts,
  localLetterFonts,
} from '../../../shared/letter-fonts';
import { CatalogDialog } from '../../components/catalog-dialog';
import { Alert, ErrorMessage, Field } from '../../components/ui';
import { prepareLetterFont } from './letter-font-loading';

const families = ['', ...localLetterFonts, ...googleLetterFonts];
const fontLabel = (family: string) => family || 'Default (Manrope)';

export function LetterFontPicker({
  current,
  onChoose,
  onClose,
}: {
  current: string;
  onChoose: (family: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(current);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const term = query.trim().toLowerCase();
  const matches = term
    ? families.filter((font) => fontLabel(font).toLowerCase().includes(term))
    : families;
  const choice = matches.includes(selected) ? selected : matches[0];
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      search.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, []);
  return createPortal(
    <CatalogDialog title="Choose a font" pending={pending} onClose={onClose}>
      <form
        className="panel letter-font-picker"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (pending || choice === undefined) return;
          setPending(true);
          setError('');
          prepareLetterFont(document, choice)
            .then(() => {
              onChoose(choice);
            })
            .catch((reason: unknown) => {
              setError(ErrorMessage(reason));
              setPending(false);
            });
        }}
      >
        <Field label="Search fonts">
          <input
            ref={search}
            type="search"
            value={query}
            placeholder="Search by font name"
            disabled={pending}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
          />
        </Field>
        {choice === undefined ? (
          <p role="status">No fonts match your search.</p>
        ) : (
          <Field label="Font results">
            <select
              size={8}
              value={choice}
              disabled={pending}
              onChange={(event) => {
                setSelected(event.currentTarget.value);
              }}
            >
              {matches.map((family) => (
                <option value={family} key={family}>
                  {fontLabel(family)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <p className="caption">Bangla text keeps the existing default font.</p>
        {error ? <Alert>{error}</Alert> : null}
        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={pending || choice === undefined}
          >
            {pending ? 'Loading font…' : 'Apply font'}
          </button>
        </div>
      </form>
    </CatalogDialog>,
    document.body,
  );
}
