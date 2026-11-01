import { useEffect, useRef, useState } from 'react';
import { useSavedFilters } from '../../lib/saved-filters';
import { DateShortcuts } from '../../components/date-shortcuts';
import { z } from 'zod';
import { parseMoney } from '@settlement/domain/money';
import { api, okSchema } from '../../lib/api';
import type { Brand } from '../../lib/api';
import {
  Alert,
  ErrorMessage,
  Field,
  PageHeading,
  SkeletonTable,
  Spinner,
} from '../../components/ui';
import { useConfirmation } from '../../components/confirmation-context';
import { amountInput, formText, money, today } from '../../lib/format';
import { orderListSchema } from './contracts';
import type { Order } from './contracts';
import { Importer } from './importer';
import { OrderRow } from './order-row';
import { ScrollList, VirtualBody } from '../../components/scroll-list';
import { useInfiniteQuery } from '../../lib/infinite-query';

const dailySchema = z
  .object({
    next: z.object({ before: z.string(), beforeBrand: z.string() }).nullable(),
    days: z.array(
      z.object({
        date: z.string(),
        brandId: z.string(),
        count: z.number().int(),
        delivered: z.number().int(),
        cancelled: z.number().int(),
        partial: z.number().int(),
        pending: z.number().int(),
        amount: z.number().int().nullable(),
      }),
    ),
  })
  .transform((data) => ({
    next: data.next,
    items: data.days.map((day) => ({ ...day, id: day.brandId + day.date })),
  }));

export function Business({ brands }: { brands: Brand[] }) {
  const confirm = useConfirmation();
  const [filters, setFilters] = useSavedFilters('business', {
    from: today().slice(0, 7) + '-01',
    to: today(),
    brandId: '',
  });
  const [orderSearch, setOrderSearch] = useSavedFilters(
    'business-order-search',
    { q: '' },
  );
  const search = orderSearch.q;
  const setSearch = (q: string) => {
    setOrderSearch({ q });
  };
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [adBrand, setAdBrand] = useState('');
  const [adDate, setAdDate] = useState(today());
  const [adAmount, setAdAmount] = useState('');
  const [message, setMessage] = useState('');
  const query = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    ...(filters.brandId ? { brandId: filters.brandId } : {}),
  }).toString();
  const daily = useInfiniteQuery(
    `/manage/business/daily?${query}`,
    dailySchema,
    revision,
  );
  const orderList = useInfiniteQuery(
    `/manage/business/orders?${query}&basis=order${search ? '&q=' + encodeURIComponent(search) : ''}`,
    orderListSchema,
    revision,
  );
  const days = daily.items;
  const items = orderList.items;
  const dailyLoading = daily.loading;
  const loading = orderList.loading;
  const [drafts, setDrafts] = useState<
    Record<string, { brandId: string; sales: string }>
  >({});
  const editDialog = useRef<HTMLDialogElement>(null);
  const adsForm = useRef<HTMLFormElement>(null);
  const name = (id: string) =>
    brands.find((brand) => brand.id === id)?.name ?? 'Brand';
  function refresh() {
    setRevision((value) => value + 1);
  }
  useEffect(() => {
    if (editing) editDialog.current?.showModal();
    else editDialog.current?.close();
  }, [editing]);
  async function saveAds() {
    if (!adBrand) throw new Error('Choose the brand for this daily spend.');
    setPending(true);
    setError('');
    setMessage('');
    try {
      await api('/manage/business/ads', okSchema, {
        method: 'PUT',
        body: { brandId: adBrand, date: adDate, amount: parseMoney(adAmount) },
      });
      setMessage(
        'Daily advertising saved. The same budget is split across this brand’s orders for the order date; importing again does not add the budget twice.',
      );
      refresh();
    } finally {
      setPending(false);
    }
  }
  async function removeDay(day: z.infer<typeof dailySchema>['items'][number]) {
    if (
      !(await confirm({
        title: 'Remove imported day?',
        message:
          'Remove ' +
          name(day.brandId) +
          ' orders and daily advertising for ' +
          day.date +
          '? Saved invoices will not be deleted.',
        action: 'Remove day',
        destructive: true,
      }))
    )
      return;
    setPending(true);
    setError('');
    try {
      await api('/manage/business/day', okSchema, {
        method: 'DELETE',
        body: { brandId: day.brandId, date: day.date },
      });
      refresh();
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="business-tracking">
      <PageHeading
        eyebrow="OPERATIONS / BUSINESS TRACKING"
        title="Business Tracking"
        description="Steadfast daily import, brand-wise advertising and saved orders."
        action={
          <a
            className="primary business-settlement-link"
            href="/settlements/new"
          >
            Create settlement
          </a>
        }
      />
      {error ? <Alert>{error}</Alert> : null}
      <section
        className="business-import-step"
        aria-label="Steadfast daily import"
      >
        <p className="eyebrow">01 / STEADFAST DAILY IMPORT</p>
        <Importer brands={brands} onImported={refresh} />
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">02 / DAILY ADVERTISING</p>
            <h2>Daily advertising spend</h2>
            <p className="muted">
              Daily brand spend ÷ that brand’s order count = advertising per
              order. Delivered, partial, cancelled and pending orders all count.
            </p>
          </div>
        </div>
        <form
          ref={adsForm}
          className="form-grid business-ads-form"
          onSubmit={(event) => {
            event.preventDefault();
            saveAds().catch((reason: unknown) => {
              setError(ErrorMessage(reason));
            });
          }}
        >
          <Field label="Advertising brand">
            <select
              required
              value={adBrand}
              onChange={(event) => {
                setAdBrand(event.target.value);
                setError('');
                setMessage('');
              }}
            >
              <option value="">Choose brand</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Advertising order date">
            <input
              type="date"
              required
              value={adDate}
              onChange={(event) => {
                setAdDate(event.target.value);
                setMessage('');
              }}
            />
          </Field>
          <Field label="Total ads spend (৳)">
            <input
              required
              inputMode="decimal"
              value={adAmount}
              onChange={(event) => {
                setAdAmount(event.target.value);
                setMessage('');
              }}
            />
          </Field>
          <button className="primary form-submit" disabled={pending}>
            {pending ? (
              <>
                <Spinner size={12} /> Saving…
              </>
            ) : (
              'Save daily ad spend'
            )}
          </button>
        </form>
        {message ? (
          <p role="status" className="success">
            {message}
          </p>
        ) : null}
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">03 / REVIEW</p>
            <h2>Daily summary</h2>
            <p className="muted">
              Base advertising spend, before invoice VAT. Unallocated budgets
              stay saved until orders arrive.
            </p>
          </div>
        </div>
        <DateShortcuts
          onSelect={(from, to) => {
            setFilters({ ...filters, from, to });
          }}
        />
        <form
          key={JSON.stringify(filters)}
          className="form-grid business-summary-filters"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const from = formText(form, 'from'),
              to = formText(form, 'to');
            if (!from || !to || from > to) {
              setError('Choose a valid date range.');
              return;
            }
            setError('');
            setFilters({ from, to, brandId: formText(form, 'brandId') });
          }}
        >
          <Field label="Summary brand">
            <select name="brandId" defaultValue={filters.brandId}>
              <option value="">All brands</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input
              name="from"
              type="date"
              required
              defaultValue={filters.from}
            />
          </Field>
          <Field label="To">
            <input name="to" type="date" required defaultValue={filters.to} />
          </Field>
          <button className="secondary form-submit" disabled={loading}>
            Apply filters
          </button>
        </form>
        <ScrollList
          {...daily.scrollProps}
          count={days.length}
          className="table-scroll"
          label="Daily summary"
        >
          <table className="business-daily-table" aria-busy={dailyLoading}>
            <thead>
              <tr>
                {[
                  'Brand',
                  'Order date',
                  'Orders',
                  'Delivered',
                  'Cancelled',
                  'Partial',
                  'Pending',
                  'Daily ad spend',
                  'Ads / order',
                  'Actions',
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <VirtualBody columns={10}>
              {days.map((day) => (
                <tr key={day.brandId + day.date}>
                  <td>{name(day.brandId)}</td>
                  <td>{day.date}</td>
                  <td>{day.count}</td>
                  <td>{day.delivered}</td>
                  <td>{day.cancelled}</td>
                  <td>{day.partial}</td>
                  <td>{day.pending}</td>
                  <td>
                    {day.amount === null ? 'Not entered' : money(day.amount)}
                  </td>
                  <td>
                    {day.count && day.amount !== null
                      ? money(Math.round(day.amount / day.count / 10) * 10)
                      : 'Not allocated'}
                  </td>
                  <td>
                    <div className="actions">
                      <button
                        className="secondary compact"
                        onClick={() => {
                          setAdBrand(day.brandId);
                          setAdDate(day.date);
                          setAdAmount(amountInput(day.amount));
                          adsForm.current?.scrollIntoView({ block: 'center' });
                          adsForm.current
                            ?.querySelector('input')
                            ?.focus({ preventScroll: true });
                        }}
                      >
                        Edit ad spend
                      </button>
                      <button
                        className="secondary compact danger-text"
                        disabled={pending}
                        onClick={() => {
                          removeDay(day).catch((reason: unknown) => {
                            setError(ErrorMessage(reason));
                          });
                        }}
                      >
                        Remove day
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!days.length ? (
                <tr>
                  <td colSpan={10}>
                    No orders or daily advertising in this range.
                  </td>
                </tr>
              ) : null}
            </VirtualBody>
          </table>
        </ScrollList>
        <p className="caption">
          Allocation is rounded to paisa. Any remainder is assigned
          deterministically to orders so the allocated total always equals the
          saved budget.
        </p>
      </section>
      <section className="panel" aria-label="Saved orders">
        <div className="section-heading">
          <div>
            <h2>Orders</h2>
            <p className="muted">
              Scroll to load more orders. Search an exact Order ID across all
              dates within the selected brand.
            </p>
          </div>
        </div>
        <form
          className="order-search"
          onSubmit={(event) => {
            event.preventDefault();
            setError('');
            const value = formText(
              new FormData(event.currentTarget),
              'q',
            ).trim();
            if (value === search) {
              orderList.refresh();
              return;
            }
            setSearch(value);
          }}
        >
          <Field label="Find Order ID">
            <input
              name="q"
              type="search"
              maxLength={100}
              placeholder="Exact Order ID"
              defaultValue={search}
            />
          </Field>
          <button className="secondary" disabled={loading}>
            Find order
          </button>
          <button
            type="button"
            className="secondary"
            onClick={(event) => {
              event.currentTarget.form?.reset();
              setSearch('');
            }}
          >
            Clear search
          </button>
        </form>
        {loading && !items.length ? (
          <SkeletonTable rows={4} columns={8} />
        ) : (
          <ScrollList
            {...orderList.scrollProps}
            count={items.length}
            className="table-scroll"
            label="Orders"
          >
            <table className="business-orders-table">
              <thead>
                <tr>
                  {[
                    'Date',
                    'Order ID',
                    'Ads cost',
                    'Brand',
                    'Sales amount',
                    'Status',
                    'Delivery date',
                    'COD',
                    'Shipping',
                    'COD charge',
                    'Product cost',
                    'Action',
                  ].map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <VirtualBody columns={12}>
                {items.map((item) => (
                  <OrderRow
                    key={item.id + ':' + String(item.revision)}
                    item={item}
                    brands={brands}
                    draft={drafts[item.id + ':' + String(item.revision)]}
                    onDraft={(draft) => {
                      setDrafts((current) => ({
                        ...current,
                        [item.id + ':' + String(item.revision)]: draft,
                      }));
                    }}
                    onSaved={refresh}
                    onEdit={() => {
                      setEditing(item);
                    }}
                  />
                ))}
                {!items.length ? (
                  <tr>
                    <td colSpan={12}>No orders match this view.</td>
                  </tr>
                ) : null}
              </VirtualBody>
            </table>
          </ScrollList>
        )}
        <p className="caption">
          Edit Brand or Sales amount in the row, then save changes. Blank sales
          uses COD for Steadfast; Pathao always uses its collected amount.
          Product cost uses delivered item quantity and the saved making cost;
          “Edit order” manages quantities and cost corrections.
        </p>
      </section>
      <dialog
        ref={editDialog}
        className="business-dialog"
        onCancel={() => {
          setEditing(null);
        }}
      >
        <header className="business-dialog-heading">
          <h2>Edit order {editing?.id}</h2>
          <button
            className="secondary compact"
            onClick={() => {
              setEditing(null);
            }}
          >
            Close
          </button>
        </header>
        {editing ? (
          <form
            className="panel"
            key={editing.id}
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const amount = (key: string) =>
                formText(form, key).trim()
                  ? parseMoney(formText(form, key))
                  : null;
              try {
                const body = {
                  revision: editing.revision,
                  brandId: formText(form, 'brandId'),
                  quantity: Number(formText(form, 'quantity')),
                  partialQuantity:
                    formText(form, 'partialQuantity') === ''
                      ? null
                      : Number(formText(form, 'partialQuantity')),
                  salesOverride:
                    editing.courier === 'pathao'
                      ? editing.salesOverride
                      : amount('salesOverride'),
                  costPerPiece: amount('costPerPiece'),
                };
                setPending(true);
                api(
                  '/manage/business/orders/' + encodeURIComponent(editing.id),
                  okSchema,
                  { method: 'PUT', body },
                )
                  .then(() => {
                    setEditing(null);
                    refresh();
                  })
                  .catch((reason: unknown) => {
                    setError(ErrorMessage(reason));
                  })
                  .finally(() => {
                    setPending(false);
                  });
              } catch (reason) {
                setError(ErrorMessage(reason));
              }
            }}
          >
            <div className="form-grid">
              <Field label="Order brand">
                <select name="brandId" defaultValue={editing.brandId}>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ordered quantity">
                <input
                  name="quantity"
                  required
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={editing.quantity}
                />
              </Field>
              <Field label="Partial delivered quantity">
                <input
                  name="partialQuantity"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={editing.partialQuantity ?? ''}
                />
              </Field>
              <Field
                label={
                  editing.courier === 'pathao'
                    ? 'Pathao collected amount (updated by courier import)'
                    : 'Actual sales amount (blank uses COD)'
                }
              >
                <input
                  name="salesOverride"
                  inputMode="decimal"
                  readOnly={editing.courier === 'pathao'}
                  defaultValue={amountInput(
                    editing.collectedAmount ?? editing.salesOverride,
                  )}
                />
              </Field>
              <Field label="Making cost per piece (blank means missing)">
                <input
                  name="costPerPiece"
                  inputMode="decimal"
                  defaultValue={amountInput(editing.costPerPiece)}
                />
              </Field>
            </div>
            <button className="primary" disabled={pending}>
              {pending ? 'Saving…' : 'Save order'}
            </button>
            {error ? <Alert>{error}</Alert> : null}
          </form>
        ) : null}
      </dialog>
    </div>
  );
}
