import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { parseMoney } from '@settlement/domain/money';
import { paymentStatus } from '@settlement/domain/payments';
import { z } from 'zod';

import { Alert, ErrorMessage, Field } from '../../components/ui';
import { api, okSchema, paymentSchema } from '../../lib/api';
import type { Payment } from '../../lib/api';
import { dateLabel, formText, money, today } from '../../lib/format';
import { ImageUpload } from '../../components/image-upload';

export function PaymentsPanel({
  target,
  total,
  paid,
  payments,
  refresh,
}: {
  target: { kind: 'settlement' | 'ads' | 'brand'; targetId: string };
  total: number;
  paid: number;
  payments: Payment[];
  refresh: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [proofFileId, setProofFileId] = useState<string | null>(null);
  const [editingProof, setEditingProof] = useState<Payment | null>(null);
  const [olderPayments, setOlderPayments] = useState<Payment[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [uploading, setUploading] = useState(false);
  const history = [...payments, ...olderPayments];
  async function refreshHistory() {
    await refresh();
    setOlderPayments([]);
    setHasMore(true);
  }
  async function loadOlder() {
    const last = history.at(-1);
    if (last === undefined) return;
    setPending(true);
    setError('');
    try {
      const result = await api(
        `/manage/payments?${new URLSearchParams({ ...target, before: last.date, beforeId: last.id }).toString()}`,
        z.object({ items: z.array(paymentSchema), hasMore: z.boolean() }),
      );
      setOlderPayments((current) => [...current, ...result.items]);
      setHasMore(result.hasMore);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  const totalPaid = paid;
  const status = paymentStatus(total, totalPaid);
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await api('/manage/payments', z.object({ item: paymentSchema }), {
        method: 'POST',
        body: {
          requestId,
          proofFileId,
          target,
          amount: parseMoney(formText(values, 'amount')),
          date: formText(values, 'date'),
          note: formText(values, 'note'),
        },
      });
      setRequestId(crypto.randomUUID());
      setProofFileId(null);
      form.reset();
      await refreshHistory();
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  async function remove(payment: Payment) {
    if (
      !window.confirm(
        `Remove the ${money(payment.amount)} payment from ${dateLabel(payment.date)}?`,
      )
    )
      return;
    setPending(true);
    setError('');
    try {
      await api(`/manage/payments/${payment.id}`, okSchema, {
        method: 'DELETE',
        body: {},
      });
      await refreshHistory();
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel no-print payment-panel">
      <div className="section-heading">
        <div>
          <h2>Payments</h2>
          <p className="muted">
            Paid {money(totalPaid)} ·{' '}
            {status.balance < 0 ? 'Advance' : 'Balance'}{' '}
            {money(Math.abs(status.balance))}
          </p>
        </div>
        <span
          className={`status status-${status.status.toLowerCase().replace('/', '')}`}
        >
          {status.status}
        </span>
      </div>
      <div className="split-layout">
        <div>
          {history.length ? (
            history.map((payment) => (
              <div className="payment-row" key={payment.id}>
                <div>
                  <strong>{money(payment.amount)}</strong>
                  <small className="muted">
                    {dateLabel(payment.date)}
                    {payment.note ? ` · ${payment.note}` : ''}
                  </small>
                </div>
                <button
                  className="text-button"
                  disabled={pending}
                  onClick={() => {
                    setEditingProof(payment);
                  }}
                >
                  {payment.proofFileId ? 'View / edit proof' : 'Add proof'}
                </button>
                <button
                  disabled={pending}
                  className="text-button danger-text"
                  onClick={() => {
                    remove(payment).catch((reason: unknown) => {
                      setError(ErrorMessage(reason));
                    });
                  }}
                >
                  Remove
                </button>
              </div>
            ))
          ) : (
            <p className="muted">No payments recorded.</p>
          )}
          {payments.length >= 200 && hasMore ? (
            <button
              className="secondary"
              disabled={pending}
              onClick={() => {
                loadOlder().catch((reason: unknown) => {
                  setError(ErrorMessage(reason));
                });
              }}
            >
              Load older payments
            </button>
          ) : null}
        </div>
        {editingProof ? (
          <div>
            <h3>Payment proof · {money(editingProof.amount)}</h3>
            <ImageUpload
              kind="proof"
              currentId={editingProof.proofFileId}
              onPendingChange={setUploading}
              onChange={async (fileId) => {
                await api(
                  `/manage/payments/${editingProof.id}/proof`,
                  okSchema,
                  { method: 'PUT', body: { proofFileId: fileId } },
                );
                setEditingProof((current) =>
                  current ? { ...current, proofFileId: fileId } : null,
                );
                await refreshHistory();
              }}
            />
            <button
              className="secondary"
              onClick={() => {
                setEditingProof(null);
              }}
            >
              Close proof
            </button>
          </div>
        ) : null}
        <form
          onSubmit={(event) => {
            save(event).catch((reason: unknown) => {
              setError(ErrorMessage(reason));
            });
          }}
          onChange={() => {
            setError('');
          }}
        >
          <div className="form-grid">
            <Field label="Amount (৳)">
              <input name="amount" inputMode="decimal" required />
            </Field>
            <Field label="Date">
              <input name="date" type="date" defaultValue={today()} required />
            </Field>
          </div>
          <Field label="Payment note">
            <input
              name="note"
              maxLength={200}
              placeholder="e.g. Cash / bank transfer"
            />
          </Field>
          {error ? <Alert>{error}</Alert> : null}
          <ImageUpload
            kind="proof"
            currentId={proofFileId}
            onPendingChange={setUploading}
            onChange={(fileId) => {
              setProofFileId(fileId);
              return Promise.resolve();
            }}
          />
          <button className="primary" disabled={pending || uploading}>
            {pending ? 'Saving…' : 'Record payment'}
          </button>
        </form>
      </div>
    </section>
  );
}
