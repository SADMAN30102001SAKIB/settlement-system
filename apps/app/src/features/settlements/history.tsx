import { useEffect, useState } from 'react';
import { paymentStatus } from '@settlement/domain/payments';

import {
  Alert,
  Empty,
  ErrorMessage,
  Field,
  Metric,
  PageHeading,
  Skeleton,
  SkeletonMetrics,
  SkeletonTable,
  Spinner,
} from '../../components/ui';
import { api, reportListSchema } from '../../lib/api';
import type { Brand, ReportRow } from '../../lib/api';
import { dateLabel, money, today } from '../../lib/format';

export function History({
  brands,
  onNew,
  onView,
}: {
  brands: Brand[];
  onNew: () => void;
  onView: (id: string) => void;
}) {
  const now = today();
  const [from, setFrom] = useState(`${now.slice(0, 7)}-01`);
  const [to, setTo] = useState(now);
  const [brand, setBrand] = useState('');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ from, to, brand, query });
  const [items, setItems] = useState<ReportRow[]>([]);
  const [totals, setTotals] = useState({
    count: 0,
    net: 0,
    commission: 0,
    paid: 0,
    deliveredQty: 0,
    deliveredAmount: 0,
    cancelledQty: 0,
    cancelledAmount: 0,
    partialQty: 0,
    partialAmount: 0,
    pendingQty: 0,
    shipping: 0,
    codCharge: 0,
    ads: 0,
    productCost: 0,
  });
  const [next, setNext] = useState<{ before: string; beforeId: string } | null>(
    null,
  );
  const [cursor, setCursor] = useState<{
    before: string;
    beforeId: string;
  } | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.brand) params.set('brandId', filters.brand);
    if (filters.query) params.set('q', filters.query);
    if (cursor) {
      params.set('before', cursor.before);
      params.set('beforeId', cursor.beforeId);
    }
    api(`/manage/settlements?${params.toString()}`, reportListSchema, {
      signal: controller.signal,
    })
      .then((data) => {
        setTotals(data.summary);
        setItems((current) =>
          cursor ? [...current, ...data.items] : data.items,
        );
        setNext(data.next);
        setError('');
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
  }, [filters, cursor]);
  return (
    <>
      <PageHeading
        eyebrow="OPERATIONS / SETTLEMENTS"
        title="The numbers, in focus."
        description="A connected view of your saved settlements and agency earnings."
        action={
          <button className="primary" onClick={onNew}>
            + New settlement
          </button>
        }
      />
      {pending && items.length === 0 ? (
        <SkeletonMetrics count={4} />
      ) : (
        <div className="metrics">
          <Metric
            label="Saved reports"
            value={String(totals.count)}
            detail="Within the selected filters"
          />
          <Metric
            label="Net settlement"
            value={money(totals.net)}
            detail="All reports matching your filters"
          />
          <Metric
            label="Agency earnings"
            value={money(totals.commission)}
            detail="Saved report percentages"
          />
          <Metric
            label="Payments received"
            value={money(totals.paid)}
            detail="Against matching settlements"
          />
        </div>
      )}
      <section className="panel report-totals" aria-label="Settlement totals">
        <h2>Delivery & cost totals</h2>
        <dl className="summary-grid">
          {[
            ['Delivered parcels', String(totals.deliveredQty)],
            ['Delivered amount', money(totals.deliveredAmount)],
            ['Cancelled parcels', String(totals.cancelledQty)],
            ['Cancelled amount (legacy)', money(totals.cancelledAmount)],
            ['Partial parcels', String(totals.partialQty)],
            ['Partial amount', money(totals.partialAmount)],
            ['Pending parcels', String(totals.pendingQty)],
            ['Delivery charges deducted', money(totals.shipping)],
            ['COD deducted', money(totals.codCharge)],
            ['Advertising incl. applicable VAT', money(totals.ads)],
            ['Product cost', money(totals.productCost)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {pending && items.length === 0 ? (
                  <Skeleton width={110} height={20} radius={4} />
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Settlement ledger</h2>
            <p className="muted">Every report. One clear trail.</p>
          </div>
          <span className="pill">BDT · ৳</span>
        </div>
        <form
          className="filters"
          onSubmit={(event) => {
            event.preventDefault();
            if (from && to && from > to) {
              setError('The end date cannot be before the start date.');
              return;
            }
            setItems([]);
            setNext(null);
            setCursor(null);
            setPending(true);
            setError('');
            setFilters({ from, to, brand, query });
          }}
        >
          <Field label="From">
            <input
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
              }}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
              }}
            />
          </Field>
          <Field label="Brand">
            <select
              value={brand}
              onChange={(event) => {
                setBrand(event.target.value);
              }}
            >
              <option value="">All brands</option>
              {brands.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Search invoice">
            <input
              type="search"
              placeholder="Invoice number"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </Field>
          <button className="secondary compact" disabled={pending}>
            {pending ? (
              <>
                <Spinner size={12} /> Loading…
              </>
            ) : (
              'Apply filters'
            )}
          </button>
        </form>
        {error ? <Alert>{error}</Alert> : null}
        {pending && items.length > 0 ? (
          <Skeleton
            className="skeleton-progress-bar"
            height={4}
            radius={2}
            aria-label="Updating settlements…"
          />
        ) : null}
        {pending && items.length === 0 ? (
          <SkeletonTable
            rows={5}
            columns={6}
            headers={[
              'Invoice / Brand',
              'Report date',
              'Net amount',
              'Agency share',
              'Balance',
              'Status',
            ]}
          />
        ) : items.length === 0 ? (
          <Empty title="A clean slate">
            Your saved reports will appear here. Add a brand, then create your
            first settlement.
          </Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Invoice / Brand</th>
                  <th>Report date</th>
                  <th className="numeric">Net amount</th>
                  <th className="numeric">Agency share</th>
                  <th className="numeric">Balance</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const status = paymentStatus(item.commission, item.paid);
                  return (
                    <tr key={item.id}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => {
                            onView(item.id);
                          }}
                        >
                          {item.invoiceNumber}
                        </button>
                        <small className="muted">{item.brandName}</small>
                      </td>
                      <td>
                        {dateLabel(item.date)}
                        <small className="muted">{item.period}</small>
                      </td>
                      <td className="numeric">{money(item.net)}</td>
                      <td className="numeric emphasis">
                        {money(item.commission)}
                      </td>
                      <td className="numeric">
                        {money(Math.abs(status.balance))}
                        {status.balance < 0 ? <small>Advance</small> : null}
                      </td>
                      <td>
                        <span
                          className={`status status-${status.status.toLowerCase().replace('/', '')}`}
                        >
                          {status.status}
                        </span>
                      </td>
                      <td>
                        <button
                          className="secondary compact"
                          onClick={() => {
                            onView(item.id);
                          }}
                        >
                          Open <span aria-hidden="true">↗</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {next ? (
          <div className="load-more">
            <button
              className="secondary"
              disabled={pending}
              onClick={() => {
                setCursor(next);
                setPending(true);
              }}
            >
              {pending ? (
                <>
                  <Spinner size={12} /> Loading…
                </>
              ) : (
                'Load 50 more reports'
              )}
            </button>
          </div>
        ) : null}
      </section>
    </>
  );
}
