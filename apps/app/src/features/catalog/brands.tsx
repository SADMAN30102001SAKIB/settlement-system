import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { parseMoney } from '@settlement/domain/money';
import { z } from 'zod';

import {
  Alert,
  ErrorMessage,
  Field,
  PageHeading,
  Spinner,
} from '../../components/ui';
import { api, brandSchema, okSchema } from '../../lib/api';
import { CatalogDialog } from '../../components/catalog-dialog';
import { useConfirmation } from '../../components/confirmation-context';
import type { Brand } from '../../lib/api';
import { amountInput, formText, money } from '../../lib/format';
import { BrandList } from '../../components/brand-list';

export function Brands({
  brands,
  refresh,
}: {
  brands: Brand[];
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Brand | null>(null);
  const [opened, setOpened] = useState(false);
  const confirm = useConfirmation();
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
      await refresh();
      setOpened(false);
      setEditing(null);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  async function remove(brand: Brand) {
    if (
      !(await confirm({
        title: 'Delete brand?',
        message: `Permanently delete ${brand.name}? Only unused brands can be deleted. Linked records will never be removed.`,
        action: 'Delete brand',
        destructive: true,
      }))
    )
      return;
    setPending(true);
    setError('');
    try {
      await api(`/manage/brands/${brand.id}`, okSchema, {
        method: 'DELETE',
        body: {},
      });
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
        action={
          <button
            className="primary"
            disabled={pending}
            onClick={() => {
              setEditing(null);
              setError('');
              setOpened(true);
            }}
          >
            Add brand
          </button>
        }
      />
      {error && !opened ? <Alert>{error}</Alert> : null}
      <section className="panel">
        <div className="section-heading">
          <h2>Brand directory</h2>
        </div>
        <BrandList
          revision={brands}
          render={(brand) => (
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
              <div className="actions">
                <button
                  disabled={pending}
                  className="secondary compact"
                  onClick={() => {
                    setEditing(brand);
                    setError('');
                    setOpened(true);
                  }}
                >
                  Edit
                </button>
                <button
                  className="secondary compact danger-text"
                  disabled={pending}
                  onClick={() => {
                    remove(brand).catch((reason: unknown) => {
                      setError(ErrorMessage(reason));
                    });
                  }}
                >
                  Delete
                </button>
              </div>
            </article>
          )}
        />
      </section>
      {opened ? (
        <CatalogDialog
          title={editing ? 'Edit brand' : 'Add brand'}
          pending={pending}
          onClose={() => {
            setOpened(false);
            setEditing(null);
          }}
        >
          <form
            className="panel"
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
              <button
                type="button"
                className="secondary"
                disabled={pending}
                onClick={() => {
                  setOpened(false);
                  setEditing(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </CatalogDialog>
      ) : null}
    </>
  );
}
