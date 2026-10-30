import { useEffect, useRef, useState } from 'react';
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
import { Pagination } from '../../components/pagination';
import { useCursor } from '../../lib/pagination';

const dailySchema = z.object({
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
});
type Cursor = z.infer<typeof orderListSchema>['next'];

export function Business({ brands }: { brands: Brand[] }) {
  const confirm = useConfirmation();
  const [filters, setFilters] = useState({
    from: today().slice(0, 7) + '-01',
    to: today(),
    brandId: '',
  });
  const [days, setDays] = useState<z.infer<typeof dailySchema>['days']>([]);
  const daily = useCursor<NonNullable<z.infer<typeof dailySchema>['next']>>(
    JSON.stringify(filters),
  );
  const [dailyNext, setDailyNext] =
    useState<z.infer<typeof dailySchema>['next']>(null);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [items, setItems] = useState<Order[]>([]);
  const [next, setNext] = useState<Cursor>(null);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [previous, setPrevious] = useState<Cursor[]>([]);
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [adBrand, setAdBrand] = useState('');
  const [adDate, setAdDate] = useState(today());
  const [adAmount, setAdAmount] = useState('');
  const [message, setMessage] = useState('');
  const editDialog = useRef<HTMLDialogElement>(null);
  const adsForm = useRef<HTMLFormElement>(null);
  const name = (id: string) =>
    brands.find((brand) => brand.id === id)?.name ?? 'Brand';
  function refresh() {
    setDailyLoading(true);
    setRevision((value) => value + 1);
    setCursor(null);
    setPrevious([]);
  }
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ from: filters.from, to: filters.to });
    if (filters.brandId) query.set('brandId', filters.brandId);
    if (daily.cursor) {
      query.set('before', daily.cursor.before);
      query.set('beforeBrand', daily.cursor.beforeBrand);
    }
    api('/manage/business/daily?' + query.toString(), dailySchema, {
      signal: controller.signal,
    })
      .then((data) => {
        setDays(data.days);
        setDailyNext(data.next);
        setDailyLoading(false);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(ErrorMessage(reason));
          setDailyLoading(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, [filters, revision, daily.cursor]);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      basis: 'order',
    });
    if (filters.brandId) query.set('brandId', filters.brandId);
    if (search) query.set('q', search);
    if (cursor) {
      query.set('before', cursor.before);
      query.set('beforeId', cursor.beforeId);
    }
    api('/manage/business/orders?' + query.toString(), orderListSchema, {
      signal: controller.signal,
    })
      .then((data) => {
        setItems(data.items);
        setNext(data.next);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [filters, search, cursor, revision]);
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
  async function removeDay(day: z.infer<typeof dailySchema>['days'][number]) {
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
        <form
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
            setLoading(true);
            setFilters({ from, to, brandId: formText(form, 'brandId') });
            setDailyLoading(true);
            setCursor(null);
            setPrevious([]);
          }}
        >
          <Field label="Summary brand">
            <select name="brandId">
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
        <div className="table-scroll">
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
            <tbody>
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
                        className="text-button danger-text"
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
            </tbody>
          </table>
        </div>
        <Pagination
          label="days"
          page={daily.page}
          hasPrevious={daily.hasPrevious}
          hasNext={dailyNext !== null}
          pending={dailyLoading}
          onPrevious={() => {
            setDailyLoading(true);
            daily.back();
          }}
          onNext={() => {
            if (dailyNext) {
              setDailyLoading(true);
              daily.setCursor(dailyNext);
            }
          }}
        />
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
              20 orders per page. Search an exact Order ID across all dates
              within the selected brand.
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
            if (value === search && cursor === null) return;
            setLoading(true);
            setSearch(value);
            setCursor(null);
            setPrevious([]);
          }}
        >
          <Field label="Find Order ID">
            <input
              name="q"
              type="search"
              maxLength={100}
              placeholder="Exact Order ID"
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
              setCursor(null);
              setPrevious([]);
            }}
          >
            Clear search
          </button>
        </form>
        {loading ? (
          <SkeletonTable rows={4} columns={8} />
        ) : (
          <div className="table-scroll">
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
              <tbody>
                {items.map((item) => (
                  <OrderRow
                    key={item.id + ':' + String(item.revision)}
                    item={item}
                    brands={brands}
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
              </tbody>
            </table>
          </div>
        )}
        <p className="caption">
          Edit Brand or Sales amount in the row, then save changes. Blank sales
          uses COD. Product cost uses delivered item quantity and the saved
          making cost; “Edit order” manages quantities and cost corrections.
        </p>
        <div className="pagination-actions">
          <button
            className="secondary"
            disabled={loading || !previous.length}
            onClick={() => {
              setLoading(true);
              setCursor(previous.at(-1) ?? null);
              setPrevious((values) => values.slice(0, -1));
            }}
          >
            Previous orders
          </button>
          <span>Page {previous.length + 1} · 20 orders per page</span>
          <button
            className="secondary"
            disabled={loading || !next}
            onClick={() => {
              if (!next) return;
              setLoading(true);
              setPrevious((values) => [...values, cursor]);
              setCursor(next);
            }}
          >
            Next orders
          </button>
        </div>
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
                  salesOverride: amount('salesOverride'),
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
              <Field label="Actual sales amount (blank uses COD)">
                <input
                  name="salesOverride"
                  inputMode="decimal"
                  defaultValue={amountInput(editing.salesOverride)}
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
