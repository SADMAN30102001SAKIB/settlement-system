import { useState } from 'react';
import { z } from 'zod';
import { api, okSchema } from '../lib/api';
import { Alert, ErrorMessage, Field } from './ui';
import { prepareInvoiceImage } from '../lib/prepare-image';
import { FilePicker } from './file-picker';

export function ImageUpload({
  kind,
  currentId,
  onChange,
  onPendingChange,
}: {
  kind: 'proof' | 'watermark' | 'signature';
  currentId: string | null;
  onChange: (id: string | null) => Promise<void>;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [removeBackground, setRemoveBackground] = useState(false);
  async function upload(file: File) {
    setPending(true);
    onPendingChange?.(true);
    setError('');
    try {
      if (file.size > 3_000_000)
        throw new Error('Choose an image smaller than 3 MB.');
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
        throw new Error('Choose a PNG, JPEG or WebP image.');
      const body =
        kind !== 'proof' && removeBackground
          ? await prepareInvoiceImage(file)
          : file;
      const response = await fetch(`/api/manage/files/${kind}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(
            body === file ? file.name : `${file.name}.png`,
          ),
        },
        body,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const parsed = z.object({ error: z.string() }).safeParse(payload);
        throw new Error(
          parsed.success ? parsed.data.error : 'Image upload failed.',
        );
      }
      const saved = z.object({ id: z.string() }).parse(payload);
      await onChange(saved.id);
      if (currentId !== null)
        await api(`/manage/files/${currentId}`, okSchema, {
          method: 'DELETE',
          body: {},
        });
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
      onPendingChange?.(false);
    }
  }
  async function remove() {
    if (
      currentId === null ||
      !window.confirm(`Permanently delete this ${kind} image?`)
    )
      return;
    setPending(true);
    onPendingChange?.(true);
    setError('');
    try {
      await api(`/manage/files/${currentId}`, okSchema, {
        method: 'DELETE',
        body: {},
      });
      await onChange(null);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
      onPendingChange?.(false);
    }
  }
  async function restore() {
    if (
      !window.confirm(
        `Replace the current ${kind} with the original default? The previous file remains available in Private files.`,
      )
    )
      return;
    setPending(true);
    setError('');
    try {
      const result = await api(
        `/manage/files/defaults/${kind}`,
        z.object({ id: z.string() }),
        { method: 'POST', body: {} },
      );
      await onChange(result.id);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="image-upload">
      {currentId ? (
        <a
          href={`/api/manage/files/${currentId}`}
          target="_blank"
          rel="noreferrer"
        >
          <img src={`/api/manage/files/${currentId}`} alt={`${kind} preview`} />
        </a>
      ) : (
        <p className="muted">No custom {kind} image.</p>
      )}
      <Field
        label={`${currentId ? 'Replace' : 'Upload'} ${kind} (PNG, JPEG or WebP)`}
      >
        <FilePicker
          accept="image/png,image/jpeg,image/webp"
          disabled={pending}
          onFile={(file) => {
            upload(file).catch((reason: unknown) => {
              setError(ErrorMessage(reason));
            });
          }}
        />
      </Field>
      {kind !== 'proof' ? (
        <>
          <label className="check-field">
            <input
              type="checkbox"
              checked={removeBackground}
              disabled={pending}
              onChange={(event) => {
                setRemoveBackground(event.target.checked);
              }}
            />{' '}
            Remove light background and convert artwork to black
          </label>
          <p className="caption">
            For dark logos or signatures on a light background. Leave off to
            preserve original colors and transparency.
          </p>
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={() => {
              restore().catch((reason: unknown) => {
                setError(ErrorMessage(reason));
              });
            }}
          >
            Restore default {kind}
          </button>
        </>
      ) : null}
      {currentId ? (
        <button
          type="button"
          className="text-button danger-text"
          disabled={pending}
          onClick={() => {
            remove().catch((reason: unknown) => {
              setError(ErrorMessage(reason));
            });
          }}
        >
          Delete image
        </button>
      ) : null}
      {pending ? <p role="status">Updating image…</p> : null}
      {error ? <Alert>{error}</Alert> : null}
    </div>
  );
}
