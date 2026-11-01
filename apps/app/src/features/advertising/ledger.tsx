import { useState } from 'react';
import { ScrollList, VirtualBody } from '../../components/scroll-list';
import { useInfiniteQuery } from '../../lib/infinite-query';
import { StatusSelect } from '../../components/status-select';
import { invoiceStatusSchema } from '../../../shared/invoice-status';
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
import { confirmInvoiceDeletion } from '../settlements/delete-invoice';
import {
  InvoiceActionDialog,
  InvoiceRowActions,
} from '../settlements/ledger-actions';

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
      statusOverride: invoiceStatusSchema.nullable(),
      paid: z.number().int(),
      revision: z.number().int(),
    }),
  ),
  next: cursorSchema.nullable(),
});

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
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value) params.set(key, value);
  const list = useInfiniteQuery(
    `/manage/advertising?${params.toString()}`,
    ledgerSchema,
    version,
  );
  const data = { items: list.items };
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const loading = list.loading;
  const [detail, setDetail] = useState<z.infer<typeof adDetailSchema> | null>(
    null,
  );
  const [mode, setMode] = useState<'view' | 'pdf' | 'payment'>('view');
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
    if (!(await confirmInvoiceDeletion('advertising', item, confirm, navigate)))
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
      {loading && !list.items.length ? (
        <SkeletonTable rows={3} columns={7} />
      ) : (
        <ScrollList
          {...list.scrollProps}
          count={list.items.length}
          className="table-scroll"
          label="Advertising invoices"
        >
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
            <VirtualBody columns={7}>
              {data.items.map((item) => (
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
                    <StatusSelect
                      kind="ads"
                      id={item.id}
                      label={`Status for ${item.invoiceNumber}`}
                      value={
                        item.statusOverride ??
                        paymentStatus(item.total, item.paid).status
                      }
                      manual={item.statusOverride !== null}
                      onSaved={(value) => {
                        list.setItems((rows) =>
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
                      pending={pending}
                      onAction={(action) => {
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
                    />
                  </td>
                </tr>
              ))}
              {!data.items.length ? (
                <tr>
                  <td colSpan={7}>No invoices match these filters.</td>
                </tr>
              ) : null}
            </VirtualBody>
          </table>
        </ScrollList>
      )}
      {pending ? (
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
          if (detail) navigate(`/advertising/${detail.item.id}/edit`);
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
            await api(`/manage/advertising/${detail.item.id}`, adDetailSchema),
          );
          await onChanged();
        }}
      />
    </section>
  );
}
