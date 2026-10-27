import { useRef, useState } from 'react';
import type { PaymentReceipt } from '../../../shared/receipts';
import { paymentAccountSchema, receiptSchema } from '../../../shared/receipts';
import type { Settings } from '../../lib/api';
import { api, okSchema } from '../../lib/api';
import { z } from 'zod';
import {
  Alert,
  ErrorMessage,
  Field,
  PageHeading,
  Spinner,
} from '../../components/ui';
import { useConfirmation } from '../../components/confirmation-context';
import { dateLabel, money } from '../../lib/format';
import { downloadDocument } from '../../lib/pdf';

export function ReceiptView({
  item,
  settings,
  onChanged,
  onBack,
}: {
  item: PaymentReceipt;
  settings: Settings;
  onChanged: (item: PaymentReceipt) => void;
  onBack: () => void;
}) {
  const documentRef = useRef<HTMLElement>(null),
    confirm = useConfirmation();
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [reason, setReason] = useState('');
  async function reverse() {
    if (reason.trim().length < 5) {
      setError('Enter a reversal reason of at least five characters.');
      return;
    }
    if (
      !(await confirm({
        title: 'Reverse this payment receipt?',
        message:
          'All allocations on this receipt will be reversed together. The original receipt and its figures remain in the audit history. This cannot be undone; record a new receipt for corrected details.',
        action: 'Reverse receipt',
        destructive: true,
      }))
    )
      return;
    setPending(true);
    setError('');
    try {
      const account = await api(
        `/manage/receipts/account/${item.brandId}`,
        paymentAccountSchema,
      );
      await api(`/manage/receipts/${item.id}/reverse`, okSchema, {
        method: 'POST',
        body: { reason, version: account.version },
      });
      const result = await api(
        `/manage/receipts/${item.id}`,
        z.object({ item: receiptSchema }),
      );
      onChanged(result.item);
    } catch (e) {
      setError(ErrorMessage(e));
    } finally {
      setPending(false);
    }
  }
  const data = item.data;
  const recordedTime = (time: number) =>
    new Date(time).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }) +
    ' (Dhaka)';
  return (
    <>
      <PageHeading
        eyebrow="PAYMENTS / RECEIPT"
        title={item.number}
        description={`Payment received from ${data.brandName}.`}
        action={
          <button className="secondary" onClick={onBack}>
            Back to brand account
          </button>
        }
      />
      <div className="actions no-print">
        <button
          className="primary"
          disabled={pending}
          onClick={() => {
            if (!documentRef.current) return;
            setPending(true);
            setError('');
            downloadDocument(documentRef.current, item.number)
              .catch((e: unknown) => {
                setError(ErrorMessage(e));
              })
              .finally(() => {
                setPending(false);
              });
          }}
        >
          {pending ? (
            <>
              <Spinner size={12} /> Working…
            </>
          ) : (
            'Download receipt PDF'
          )}
        </button>
        <button
          className="secondary"
          disabled={pending}
          onClick={() => {
            window.print();
          }}
        >
          Print receipt
        </button>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <article ref={documentRef} className="invoice-document invoice-receipt">
        {settings.watermarkFileId ? (
          <img
            className="invoice-watermark"
            src={`/api/manage/files/${settings.watermarkFileId}`}
            alt=""
          />
        ) : null}
        <header className="invoice-header">
          <div>
            <p className="eyebrow">PAYMENT RECEIPT · NOT A NEW BILL</p>
            <h1>{data.companyName}</h1>
            <p>{data.address}</p>
            <p>
              {data.phone} · {data.email}
            </p>
          </div>
          <span className="invoice-logo">H</span>
        </header>
        <div className="invoice-meta">
          <div>
            <small>RECEIPT / BRAND</small>
            <strong>{item.number}</strong>
            <p>{data.brandName}</p>
          </div>
          <div>
            <small>PAYMENT DATE</small>
            <strong>{dateLabel(item.date)}</strong>
            <p>
              {data.method}
              {data.reference ? ` · ${data.reference}` : ''}
            </p>
          </div>
        </div>
        {item.reversedAt !== null ? (
          <div className="receipt-reversed">
            <strong>REVERSED — NOT AN ACTIVE PAYMENT</strong>
            <p>{item.reversalReason}</p>
            <small>
              Reversed {recordedTime(item.reversedAt)}. Original figures below
              are retained for audit.
            </small>
          </div>
        ) : null}
        <section>
          <h2>Payment allocation</h2>
          <table>
            <thead>
              <tr>
                <th>Invoice / period</th>
                <th>Category</th>
                <th className="numeric">Received</th>
                <th className="numeric">Invoice balance after</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line) => (
                <tr key={line.kind + line.invoiceId}>
                  <td>
                    {line.invoiceNumber}
                    <small>{line.period}</small>
                  </td>
                  <td>
                    {line.kind === 'commission' ? 'Commission' : 'Advertising'}
                  </td>
                  <td className="numeric">{money(line.received)}</td>
                  <td className="numeric">{money(line.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h2>Brand account · balances at recording time</h2>
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th className="numeric">Due before</th>
                <th className="numeric">This payment</th>
                <th className="numeric">Due after</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Commission</td>
                <td className="numeric">{money(data.commissionBefore)}</td>
                <td className="numeric">{money(data.commissionReceived)}</td>
                <td className="numeric">{money(data.commissionAfter)}</td>
              </tr>
              <tr>
                <td>Advertising</td>
                <td className="numeric">{money(data.adsBefore)}</td>
                <td className="numeric">{money(data.adsReceived)}</td>
                <td className="numeric">{money(data.adsAfter)}</td>
              </tr>
            </tbody>
          </table>
          {data.commissionCredit || data.adsCredit ? (
            <p>
              Existing credits kept separately: commission{' '}
              {money(data.commissionCredit)} · advertising{' '}
              {money(data.adsCredit)}.
            </p>
          ) : null}
        </section>
        <div className="invoice-final">
          <span>Total received on this receipt</span>
          <strong>{money(item.total)}</strong>
        </div>
        {data.note ? <p className="receipt-note">{data.note}</p> : null}
        <footer className="invoice-footer">
          <p>
            Recorded {recordedTime(item.createdAt)}
            <br />
            Later payments do not change this receipt. Reversals retain the
            original figures.
          </p>
          <div className="signature-line">
            {settings.signatureFileId ? (
              <img
                className="invoice-signature"
                src={`/api/manage/files/${settings.signatureFileId}`}
                alt="Authorized signature"
              />
            ) : null}
            <span className="signature-rule" />
            <span>{settings.signatureLabel}</span>
          </div>
        </footer>
      </article>
      {item.proofFileId ? (
        <section className="panel no-print">
          <h2>Payment proof</h2>
          <a
            href={`/api/manage/files/${item.proofFileId}`}
            target="_blank"
            rel="noreferrer"
          >
            Open payment proof
          </a>
        </section>
      ) : null}
      {item.reversedAt === null ? (
        <section className="panel no-print receipt-reversal">
          <h2>Correct a recorded payment</h2>
          <p className="muted">
            Receipts are not overwritten or deleted. Reverse this receipt with a
            reason, then record the corrected payment.
          </p>
          <Field label="Reversal reason">
            <input
              value={reason}
              maxLength={200}
              onChange={(event) => {
                setReason(event.target.value);
                setError('');
              }}
              disabled={pending}
            />
          </Field>
          <button
            className="secondary danger-text"
            disabled={pending}
            onClick={() => {
              reverse().catch((e: unknown) => {
                setError(ErrorMessage(e));
              });
            }}
          >
            Reverse receipt
          </button>
        </section>
      ) : null}
    </>
  );
}
