import { useCallback, useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';
import type { z } from 'zod';
import { parseMoney } from '@settlement/domain/money';
import {
  Alert,
  ErrorMessage,
  Field,
  Metric,
  PageHeading,
} from '../../components/ui';
import { api, okSchema } from '../../lib/api';
import type { Brand, Settings } from '../../lib/api';
import { amountInput, formText, money, today } from '../../lib/format';
import { businessReportSchema, orderListSchema } from './contracts';
import type { Order } from './contracts';
import { Importer } from './importer';

export function Business({
  brands,
  settings,
}: {
  brands: Brand[];
  settings: Settings;
}) {
  const now = today();
  const [from, setFrom] = useState(`${now.slice(0, 7)}-01`),
    [to, setTo] = useState(now),
    [brandId, setBrandId] = useState('');
  const [basis, setBasis] = useState('order');
  const [filters, setFilters] = useState({ from, to, brandId, basis });
  const [report, setReport] = useState<z.infer<
    typeof businessReportSchema
  > | null>(null);
  const [items, setItems] = useState<Order[]>([]);
  const [next, setNext] =
    useState<z.infer<typeof orderListSchema>['next']>(null);
  const [editing, setEditing] = useState<Order | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adsDraft, setAdsDraft] = useState({
    brandId: '',
    date: today(),
    amount: '',
  });
  const params = useCallback(() => {
    const value = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      basis: filters.basis,
      agencyBasisPoints: String(settings.agencyBasisPoints),
    });
    if (filters.brandId) value.set('brandId', filters.brandId);
    return value;
  }, [filters, settings.agencyBasisPoints]);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const query = params().toString();
      return Promise.all([
        api(
          `/manage/business/report?${query}`,
          businessReportSchema,
          signal === undefined ? undefined : { signal },
        ),
        api(
          `/manage/business/orders?${query}`,
          orderListSchema,
          signal === undefined ? undefined : { signal },
        ),
      ]);
    },
    [params],
  );
  const apply = useCallback(
    ([summary, orders]: Awaited<ReturnType<typeof load>>) => {
      setReport(summary);
      setItems(orders.items);
      setNext(orders.next);
      setLoading(false);
      setError('');
    },
    [],
  );
  const refresh = useCallback(async () => {
    apply(await load());
  }, [apply, load]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then(apply)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(ErrorMessage(reason));
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, [load, apply]);
  async function mutate(path: string, body: unknown, method = 'POST') {
    setPending(true);
    setError('');
    try {
      await api(`/manage/business${path}`, okSchema, { method, body });
      await refresh();
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  async function saveOrder(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing === null) return;
    const form = new FormData(event.currentTarget);
    const nullableMoney = (key: string) =>
      formText(form, key).trim() === ''
        ? null
        : parseMoney(formText(form, key));
    setPending(true);
    setError('');
    try {
      await api(
        `/manage/business/orders/${encodeURIComponent(editing.id)}`,
        okSchema,
        {
          method: 'PUT',
          body: {
            revision: editing.revision,
            quantity: Number(formText(form, 'quantity')),
            partialQuantity:
              formText(form, 'partialQuantity') === ''
                ? null
                : Number(formText(form, 'partialQuantity')),
            salesOverride: nullableMoney('salesOverride'),
            costPerPiece: nullableMoney('costPerPiece'),
          },
        },
      );
      setEditing(null);
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
        eyebrow="OPERATIONS / BUSINESS TRACKING"
        title="Understand every order’s outcome"
        description="Order-date profitability and delivery-date reporting, with permanent making-cost snapshots and exact daily advertising allocation."
      />
      <form
        className="panel filters"
        onSubmit={(event) => {
          event.preventDefault();
          if (!from || !to || from > to) {
            setError('Choose a valid date range.');
            return;
          }
          setLoading(true);
          setReport(null);
          setItems([]);
          setNext(null);
          setFilters({ from, to, brandId, basis });
        }}
      >
        <Field label="From">
          <input
            type="date"
            required
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            required
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </Field>
        <Field label="Brand">
          <select
            value={brandId}
            onChange={(event) => {
              setBrandId(event.target.value);
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
        <Field label="Report basis">
          <select
            value={basis}
            onChange={(event) => {
              setBasis(event.target.value);
            }}
          >
            <option value="order">Order date (profitability)</option>
            <option value="delivery">Delivery date (courier outcomes)</option>
          </select>
        </Field>
        <button className="secondary" disabled={loading}>
          Apply filters
        </button>
      </form>
      {error ? <Alert>{error}</Alert> : null}
      {loading ? <p role="status">Loading business data…</p> : null}
      {report ? (
        <>
          <div className="metrics">
            <Metric
              label="Orders"
              value={String(report.totals.count)}
              detail={`${String(report.totals.delivered)} delivered · ${String(report.totals.cancelled)} cancelled · ${String(report.totals.partial)} partial · ${String(report.totals.pending)} pending`}
            />
            <Metric
              label="Eligible revenue"
              value={money(report.totals.revenue)}
            />
            <Metric
              label="Net profit / loss"
              value={money(report.totals.net)}
            />
            <Metric
              label={`Agency share · ${String(settings.agencyBasisPoints / 100)}%`}
              value={money(report.totals.commission)}
              detail="Floored at zero on a loss"
            />
          </div>
          {report.totals.missingCosts > 0 ? (
            <Alert>
              {report.totals.missingCosts} finalized orders have missing making
              costs or partial quantities. Profit is provisional until you
              correct them.
            </Alert>
          ) : null}
          <section className="panel">
            <h2>Cost breakdown</h2>
            <div className="metrics">
              <Metric
                label="Allocated advertising"
                value={money(report.totals.ads)}
              />
              <Metric
                label="Making costs"
                value={money(report.totals.productCost)}
              />
              <Metric
                label="Shipping / COD charges"
                value={money(report.totals.shipping + report.totals.codCharge)}
              />
              <Metric
                label="Other expenses"
                value={money(report.totals.otherExpenses)}
                detail="Workspace expenses for this date range, not brand-specific"
              />
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Orders</th>
                    <th>Delivered / cancelled / partial / pending</th>
                    <th>Revenue</th>
                    <th>Ads</th>
                    <th>Product</th>
                    <th>Shipping</th>
                    <th>COD fee</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((day) => (
                    <tr key={day.date}>
                      <td>{day.date}</td>
                      <td>{day.count}</td>
                      <td>
                        {day.delivered} / {day.cancelled} / {day.partial} /{' '}
                        {day.pending}
                      </td>
                      <td>{money(day.revenue)}</td>
                      <td>{money(day.ads)}</td>
                      <td>{money(day.productCost)}</td>
                      <td>{money(day.shipping)}</td>
                      <td>{money(day.codCharge)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
      <section className="panel">
        <h2>Orders</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Status</th>
                <th>Delivery date</th>
                <th>COD</th>
                <th>Shipping / COD fee</th>
                <th>Ads</th>
                <th>Qty / partial</th>
                <th>Making cost / piece</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.id}
                    <small>{item.orderDate}</small>
                  </td>
                  <td>{item.status}</td>
                  <td>{item.deliveryDate ?? '—'}</td>
                  <td>
                    {money(item.codAmount)}
                    {item.salesOverride !== null ? (
                      <small>Sales override: {money(item.salesOverride)}</small>
                    ) : null}
                  </td>
                  <td>
                    {money(item.shipping)} / {money(item.codCharge)}
                  </td>
                  <td>{money(item.ads)}</td>
                  <td>
                    {item.quantity} / {item.partialQuantity ?? '—'}
                  </td>
                  <td>
                    {item.costPerPiece === null
                      ? 'Missing'
                      : money(item.costPerPiece)}
                  </td>
                  <td>
                    <button
                      className="secondary compact"
                      onClick={() => {
                        setEditing(item);
                      }}
                    >
                      Edit costs / quantities
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {next ? (
          <button
            className="secondary"
            disabled={pending}
            onClick={() => {
              const query = params();
              query.set('before', next.before);
              query.set('beforeId', next.beforeId);
              setPending(true);
              api(
                `/manage/business/orders?${query.toString()}`,
                orderListSchema,
              )
                .then((data) => {
                  setItems((current) => [...current, ...data.items]);
                  setNext(data.next);
                })
                .catch((reason: unknown) => {
                  setError(ErrorMessage(reason));
                })
                .finally(() => {
                  setPending(false);
                });
            }}
          >
            Load 100 more orders
          </button>
        ) : null}
      </section>
      {editing ? (
        <section className="panel">
          <h2>Edit order {editing.id}</h2>
          <form
            key={`${editing.id}-${String(editing.revision)}`}
            onSubmit={(event) => {
              saveOrder(event).catch((reason: unknown) => {
                setError(ErrorMessage(reason));
              });
            }}
          >
            <div className="form-grid">
              <Field label="Ordered quantity">
                <input
                  name="quantity"
                  type="number"
                  min={1}
                  step={1}
                  required
                  defaultValue={editing.quantity}
                />
              </Field>
              <Field label="Partial delivered quantity">
                <input
                  name="partialQuantity"
                  type="number"
                  min={0}
                  max={editing.quantity}
                  step={1}
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
              <Field label="Making cost per piece (৳)">
                <input
                  name="costPerPiece"
                  inputMode="decimal"
                  defaultValue={amountInput(editing.costPerPiece)}
                />
              </Field>
            </div>
            <div className="actions">
              <button className="primary" disabled={pending}>
                Save order
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setEditing(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}
      <div className="split-layout">
        <section className="panel">
          <h2>Daily advertising allocation</h2>
          <p className="muted">
            Stored once per brand/day and reallocated across all unique orders,
            including pending and cancelled. A later import re-splits the same
            total, never adds it again.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              try {
                mutate(
                  '/ads',
                  {
                    brandId: formText(form, 'brandId'),
                    date: formText(form, 'date'),
                    amount: parseMoney(formText(form, 'amount')),
                  },
                  'PUT',
                ).catch((reason: unknown) => {
                  setError(ErrorMessage(reason));
                });
              } catch (reason) {
                setError(ErrorMessage(reason));
              }
            }}
          >
            <Field label="Brand">
              <select
                name="brandId"
                required
                value={adsDraft.brandId}
                onChange={(event) => {
                  setAdsDraft((current) => ({
                    ...current,
                    brandId: event.target.value,
                  }));
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
            <div className="form-grid">
              <Field label="Order date">
                <input
                  name="date"
                  type="date"
                  value={adsDraft.date}
                  onChange={(event) => {
                    setAdsDraft((current) => ({
                      ...current,
                      date: event.target.value,
                    }));
                  }}
                  required
                />
              </Field>
              <Field label="Total ads spend (৳)">
                <input
                  name="amount"
                  required
                  inputMode="decimal"
                  value={adsDraft.amount}
                  onChange={(event) => {
                    setAdsDraft((current) => ({
                      ...current,
                      amount: event.target.value,
                    }));
                  }}
                />
              </Field>
            </div>
            <button className="primary" disabled={pending}>
              Save / replace daily spend
            </button>
          </form>
          <p className="muted">
            Saved budgets below use order dates, regardless of the reporting
            basis above. A budget without imported orders stays saved until
            those orders arrive.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Brand</th>
                  <th>Saved spend</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {report?.advertising.map((item) => (
                  <tr key={`${item.brandId}-${item.date}`}>
                    <td>{item.date}</td>
                    <td>
                      {brands.find((brand) => brand.id === item.brandId)
                        ?.name ?? 'Brand'}
                    </td>
                    <td>{money(item.amount)}</td>
                    <td>
                      <button
                        className="secondary compact"
                        onClick={() => {
                          setAdsDraft({
                            brandId: item.brandId,
                            date: item.date,
                            amount: amountInput(item.amount),
                          });
                        }}
                      >
                        Edit spend
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <h2>Other expenses</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              try {
                mutate('/expenses', {
                  date: formText(form, 'date'),
                  amount: parseMoney(formText(form, 'amount')),
                  description: formText(form, 'description'),
                }).catch((reason: unknown) => {
                  setError(ErrorMessage(reason));
                });
              } catch (reason) {
                setError(ErrorMessage(reason));
              }
            }}
          >
            <div className="form-grid">
              <Field label="Date">
                <input
                  name="date"
                  type="date"
                  required
                  defaultValue={today()}
                />
              </Field>
              <Field label="Amount (৳)">
                <input name="amount" required inputMode="decimal" />
              </Field>
            </div>
            <Field label="Description">
              <input name="description" required maxLength={200} />
            </Field>
            <button className="primary" disabled={pending}>
              Add expense
            </button>
          </form>
          {report?.expenses.map((expense) => (
            <div className="payment-row" key={expense.id}>
              <span>
                {expense.date} · {expense.description} · {money(expense.amount)}
              </span>
              <button
                className="text-button danger-text"
                disabled={pending}
                onClick={() => {
                  if (window.confirm('Delete this expense?'))
                    mutate(`/expenses/${expense.id}`, {}, 'DELETE').catch(
                      (reason: unknown) => {
                        setError(ErrorMessage(reason));
                      },
                    );
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </section>
      </div>
      <Importer
        brands={brands}
        onImported={() => {
          refresh().catch((reason: unknown) => {
            setError(ErrorMessage(reason));
          });
        }}
      />
      <section className="panel">
        <h2>Remove an imported day</h2>
        <p className="muted">
          Only the selected brand/day’s orders and saved daily advertising spend
          are removed.
        </p>
        <form
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            if (
              window.confirm(
                'Permanently remove these orders and their daily advertising allocation?',
              )
            )
              mutate(
                '/day',
                {
                  brandId: formText(form, 'brandId'),
                  date: formText(form, 'date'),
                },
                'DELETE',
              ).catch((reason: unknown) => {
                setError(ErrorMessage(reason));
              });
          }}
        >
          <Field label="Brand">
            <select name="brandId" required>
              <option value="">Choose brand</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Order date">
            <input name="date" required type="date" />
          </Field>
          <button className="secondary danger-text" disabled={pending}>
            Delete day
          </button>
        </form>
      </section>
    </>
  );
}
