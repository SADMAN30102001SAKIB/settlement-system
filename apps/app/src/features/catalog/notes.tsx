import { useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';
import { z } from 'zod';

import {
  Alert,
  Empty,
  ErrorMessage,
  Field,
  PageHeading,
} from '../../components/ui';
import { api, noteSchema, okSchema } from '../../lib/api';
import type { Brand, Note } from '../../lib/api';
import { formText } from '../../lib/format';
const noteListSchema = z.object({
  items: z.array(noteSchema),
  next: z.object({ before: z.number(), beforeId: z.string() }).nullable(),
});

export function Notes({ brands }: { brands: Brand[] }) {
  const [items, setItems] = useState<Note[]>([]);
  const [editing, setEditing] = useState<Note | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const [brandFilter, setBrandFilter] = useState('');
  const [cursor, setCursor] =
    useState<z.infer<typeof noteListSchema>['next']>(null);
  const [next, setNext] =
    useState<z.infer<typeof noteListSchema>['next']>(null);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (brandFilter) query.set('brandId', brandFilter);
    if (cursor) {
      query.set('before', String(cursor.before));
      query.set('beforeId', cursor.beforeId);
    }
    api(`/manage/notes?${query.toString()}`, noteListSchema, {
      signal: controller.signal,
    })
      .then((data) => {
        setItems((current) =>
          cursor ? [...current, ...data.items] : data.items,
        );
        setNext(data.next);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => {
      controller.abort();
    };
  }, [reload, brandFilter, cursor]);
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setError('');
    setPending(true);
    try {
      await api(
        `/manage/notes${editing ? `/${editing.id}` : ''}`,
        z.object({ item: z.unknown() }),
        {
          method: editing ? 'PUT' : 'POST',
          body: {
            brandId: formText(values, 'brandId'),
            period: formText(values, 'period'),
            type: formText(values, 'type'),
            content: formText(values, 'content'),
          },
        },
      );
      setEditing(null);
      form.reset();
      setReload((current) => current + 1);
      setCursor(null);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  async function remove(note: Note) {
    if (
      !window.confirm(`Delete the note for ${note.brandName} (${note.period})?`)
    )
      return;
    setPending(true);
    setError('');
    try {
      await api(`/manage/notes/${note.id}`, okSchema, {
        method: 'DELETE',
        body: {},
      });
      setReload((current) => current + 1);
      setCursor(null);
      if (editing?.id === note.id) setEditing(null);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="OPERATIONS / NOTES"
        title="Keep the work moving"
        description="Record what’s finished, what’s sent, and what needs your attention."
      />
      <div className="split-layout">
        <section className="panel">
          <h2>Work notes</h2>
          <Field label="Filter notes by brand">
            <select
              value={brandFilter}
              onChange={(event) => {
                setBrandFilter(event.target.value);
                setCursor(null);
                setItems([]);
              }}
            >
              <option value="">All brands</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </Field>
          {items.length ? (
            items.map((note) => (
              <article key={note.id} className="note-item">
                <div className="section-heading">
                  <div>
                    <strong>{note.brandName}</strong>
                    <small className="muted">
                      {note.period} · {note.type}
                    </small>
                  </div>
                  <div className="actions">
                    <button
                      className="secondary compact"
                      disabled={pending}
                      onClick={() => {
                        setEditing(note);
                        setError('');
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="text-button danger-text"
                      disabled={pending}
                      onClick={() => {
                        remove(note).catch((reason: unknown) => {
                          setError(ErrorMessage(reason));
                        });
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p>{note.content}</p>
              </article>
            ))
          ) : (
            <Empty title="Nothing lost between days">
              Keep a note of completed invoices and settlement work.
            </Empty>
          )}
          {next ? (
            <button
              className="secondary"
              disabled={pending}
              onClick={() => {
                setPending(true);
                setCursor(next);
              }}
            >
              Load 200 older notes
            </button>
          ) : null}
        </section>
        <section className="panel">
          <h2>{editing ? 'Edit note' : 'Add a note'}</h2>
          <form
            key={editing?.id ?? 'new'}
            onSubmit={(event) => {
              save(event).catch((reason: unknown) => {
                setError(ErrorMessage(reason));
              });
            }}
            onChange={() => {
              setError('');
            }}
          >
            <Field label="Brand">
              <select
                name="brandId"
                defaultValue={editing?.brandId ?? ''}
                required
              >
                <option value="">Select brand</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date / period">
              <input
                name="period"
                required
                maxLength={120}
                defaultValue={editing?.period ?? ''}
              />
            </Field>
            <Field label="Progress">
              <select name="type" defaultValue={editing?.type ?? 'Both done'}>
                {[
                  'Ads Invoice ready',
                  '15% calculated',
                  'Both done',
                  'Other',
                ].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </Field>
            <Field label="Note">
              <textarea
                name="content"
                maxLength={1000}
                rows={4}
                defaultValue={editing?.content ?? ''}
              />
            </Field>
            {error ? <Alert>{error}</Alert> : null}
            <div className="actions">
              <button
                className="primary"
                disabled={pending || brands.length === 0}
              >
                {pending ? 'Saving…' : 'Save note'}
              </button>
              {editing ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setEditing(null);
                  }}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </section>
      </div>
    </>
  );
}
