import { useState } from 'react';
import {
  invoiceStatusSchema,
  stampStatusSchema,
} from '../../shared/invoice-status';
import type { InvoiceStatus } from '../../shared/invoice-status';
import { api, okSchema } from '../lib/api';
import { ErrorMessage } from './ui';

export function StatusSelect({
  kind,
  id,
  label,
  value,
  manual = false,
  disabled = false,
  onSaved,
}: {
  kind: 'settlement' | 'ads' | 'receipt';
  id: string;
  label: string;
  value: InvoiceStatus;
  manual?: boolean;
  disabled?: boolean;
  onSaved: (status: InvoiceStatus) => void;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  return (
    <div className="status-control">
      <select
        aria-label={label}
        value={value}
        disabled={disabled || pending}
        onChange={(event) => {
          const status = invoiceStatusSchema.parse(event.target.value);
          setPending(true);
          setError('');
          api(
            kind === 'receipt'
              ? `/manage/receipts/${id}/stamp`
              : `/manage/invoice-status/${kind}/${id}`,
            okSchema,
            { method: 'PUT', body: { status } },
          )
            .then(() => {
              onSaved(status);
            })
            .catch((reason: unknown) => {
              setError(ErrorMessage(reason));
            })
            .finally(() => {
              setPending(false);
            });
        }}
      >
        {(kind === 'receipt'
          ? stampStatusSchema.options
          : invoiceStatusSchema.options
        ).map((status) => (
          <option key={status}>{status}</option>
        ))}
      </select>
      {pending ? (
        <small role="status">Saving…</small>
      ) : manual ? (
        <small>Admin selected</small>
      ) : null}
      {error ? (
        <small role="alert" className="danger-text">
          {error}
        </small>
      ) : null}
    </div>
  );
}
