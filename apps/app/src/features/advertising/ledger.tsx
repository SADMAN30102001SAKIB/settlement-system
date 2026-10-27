import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { api, adDetailSchema, okSchema } from '../../lib/api';
import type { Brand, Settings } from '../../lib/api';
import {
  Alert,
  ErrorMessage,
  Field,
  SkeletonTable,
  Spinner,
} from '../../components/ui';
import { useConfirmation } from '../../components/confirmation-context';
import { dateLabel, money, formText } from '../../lib/format';
import { paymentStatus } from '@settlement/domain/payments';
import { Invoice } from '../settlements/invoice';
import { PaymentsPanel } from '../payments/panel';

const cursorSchema = z.object({ before: z.string(), beforeId: z.string() });
const ledgerSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      brandId: z.string(),
      brandName: z.string(),
      invoiceNumber: z.string(),
      date: z.string(),
      period: z.string(),
      total: z.number().int(),
      paid: z.number().int(),
      revision: z.number().int(),
    }),
  ),
  next: cursorSchema.nullable(),
});
type Cursor = z.infer<typeof cursorSchema> | null;

export function AdvertisingLedger({
  brands,
  settings,
  navigate,
  version,
  onChanged,
}: {
  brands: Brand[];
  settings: Settings;
  navigate: (path: string) => void;
  version: number;
  onChanged: () => Promise<void>;
}) {
  const confirm = useConfirmation();
  const [filters, setFilters] = useState({
    brandId: '',
    q: '',
    from: '',
    to: '',
  });
  const [cursor, setCursor] = useState<Cursor>(null);
  const [previous, setPrevious] = useState<Cursor[]>([]);
  const [data, setData] = useState<z.infer<typeof ledgerSchema> | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<z.infer<typeof adDetailSchema> | null>(
    null,
  );
  const [mode, setMode] = useState<'view' | 'pdf' | 'payment'>('view');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value) query.set(key, value);
    if (cursor) {
      query.set('before', cursor.before);
      query.set('beforeId', cursor.beforeId);
    }
    api(`/manage/advertising?${query.toString()}`, ledgerSchema, {
      signal: controller.signal,
    })
      .then(setData)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [filters, cursor, version]);
  useEffect(() => {
    if (detail) dialog.current?.showModal();
    else dialog.current?.close();
  }, [detail]);
  async function open(id: string, action: typeof mode) {
    setPending(true);
    setError('');
    try {
      const result = await api(`/manage/advertising/${id}`, adDetailSchema);
      setMode(action);
      setDetail(result);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  async function remove(item: z.infer<typeof ledgerSchema>['items'][number]) {
    if (
      !(await confirm({
        title: 'Delete advertising invoice?',
        message: `Delete ${item.invoiceNumber} for ${item.brandName} and its direct payments? Brand account payments will be reallocated to remaining invoices.`,
        action: 'Delete invoice',
        destructive: true,
      }))
    )
      return;
    setPending(true);
    setError('');
    try {
      await api(`/manage/advertising/${item.id}`, okSchema, {
        method: 'DELETE',
        body: { revision: item.revision },
      });
      setDetail(null);
      await onChanged();
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="panel advertising-ledger"
      aria-label="Advertising invoice ledger"
    >
      <div className="section-heading">
        <div>
          <h2>Invoice ledger</h2>
          <p className="muted">
            All brands by default. View, edit, pay, download or delete without
            opening a separate invoice page.
          </p>
        </div>
      </div>
      <form
        className="form-grid ledger-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          setError('');
          setLoading(true);
          setCursor(null);
          setPrevious([]);
          setFilters({
            brandId: formText(form, 'brandId'),
            q: formText(form, 'q'),
            from: formText(form, 'from'),
            to: formText(form, 'to'),
          });
        }}
      >
        <Field label="Invoice brand">
          <select name="brandId">
            <option value="">All brands</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search invoices">
          <input
            name="q"
            type="search"
            maxLength={120}
            placeholder="Invoice or period"
          />
        </Field>
        <Field label="Invoice date from">
          <input name="from" type="date" />
        </Field>
        <Field label="Invoice date to">
          <input name="to" type="date" />
        </Field>
        <button className="secondary form-submit" disabled={loading}>
          Apply invoice filters
        </button>
      </form>
      {error ? <Alert>{error}</Alert> : null}
      {loading ? (
        <SkeletonTable rows={3} columns={7} />
      ) : (
        <div className="table-scroll">
          <table className="invoice-ledger-table">
            <thead>
              <tr>
                {[
                  'Invoice / date',
                  'Brand',
                  'Period',
                  'Total incl. VAT',
                  'Paid',
                  'Status',
                  'Actions',
                ].map((label) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data?.items.map((item) => (
                <tr key={item.id}>
                  <td data-label="Invoice / date" className="ledger-identity">
                    <strong>{item.invoiceNumber}</strong>
                    <small>{dateLabel(item.date)}</small>
                  </td>
                  <td data-label="Brand" className="ledger-brand">
                    {item.brandName}
                  </td>
                  <td data-label="Period" className="ledger-period">
                    {item.period}
                  </td>
                  <td data-label="Total incl. VAT" className="numeric">
                    {money(item.total)}
                  </td>
                  <td data-label="Paid" className="numeric">
                    {money(item.paid)}
                  </td>
                  <td data-label="Status">
                    <span className="invoice-status">
                      {paymentStatus(item.total, item.paid).status}
                    </span>
                  </td>
                  <td data-label="Actions" className="ledger-actions">
                    <div className="invoice-row-actions">
                      {(
                        ['View', 'Edit', 'Payment', 'PDF', 'Delete'] as const
                      ).map((action) => (
                        <button
                          key={action}
                          className={`secondary compact ${action === 'Delete' ? 'danger-text' : ''}`}
                          disabled={pending}
                          onClick={() => {
                            if (action === 'Edit') {
                              navigate(`/advertising/${item.id}/edit`);
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
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {!data?.items.length ? (
                <tr>
                  <td colSpan={7}>No invoices match these filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      {pending ? (
        <p role="status">
          <Spinner size={12} /> Updating invoice…
        </p>
      ) : null}
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
          Previous invoices
        </button>
        <span>Page {previous.length + 1} · 20 invoices per page</span>
        <button
          className="secondary"
          disabled={loading || !data?.next}
          onClick={() => {
            if (!data?.next) return;
            setLoading(true);
            setPrevious((values) => [...values, cursor]);
            setCursor(data.next);
          }}
        >
          Next invoices
        </button>
      </div>
      <dialog
        ref={dialog}
        className="business-dialog invoice-dialog"
        onCancel={() => {
          setDetail(null);
        }}
      >
        <header className="business-dialog-heading">
          <h2>
            {mode === 'payment' ? 'Record invoice payment' : 'Invoice preview'}
          </h2>
          <button
            className="secondary compact"
            onClick={() => {
              setDetail(null);
            }}
          >
            Close
          </button>
        </header>
        {detail ? (
          <div className="invoice-dialog-body">
            {mode === 'payment' ? (
              <PaymentsPanel
                key={detail.item.id}
                brandName={detail.item.brandName}
                target={{ kind: 'ads', targetId: detail.item.id }}
                total={detail.item.total}
                paid={detail.item.paid}
                payments={detail.payments}
                refresh={async () => {
                  setDetail(
                    await api(
                      `/manage/advertising/${detail.item.id}`,
                      adDetailSchema,
                    ),
                  );
                  await onChanged();
                }}
              />
            ) : (
              <Invoice
                key={detail.item.id}
                autoDownload={mode === 'pdf'}
                report={detail.item}
                settings={settings}
                onBack={() => {
                  setDetail(null);
                }}
                onEdit={() => {
                  navigate(`/advertising/${detail.item.id}/edit`);
                }}
                onDelete={() => {
                  remove({ ...detail.item }).catch((reason: unknown) => {
                    setError(ErrorMessage(reason));
                  });
                }}
              />
            )}
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
