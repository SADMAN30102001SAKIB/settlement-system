import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { parseMoney } from '@settlement/domain/money';
import { z } from 'zod';

import {
  Alert,
  Empty,
  ErrorMessage,
  Field,
  PageHeading,
  Spinner,
} from '../../components/ui';
import { api, brandSchema } from '../../lib/api';
import type { Brand } from '../../lib/api';
import { amountInput, formText, money } from '../../lib/format';

export function Brands({
  brands,
  refresh,
}: {
  brands: Brand[];
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Brand | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPending(true);
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const cost = formText(values, 'cost');
      await api(
        `/manage/brands${editing ? `/${editing.id}` : ''}`,
        z.object({ item: brandSchema }),
        {
          method: editing ? 'PUT' : 'POST',
          body: {
            name: formText(values, 'name'),
            makingCost: cost.trim() ? parseMoney(cost) : null,
          },
        },
      );
      setEditing(null);
      form.reset();
      await refresh();
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE / BRANDS"
        title="Built around your brands"
        description="Manage making costs without changing the costs already saved on previous orders."
      />
      <div className="split-layout">
        <section className="panel">
          <div className="section-heading">
            <h2>Brand directory</h2>
            <span className="pill">{brands.length} brands</span>
          </div>
          {brands.length ? (
            <div className="brand-list">
              {brands.map((brand) => (
                <article key={brand.id} className="brand-row">
                  <span className="avatar">{brand.name.slice(0, 1)}</span>
                  <div>
                    <strong>{brand.name}</strong>
                    <small className="muted">
                      {brand.makingCost === null
                        ? 'Making cost not set'
                        : `${money(brand.makingCost)} / piece`}
                    </small>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => {
                      setEditing(brand);
                      setError('');
                    }}
                  >
                    Edit
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <Empty title="Your first brand starts here">
              Add a brand and its making cost to begin.
            </Empty>
          )}
        </section>
        <section className="panel">
          <h2>{editing ? 'Edit brand' : 'Add a brand'}</h2>
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
            <Field label="Brand name">
              <input
                name="name"
                required
                maxLength={80}
                defaultValue={editing?.name ?? ''}
              />
            </Field>
            <Field
              label="Making cost per piece (৳)"
              hint="Leave empty if unknown. Zero means a deliberately free making cost."
            >
              <input
                name="cost"
                inputMode="decimal"
                defaultValue={amountInput(editing?.makingCost ?? null)}
              />
            </Field>
            {error ? <Alert>{error}</Alert> : null}
            <div className="actions">
              <button className="primary" disabled={pending}>
                {pending ? (
                  <>
                    <Spinner size={12} /> Saving…
                  </>
                ) : (
                  'Save brand'
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
