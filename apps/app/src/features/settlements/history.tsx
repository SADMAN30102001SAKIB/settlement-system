import { useState } from 'react';
import { useSavedFilters } from '../../lib/saved-filters';
import { DateShortcuts } from '../../components/date-shortcuts';
import { StatusSelect } from '../../components/status-select';
import type { z } from 'zod';
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
import {
  api,
  reportListSchema,
  reportDetailSchema,
  okSchema,
} from '../../lib/api';
import type { Brand, ReportRow, Settings } from '../../lib/api';
import { dateLabel, money, today } from '../../lib/format';
import { useConfirmation } from '../../components/confirmation-context';
import { InvoiceActionDialog, InvoiceRowActions } from './ledger-actions';
import { confirmInvoiceDeletion } from './delete-invoice';
import { ScrollList, VirtualBody } from '../../components/scroll-list';
import { useInfiniteQuery } from '../../lib/infinite-query';

export function History({
  brands,
  onNew,
  onView,
  settings,
  navigate,
}: {
  brands: Brand[];
  onNew: () => void;
  onView: (id: string) => void;
  settings: Settings;
  navigate: (path: string) => void;
}) {
  const confirm = useConfirmation();
  const [detail, setDetail] = useState<z.infer<
    typeof reportDetailSchema
  > | null>(null);
  const [mode, setMode] = useState<'view' | 'pdf' | 'payment'>('view');
  const [actionPending, setActionPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const now = today();
  const [filters, setFilters] = useSavedFilters('settlements', {
    from: `${now.slice(0, 7)}-01`,
    to: now,
    brand: '',
    query: '',
  });
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [brand, setBrand] = useState(filters.brand);
  const [query, setQuery] = useState(filters.query);
  const params = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    brandId: filters.brand,
    q: filters.query,
  });
  for (const [key, value] of [...params.entries()])
    if (!value) params.delete(key);
  const list = useInfiniteQuery(
    `/manage/settlements?${params.toString()}`,
    reportListSchema,
    revision,
  );
  const { items, setItems, loading: pending } = list;
  const totals = list.data?.summary ?? {
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
  };
  const [error, setError] = useState('');
  function refresh() {
    setRevision((value) => value + 1);
  }
  async function open(id: string, action: typeof mode) {
    setActionPending(true);
    setError('');
    try {
      const result = await api(`/manage/settlements/${id}`, reportDetailSchema);
      setMode(action);
      setDetail(result);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setActionPending(false);
    }
  }
  async function remove(item: ReportRow) {
    if (!(await confirmInvoiceDeletion('settlements', item, confirm, navigate)))
      return;
    setActionPending(true);
    setError('');
    try {
      await api(`/manage/settlements/${item.id}`, okSchema, {
        method: 'DELETE',
        body: { revision: item.revision },
      });
      setDetail(null);
      refresh();
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setActionPending(false);
    }
  }
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
      <section
        className="panel settlement-ledger"
        aria-label="Settlement invoice ledger"
      >
        <div className="section-heading">
          <div>
            <h2>Settlement ledger</h2>
            <p className="muted">Every report. One clear trail.</p>
          </div>
          <span className="pill">BDT · ৳</span>
        </div>
        <DateShortcuts
          onSelect={(from, to) => {
            setFrom(from);
            setTo(to);
            setFilters({ from, to, brand, query });
          }}
        />
        <form
          className="filters form-grid ledger-filters"
          onSubmit={(event) => {
            event.preventDefault();
            if (from && to && from > to) {
              setError('The end date cannot be before the start date.');
              return;
            }
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
          <button className="secondary compact form-submit" disabled={pending}>
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
          <ScrollList
            {...list.scrollProps}
            count={items.length}
            className="table-scroll"
            label="Settlement invoices"
          >
            <table className="invoice-ledger-table">
              <thead>
                <tr>
                  <th>Invoice / Brand</th>
                  <th>Report date</th>
                  <th className="numeric">Net amount</th>
                  <th className="numeric">Agency share</th>
                  <th className="numeric">Balance</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <VirtualBody columns={7}>
                {items.map((item) => {
                  const status = paymentStatus(item.commission, item.paid);
                  return (
                    <tr key={item.id}>
                      <td
                        data-label="Invoice / Brand"
                        className="ledger-identity"
                      >
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
                      <td data-label="Report date" className="ledger-period">
                        {dateLabel(item.date)}
                        <small className="muted">{item.period}</small>
                      </td>
                      <td data-label="Net amount" className="numeric">
                        {money(item.net)}
                      </td>
                      <td
                        data-label="Agency share"
                        className="numeric emphasis"
                      >
                        {money(item.commission)}
                      </td>
                      <td data-label="Balance" className="numeric">
                        {money(Math.abs(status.balance))}
                        {status.balance < 0 ? <small>Advance</small> : null}
                      </td>
                      <td data-label="Status">
                        <StatusSelect
                          kind="settlement"
                          id={item.id}
                          label={`Status for ${item.invoiceNumber}`}
                          value={item.statusOverride ?? status.status}
                          manual={item.statusOverride !== null}
                          onSaved={(value) => {
                            setItems((rows) =>
                              rows.map((row) =>
                                row.id === item.id
                                  ? { ...row, statusOverride: value }
                                  : row,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td data-label="Actions" className="ledger-actions">
                        <InvoiceRowActions
                          pending={actionPending}
                          onAction={(action) => {
                            if (action === 'Edit') {
                              navigate(`/settlements/${item.id}/edit`);
                              return;
                            }
                            const task =
                              action === 'Delete'
                                ? remove(item)
                                : open(
                                    item.id,
                                    action === 'Payment'
                                      ? 'payment'
                                      : action === 'PDF'
                                        ? 'pdf'
                                        : 'view',
                                  );
                            task.catch((reason: unknown) => {
                              setError(ErrorMessage(reason));
                            });
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </VirtualBody>
            </table>
          </ScrollList>
        )}
        {actionPending ? (
          <p role="status">
            <Spinner size={12} /> Updating invoice…
          </p>
        ) : null}
        <InvoiceActionDialog
          detail={detail}
          mode={mode}
          settings={settings}
          onClose={() => {
            setDetail(null);
          }}
          onEdit={() => {
            if (detail) navigate(`/settlements/${detail.item.id}/edit`);
          }}
          onDelete={() => {
            if (detail)
              remove(detail.item).catch((reason: unknown) => {
                setError(ErrorMessage(reason));
              });
          }}
          refresh={async () => {
            if (!detail) return;
            setDetail(
              await api(
                `/manage/settlements/${detail.item.id}`,
                reportDetailSchema,
              ),
            );
            refresh();
          }}
        />
        {!items.length && list.error ? (
          <Alert>
            {list.error}
            <button
              type="button"
              className="secondary compact"
              onClick={list.retry}
            >
              Retry loading
            </button>
          </Alert>
        ) : null}
      </section>
    </>
  );
}
