import { useEffect, useState } from 'react';
import { z } from 'zod';
import {
  paymentAccountSchema,
  receiptListSchema,
  receiptSchema,
} from '../../../shared/receipts';
import type { PaymentAccount, PaymentReceipt } from '../../../shared/receipts';
import type { Brand, Settings } from '../../lib/api';
import { api } from '../../lib/api';
import {
  Alert,
  ErrorMessage,
  Field,
  Metric,
  PageHeading,
  SkeletonInvoice,
  SkeletonMetrics,
  SkeletonTable,
} from '../../components/ui';
import { dateLabel, money } from '../../lib/format';
import { ReceiptComposer } from './composer';
import { ReceiptView } from './receipt';

const cursorSchema = z.object({ before: z.string(), beforeId: z.string() });
type Cursor = z.infer<typeof cursorSchema> | null;
const legacySchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      amount: z.number().int(),
      note: z.string(),
      category: z.string(),
      invoiceNumber: z.string(),
    }),
  ),
  next: cursorSchema.nullable(),
});

function PriorPayments({ brandId }: { brandId: string }) {
  const [data, setData] = useState<z.infer<typeof legacySchema> | null>(null),
    [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function load(cursor: Cursor = null) {
    setPending(true);
    setError('');
    try {
      setData(
        await api(
          '/manage/receipts/legacy?' +
            new URLSearchParams({ brandId, ...(cursor ?? {}) }).toString(),
          legacySchema,
        ),
      );
    } catch (e) {
      setError(ErrorMessage(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel">
      <h2>Prior payment history</h2>
      <p className="muted">
        Existing payments are already included in this account. No retroactive
        receipt or extra charge is created for them.
      </p>
      <button
        className="secondary"
        disabled={pending}
        onClick={() => {
          load().catch((e: unknown) => {
            setError(ErrorMessage(e));
          });
        }}
      >
        View prior payments
      </button>
      {error ? <Alert>{error}</Alert> : null}
      {data ? (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Category / invoice</th>
                  <th>Note</th>
                  <th className="numeric">Paid</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td>{dateLabel(row.date)}</td>
                    <td>
                      {row.category}
                      <small>{row.invoiceNumber}</small>
                    </td>
                    <td>{row.note || '—'}</td>
                    <td className="numeric">{money(row.amount)}</td>
                  </tr>
                ))}
                {!data.items.length ? (
                  <tr>
                    <td colSpan={4}>No prior payments.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {data.next ? (
            <button
              className="secondary"
              disabled={pending}
              onClick={() => {
                load(data.next).catch((e: unknown) => {
                  setError(ErrorMessage(e));
                });
              }}
            >
              Next prior payments
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function Payments({
  path,
  brands,
  settings,
  navigate,
}: {
  path: string;
  brands: Brand[];
  settings: Settings;
  navigate: (path: string) => void;
}) {
  const parts = path.split('/').filter(Boolean),
    brandId = parts[1] === 'brand' ? (parts[2] ?? '') : '',
    receiptId = parts[1] && parts[1] !== 'brand' ? parts[1] : '';
  const [account, setAccount] = useState<PaymentAccount | null>(null),
    [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [list, setList] = useState<z.infer<typeof receiptListSchema> | null>(
      null,
    ),
    [cursor, setCursor] = useState<Cursor>(null),
    [previous, setPrevious] = useState<Cursor[]>([]);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (!brandId && !receiptId) return;
    const controller = new AbortController();
    const job = receiptId
      ? api(
          `/manage/receipts/${receiptId}`,
          z.object({ item: receiptSchema }),
          { signal: controller.signal },
        ).then((result) => {
          setReceipt(result.item);
        })
      : api(`/manage/receipts/account/${brandId}`, paymentAccountSchema, {
          signal: controller.signal,
        }).then(setAccount);
    job
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [brandId, receiptId, version]);
  useEffect(() => {
    if (!brandId) return;
    const controller = new AbortController();
    api(
      '/manage/receipts?' +
        new URLSearchParams({ brandId, ...(cursor ?? {}) }).toString(),
      receiptListSchema,
      { signal: controller.signal },
    )
      .then(setList)
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(ErrorMessage(e));
      });
    return () => {
      controller.abort();
    };
  }, [brandId, cursor, version]);
  if (receiptId)
    return receipt ? (
      <ReceiptView
        item={receipt}
        settings={settings}
        onChanged={setReceipt}
        onBack={() => {
          navigate(`/payments/brand/${receipt.brandId}`);
        }}
      />
    ) : error ? (
      <Alert>{error}</Alert>
    ) : (
      <SkeletonInvoice />
    );
  return (
    <div className="payments-workspace">
      <PageHeading
        eyebrow="PAYMENTS / BRAND ACCOUNTS"
        title="Payments, clearly separated."
        description="Track commission and advertising, record partial payments and keep a receipt for every new payment."
      />
      <section className="panel">
        <Field label="Payment brand account">
          <select
            value={brandId}
            onChange={(event) => {
              navigate(
                event.target.value
                  ? `/payments/brand/${event.target.value}`
                  : '/payments',
              );
            }}
          >
            <option value="">Choose a brand account</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </Field>
      </section>
      {error ? <Alert>{error}</Alert> : null}
      {!brandId ? (
        <section className="panel">
          <h2>Brand accounts</h2>
          <p>
            Commission and advertising are tracked separately. Existing invoices
            and payments are kept; creating a receipt never creates another
            debt.
          </p>
          <div className="brand-account-directory">
            {brands.map((brand) => (
              <button
                key={brand.id}
                className="secondary"
                onClick={() => {
                  navigate(`/payments/brand/${brand.id}`);
                }}
              >
                <strong>{brand.name}</strong>
                <small>Open account →</small>
              </button>
            ))}
          </div>
          {!brands.length ? (
            <p className="muted">Add a brand in Brands & costs to begin.</p>
          ) : null}
        </section>
      ) : !account && error ? (
        <section className="panel">
          <p>Could not load this brand account.</p>
          <button
            className="secondary"
            onClick={() => {
              setError('');
              setLoading(true);
              setVersion((v) => v + 1);
            }}
          >
            Retry account
          </button>
        </section>
      ) : loading || !account ? (
        <SkeletonMetrics count={4} />
      ) : (
        <>
          <h2>{account.brandName} account</h2>
          <div className="metrics">
            <Metric
              label="Commission outstanding"
              value={money(account.commission.due)}
            />
            <Metric
              label="Advertising outstanding"
              value={money(account.ads.due)}
            />
            <Metric
              label="Commission payments received"
              value={money(account.commission.paid)}
            />
            <Metric
              label="Advertising payments received"
              value={money(account.ads.paid)}
            />
          </div>
          {account.commission.credit || account.ads.credit ? (
            <section className="panel">
              <h2>Existing credits / advances</h2>
              <p>
                Commission: {money(account.commission.credit)} · Advertising:{' '}
                {money(account.ads.credit)}
              </p>
              <p className="muted">
                Existing advertising advances keep their oldest-first
                allocation. Commission overpayments remain on their original
                invoices and are shown separately, not silently moved to another
                invoice. New receipts cannot create an overpayment.
              </p>
            </section>
          ) : null}
          <div className="section-heading">
            <p className="caption">
              Non-payable loss invoices are not billed. Balances use saved
              invoice rules and include prior payments.
            </p>
            <button
              className="secondary compact"
              onClick={() => {
                setError('');
                setVersion((v) => v + 1);
              }}
            >
              Reload balances
            </button>
          </div>
          <ReceiptComposer
            account={account}
            onSaved={(id) => {
              navigate(`/payments/${id}`);
            }}
          />
          <section
            className="panel receipt-ledger"
            aria-label="Payment receipt history"
          >
            <div className="section-heading">
              <div>
                <h2>Payment receipts</h2>
                <p className="muted">
                  One receipt per payment, including partial payments. Reversed
                  receipts remain in history.
                </p>
              </div>
            </div>
            {!list ? (
              error ? (
                <p>
                  Could not load receipt history. Use Reload balances to retry.
                </p>
              ) : (
                <SkeletonTable rows={3} columns={6} />
              )
            ) : (
              <div className="table-scroll">
                <table className="invoice-ledger-table">
                  <thead>
                    <tr>
                      <th>Receipt / date</th>
                      <th>Commission received</th>
                      <th>Advertising received</th>
                      <th>Total received</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.items.map((row) => (
                      <tr key={row.id}>
                        <td
                          className="ledger-identity"
                          data-label="Receipt / date"
                        >
                          {row.number}
                          <small>{dateLabel(row.date)}</small>
                        </td>
                        <td
                          className="numeric"
                          data-label="Commission received"
                        >
                          {money(row.data.commissionReceived)}
                        </td>
                        <td
                          className="numeric"
                          data-label="Advertising received"
                        >
                          {money(row.data.adsReceived)}
                        </td>
                        <td className="numeric" data-label="Total received">
                          {money(row.total)}
                        </td>
                        <td data-label="Status">
                          <span className="invoice-status">
                            {row.reversedAt === null ? 'Recorded' : 'Reversed'}
                          </span>
                        </td>
                        <td className="ledger-actions" data-label="Action">
                          <button
                            className="secondary compact"
                            onClick={() => {
                              navigate(`/payments/${row.id}`);
                            }}
                          >
                            View receipt
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!list.items.length ? (
                      <tr>
                        <td colSpan={6}>
                          No receipts recorded for this brand yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )}
            <div className="pagination-actions">
              <button
                className="secondary"
                disabled={!previous.length}
                onClick={() => {
                  setList(null);
                  setCursor(previous.at(-1) ?? null);
                  setPrevious((values) => values.slice(0, -1));
                }}
              >
                Previous receipts
              </button>
              <span>Page {previous.length + 1} · 20 receipts per page</span>
              <button
                className="secondary"
                disabled={!list?.next}
                onClick={() => {
                  if (!list?.next) return;
                  setList(null);
                  setPrevious((values) => [...values, cursor]);
                  setCursor(list.next);
                }}
              >
                Next receipts
              </button>
            </div>
          </section>
          <PriorPayments key={account.version} brandId={brandId} />
        </>
      )}
    </div>
  );
}
