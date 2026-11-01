import { useState } from 'react';
import { useConfirmation } from '../../components/confirmation-context';
import type { SubmitEvent } from 'react';
import { z } from 'zod';

import {
  Alert,
  Empty,
  ErrorMessage,
  Field,
  PageHeading,
  Skeleton,
  Spinner,
} from '../../components/ui';
import { api, noteSchema, okSchema } from '../../lib/api';
import type { Brand, Note } from '../../lib/api';
import { formText } from '../../lib/format';
import { Progress } from './progress';
import { ScrollList, VirtualItems } from '../../components/scroll-list';
import { useInfiniteQuery } from '../../lib/infinite-query';
const noteListSchema = z.object({
  items: z.array(noteSchema),
  next: z.object({ before: z.number(), beforeId: z.string() }).nullable(),
});

export function Notes({ brands }: { brands: Brand[] }) {
  const confirm = useConfirmation();
  const [editing, setEditing] = useState<Note | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const [brandFilter, setBrandFilter] = useState('');
  const list = useInfiniteQuery(
    `/manage/notes?${new URLSearchParams(brandFilter ? { brandId: brandFilter } : {}).toString()}`,
    noteListSchema,
    reload,
  );
  const items = list.items;
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
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  async function remove(note: Note) {
    if (
      !(await confirm({
        title: 'Delete note?',
        message: `Delete the note for ${note.brandName} (${note.period})? This cannot be undone.`,
        action: 'Delete note',
        destructive: true,
      }))
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
      <section className="panel">
        <Field label="Filter work by brand">
          <select
            value={brandFilter}
            onChange={(event) => {
              setBrandFilter(event.target.value);
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
      </section>
      <Progress key={brandFilter} brandId={brandFilter} />
      <div className="split-layout">
        <section className="panel">
          <h2>Work notes</h2>
          <ScrollList
            {...list.scrollProps}
            count={items.length}
            label="Work notes"
          >
            {list.loading && items.length === 0 ? (
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
              >
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="panel" style={{ padding: 16 }}>
                    <Skeleton
                      width="35%"
                      height={16}
                      radius={4}
                      style={{ marginBottom: 10 }}
                    />
                    <Skeleton
                      width="85%"
                      height={14}
                      radius={3}
                      style={{ marginBottom: 6 }}
                    />
                    <Skeleton width="55%" height={14} radius={3} />
                  </div>
                ))}
              </div>
            ) : items.length ? (
              <VirtualItems>
                {items.map((note) => (
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
                ))}
              </VirtualItems>
            ) : (
              <Empty title="Nothing lost between days">
                Keep a note of completed invoices and settlement work.
              </Empty>
            )}
          </ScrollList>
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
                {pending ? (
                  <>
                    <Spinner size={12} /> Saving…
                  </>
                ) : (
                  'Save note'
                )}
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
