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
import { BrandAccess } from './brand-access';
import { costCorrectionPreview } from '../../../shared/cost-correction';

export function Brands({
  brands,
  refresh,
}: {
  brands: Brand[];
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<Brand | null>(null);
  const [opened, setOpened] = useState(false);
  const [accessBrand, setAccessBrand] = useState<Brand | null>(null);
  const [activation, setActivation] = useState<
    'activate' | 'deactivate' | undefined
  >();
  const [accessRevision, setAccessRevision] = useState(0);
  const confirm = useConfirmation();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [scope, setScope] = useState('new');
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPending(true);
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const cost = formText(values, 'cost');
      const input = {
        name: formText(values, 'name'),
        makingCost: cost.trim() ? parseMoney(cost) : null,
      };
      if (editing && scope === 'existing') {
        if (input.makingCost === null)
          throw new Error(
            'Enter a making cost before correcting existing orders.',
          );
        const correction = {
          ...input,
          from: formText(values, 'from'),
          to: formText(values, 'to'),
        };
        const preview = await api(
          `/manage/brand-costs/${editing.id}/preview`,
          costCorrectionPreview,
          { method: 'POST', body: correction },
        );
        if (
          !(await confirm({
            title: 'Apply cost correction?',
            message: `${String(preview.count)} orders will use ${money(input.makingCost)} per piece. Delivered product cost: ${money(preview.before)} → ${money(preview.after)} (${String(preview.deliveredUnits)} affected delivered items). Pending orders are included for future delivery. Saved invoices and payments will not change.`,
            action: 'Apply correction',
          }))
        )
          return;
        await api(`/manage/brand-costs/${editing.id}`, okSchema, {
          method: 'POST',
          body: {
            ...correction,
            version: preview.version,
            requestId: crypto.randomUUID(),
          },
        });
      } else {
        await api(
          `/manage/brands${editing ? `/${editing.id}` : ''}`,
          z.object({ item: brandSchema }),
          {
            method: editing ? 'PUT' : 'POST',
            body: input,
          },
        );
      }
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
        message: `Permanently delete ${brand.name}? Brands with orders, budgets, invoices, payments or notes cannot be deleted. This also removes this brand’s login access and daily checklist history.`,
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
        description="Manage making costs for new orders, or review and correct existing order costs."
        action={
          <button
            className="primary"
            disabled={pending}
            onClick={() => {
              setEditing(null);
              setScope('new');
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
          refreshKey={accessRevision}
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
                <small className="muted brand-access-indicator">
                  {brand.loginAccess === 'enabled'
                    ? 'Login enabled · Active'
                    : brand.loginAccess === 'disabled'
                      ? 'Login disabled · Inactive'
                      : 'Login not configured'}
                </small>
              </div>
              <div className="actions">
                <button
                  className="secondary compact"
                  disabled={pending}
                  onClick={() => {
                    setActivation(undefined);
                    setAccessBrand(brand);
                  }}
                >
                  Login access
                </button>
                {brand.loginAccess && brand.loginAccess !== 'unconfigured' ? (
                  <button
                    className="secondary compact"
                    disabled={pending}
                    onClick={() => {
                      setActivation(
                        brand.loginAccess === 'enabled'
                          ? 'deactivate'
                          : 'activate',
                      );
                      setAccessBrand(brand);
                    }}
                  >
                    {brand.loginAccess === 'enabled'
                      ? 'Deactivate'
                      : 'Activate'}
                  </button>
                ) : null}
                <button
                  disabled={pending}
                  className="secondary compact"
                  onClick={() => {
                    setEditing(brand);
                    setScope('new');
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
            {editing ? (
              <>
                <Field label="Apply making cost to">
                  <select
                    value={scope}
                    onChange={(event) => {
                      setScope(event.target.value);
                    }}
                  >
                    <option value="new">New orders only</option>
                    <option value="existing">New and existing orders</option>
                  </select>
                </Field>
                {scope === 'existing' ? (
                  <>
                    <p className="caption">
                      Choose existing orders by order date. You will review the
                      affected costs before saving. Saved invoices and payments
                      stay unchanged.
                    </p>
                    <div className="form-grid cost-correction-dates">
                      <Field label="Orders from">
                        <input type="date" name="from" required />
                      </Field>
                      <Field label="Orders through">
                        <input type="date" name="to" required />
                      </Field>
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
            {error ? <Alert>{error}</Alert> : null}
            <div className="actions">
              <button className="primary" disabled={pending}>
                {pending ? (
                  <>
                    <Spinner size={12} /> Saving…
                  </>
                ) : scope === 'existing' ? (
                  'Preview correction'
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
      {accessBrand ? (
        <BrandAccess
          brand={accessBrand}
          action={activation}
          onSaved={() => {
            setAccessRevision((value) => value + 1);
          }}
          onClose={() => {
            setAccessBrand(null);
          }}
        />
      ) : null}
    </>
  );
}
