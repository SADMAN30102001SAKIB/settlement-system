import { useState } from 'react';
import { createPortal } from 'react-dom';
import { letterLayout, paperSizes } from '../../../shared/letter';
import type { LetterLayout } from '../../../shared/letter';
import { CatalogDialog } from '../../components/catalog-dialog';
import { Alert, Field } from '../../components/ui';

import { defaultLetterLayoutKey } from './letter-layout';

export function LetterPageSetup({
  value,
  onApply,
  onClose,
}: {
  value: LetterLayout;
  onApply: (value: LetterLayout) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState('');
  function field<K extends keyof LetterLayout>(key: K, value: LetterLayout[K]) {
    setDraft((old) => ({ ...old, [key]: value }));
  }
  function numberField(
    key: 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height',
    label: string,
    min: number,
    max: number,
  ) {
    return (
      <Field label={label} key={key}>
        <input
          type="number"
          min={min}
          max={max}
          step="0.01"
          required
          value={Number.isNaN(draft[key]) ? '' : draft[key]}
          onChange={(event) => {
            field(key, event.currentTarget.valueAsNumber);
          }}
        />
      </Field>
    );
  }
  return createPortal(
    <CatalogDialog title="Page setup" pending={false} onClose={onClose}>
      <form
        className="panel letter-setup"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const parsed = letterLayout.safeParse(draft);
          if (!parsed.success) {
            setError(
              parsed.error.issues[0]?.message ?? 'Check the page setup.',
            );
            return;
          }
          if (
            event.nativeEvent.submitter?.getAttribute('value') === 'default'
          ) {
            try {
              localStorage.setItem(
                defaultLetterLayoutKey,
                JSON.stringify(parsed.data),
              );
            } catch {
              setError(
                'This browser could not save your default page setup. You can still apply it with OK.',
              );
              return;
            }
          }
          onApply(parsed.data);
        }}
      >
        <fieldset className="letter-options">
          <legend>Page mode</legend>
          {(['pages', 'pageless'] as const).map((mode) => (
            <label key={mode}>
              <input
                type="radio"
                name="letter-page-mode"
                checked={draft.mode === mode}
                onChange={() => {
                  field('mode', mode);
                }}
              />{' '}
              {mode === 'pages' ? 'Pages' : 'Pageless'}
            </label>
          ))}
        </fieldset>
        {draft.mode === 'pageless' ? (
          <p className="caption">
            Edit continuously. PDF and Print still use the paper settings below.
          </p>
        ) : null}
        <Field label="Apply to">
          <select value="whole" disabled>
            <option value="whole">Whole document</option>
          </select>
        </Field>
        <fieldset className="letter-options">
          <legend>Orientation</legend>
          {(['portrait', 'landscape'] as const).map((orientation) => (
            <label key={orientation}>
              <input
                type="radio"
                name="letter-orientation"
                checked={draft.orientation === orientation}
                onChange={() => {
                  field('orientation', orientation);
                }}
              />{' '}
              {orientation === 'portrait' ? 'Portrait' : 'Landscape'}
            </label>
          ))}
        </fieldset>
        <div className="form-grid">
          <Field label="Paper size">
            <select
              value={draft.size}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (value === 'Custom' || Object.hasOwn(paperSizes, value))
                  field('size', value as LetterLayout['size']);
              }}
            >
              {Object.entries(paperSizes).map(([size, [width, height]]) => (
                <option value={size} key={size}>
                  {size} ({Number(width.toFixed(2))} ×{' '}
                  {Number(height.toFixed(2))} in)
                </option>
              ))}
              <option value="Custom">Custom size</option>
            </select>
          </Field>
          <Field label="Page color">
            <input
              type="color"
              value={draft.color}
              onChange={(event) => {
                field('color', event.currentTarget.value);
              }}
            />
          </Field>
          {draft.size === 'Custom' ? (
            <>
              {numberField('width', 'Width (in)', 3, 24)}
              {numberField('height', 'Height (in)', 3, 24)}
            </>
          ) : null}
        </div>
        <fieldset className="letter-margins">
          <legend>Margins (inches)</legend>
          <div className="form-grid">
            {(['top', 'bottom', 'left', 'right'] as const).map((side) =>
              numberField(
                side,
                side.charAt(0).toUpperCase() + side.slice(1),
                0,
                8,
              ),
            )}
          </div>
        </fieldset>
        {error ? <Alert>{error}</Alert> : null}
        <p className="caption">
          Set as Default applies to new letters in this browser.
        </p>
        <div className="actions">
          <button className="secondary" type="submit" value="default">
            Set as Default
          </button>
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" value="apply">
            OK
          </button>
        </div>
      </form>
    </CatalogDialog>,
    document.body,
  );
}
