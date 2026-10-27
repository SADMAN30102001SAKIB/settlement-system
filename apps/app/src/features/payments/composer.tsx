import { useRef, useState } from 'react';
import { z } from 'zod';
import { receiptSchema } from '../../../shared/receipts';
import type { PaymentAccount } from '../../../shared/receipts';
import { api } from '../../lib/api';
import {
  amountInput,
  dateLabel,
  formText,
  money,
  today,
} from '../../lib/format';
import { parseMoney, sumMoney } from '@settlement/domain/money';
import { Alert, ErrorMessage, Field, Spinner } from '../../components/ui';
import { ImageUpload } from '../../components/image-upload';
import { useConfirmation } from '../../components/confirmation-context';
import { PaymentDateLedger } from './date-ledger';

export function ReceiptComposer({
  account,
  onSaved,
}: {
  account: PaymentAccount;
  onSaved: (id: string) => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [requestId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState('');
  const [proof, setProof] = useState<string | null>(null);
  const [billDate, setBillDate] = useState('');
  const dateSelect = useRef<HTMLSelectElement>(null);
  const confirm = useConfirmation();
  const outstanding = account.invoices.filter(
    (row) => row.due > 0 && (!billDate || row.date === billDate),
  );
  const billDates = [
    ...new Set(
      account.invoices
        .filter((row) => row.due > 0 || row.date === billDate)
        .map((row) => row.date),
    ),
  ]
    .sort()
    .reverse();
  async function chooseDate(value: string, scroll = false) {
    if (value !== billDate) {
      if (
        Object.values(amounts).some((amount) => amount.trim()) &&
        !(await confirm({
          title: 'Change bills to pay?',
          message:
            'The payment amounts you entered will be cleared so they cannot be applied to a different bill date. Your payment date, method, reference, note and proof will be kept.',
          action: 'Change bill date',
        }))
      )
        return;
      setAmounts({});
      setBillDate(value);
      setError('');
    }
    if (scroll) {
      dateSelect.current?.closest('section')?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      });
      dateSelect.current?.focus({ preventScroll: true });
    }
  }
  const draftAmount = (key: string) => {
    const value = amounts[key]?.trim();
    return value ? parseMoney(value) : 0;
  };
  let commission = 0,
    ads = 0;
  try {
    commission = sumMoney(
      outstanding
        .filter((r) => r.kind === 'commission')
        .map((r) => draftAmount(r.kind + r.id)),
    );
    ads = sumMoney(
      outstanding
        .filter((r) => r.kind === 'ads')
        .map((r) => draftAmount(r.kind + r.id)),
    );
  } catch {
    commission = 0;
    ads = 0;
  }
  return (
    <>
      <PaymentDateLedger
        account={account}
        disabled={pending || uploading}
        onPayDate={(value) => {
          chooseDate(value, true).catch((reason: unknown) => {
            setError(ErrorMessage(reason));
          });
        }}
      />
      <section className="panel receipt-composer">
        <h2>Record a payment · {account.brandName}</h2>
        <p className="muted">
          Enter what was received against each invoice. Commission and
          advertising stay separate. A receipt records this payment—not a new
          bill. The payment date below is when money was received; it does not
          change the original bill date.
        </p>
        <Field label="Bills to pay">
          <select
            ref={dateSelect}
            value={billDate}
            disabled={pending || uploading}
            onChange={(event) => {
              chooseDate(event.target.value).catch((reason: unknown) => {
                setError(ErrorMessage(reason));
              });
            }}
          >
            <option value="">All outstanding bill dates</option>
            {billDates.map((value) => (
              <option key={value} value={value}>
                {dateLabel(value)}
              </option>
            ))}
          </select>
        </Field>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setError('');
            try {
              const allocations = outstanding.flatMap((row) => {
                const value = amounts[row.kind + row.id]?.trim();
                return value
                  ? [
                      {
                        kind: row.kind,
                        invoiceId: row.id,
                        amount: parseMoney(value),
                      },
                    ]
                  : [];
              });
              if (!allocations.length)
                throw new Error(
                  'Enter a payment amount against at least one outstanding invoice.',
                );
              if (allocations.length > 50)
                throw new Error('Select at most 50 invoices for one receipt.');
              setPending(true);
              api('/manage/receipts', z.object({ item: receiptSchema }), {
                method: 'POST',
                body: {
                  requestId,
                  brandId: account.brandId,
                  version: account.version,
                  date: formText(form, 'date'),
                  method: formText(form, 'method'),
                  reference: formText(form, 'reference'),
                  note: formText(form, 'note'),
                  proofFileId: proof,
                  allocations,
                },
              })
                .then((result) => {
                  onSaved(result.item.id);
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
          onChange={() => {
            setError('');
          }}
        >
          <div className="form-grid">
            <Field label="Payment date">
              <input
                name="date"
                type="date"
                required
                defaultValue={today()}
                disabled={pending}
              />
            </Field>
            <Field label="Payment method">
              <select name="method" disabled={pending}>
                {['Cash', 'Bank transfer', 'bKash', 'Nagad', 'Other'].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
              </select>
            </Field>
            <Field label="Transaction reference">
              <input name="reference" maxLength={100} disabled={pending} />
            </Field>
            <Field label="Payment note">
              <input name="note" maxLength={200} disabled={pending} />
            </Field>
          </div>
          {(['commission', 'ads'] as const).map((kind) => (
            <section className="receipt-allocation-group" key={kind}>
              <h3>
                {kind === 'commission' ? 'Commission' : 'Advertising'}{' '}
                allocations
              </h3>
              {outstanding.filter((row) => row.kind === kind).length ? (
                outstanding
                  .filter((row) => row.kind === kind)
                  .map((row) => (
                    <div className="receipt-allocation" key={row.id}>
                      <div>
                        <strong>{row.invoiceNumber}</strong>
                        <small>
                          {row.period} · {row.date}
                        </small>
                        <span>Remaining {money(row.due)}</span>
                      </div>
                      <Field label={`Received for ${row.invoiceNumber}`}>
                        <input
                          inputMode="decimal"
                          value={amounts[kind + row.id] ?? ''}
                          placeholder={amountInput(row.due)}
                          disabled={pending}
                          onChange={(event) => {
                            setAmounts((values) => ({
                              ...values,
                              [kind + row.id]: event.target.value,
                            }));
                          }}
                        />
                      </Field>
                    </div>
                  ))
              ) : (
                <p className="muted">
                  No outstanding{' '}
                  {kind === 'commission' ? 'commission' : 'advertising'}{' '}
                  invoices.
                </p>
              )}
            </section>
          ))}
          <div className="receipt-payment-total" aria-live="polite">
            <span>Commission {money(commission)}</span>
            <span>Advertising {money(ads)}</span>
            <strong>Total received {money(sumMoney([commission, ads]))}</strong>
          </div>
          <ImageUpload
            kind="proof"
            currentId={proof}
            onPendingChange={setUploading}
            onChange={(value) => {
              setProof(value);
              return Promise.resolve();
            }}
          />
          {error ? <Alert>{error}</Alert> : null}
          <button
            className="primary"
            disabled={pending || uploading || !outstanding.length}
          >
            {pending ? (
              <>
                <Spinner size={12} /> Recording…
              </>
            ) : (
              'Record payment & create receipt'
            )}
          </button>
          <p className="caption">
            Up to 50 invoices per payment. No overpayments or automatic
            transfers between categories. Reload balances if another payment
            changes this account.
          </p>
        </form>
      </section>
    </>
  );
}
