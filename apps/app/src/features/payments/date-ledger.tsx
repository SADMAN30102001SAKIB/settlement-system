import { useMemo, useState } from 'react';
import type { PaymentAccount } from '../../../shared/receipts';
import { Field } from '../../components/ui';
import { dateLabel, money } from '../../lib/format';
import { dateBalances } from './date-balances';

export function PaymentDateLedger({
  account,
  onPayDate,
  disabled,
}: {
  account: PaymentAccount;
  onPayDate: (date: string) => void;
  disabled: boolean;
}) {
  const rows = useMemo(
    () => dateBalances(account.invoices),
    [account.invoices],
  );
  const [filterDate, setFilterDate] = useState(''),
    [page, setPage] = useState(0);
  const filtered = filterDate
    ? rows.filter((row) => row.date === filterDate)
    : rows;
  const lastPage = Math.max(0, Math.ceil(filtered.length / 20) - 1);
  const current = Math.min(page, lastPage);
  return (
    <section
      className="panel payment-date-ledger"
      aria-label="Date-wise payment ledger"
    >
      <div className="section-heading">
        <div>
          <h2>Date-wise payment ledger</h2>
          <p className="muted">
            Grouped by original bill date, not payment date. Paid and due
            columns include all active payments against those bills, including
            instalments.
          </p>
        </div>
        <span className="badge">BDT · ৳</span>
      </div>
      <div className="payment-date-filter">
        <Field label="Find bill date">
          <input
            type="date"
            value={filterDate}
            onChange={(event) => {
              setFilterDate(event.target.value);
              setPage(0);
            }}
          />
        </Field>
        {filterDate ? (
          <button
            className="secondary compact"
            onClick={() => {
              setFilterDate('');
              setPage(0);
            }}
          >
            Show all dates
          </button>
        ) : null}
      </div>
      <div className="table-scroll">
        <table className="payment-date-table">
          <thead>
            <tr>
              <th scope="col">Bill date</th>
              <th scope="col" className="numeric">
                Commission billed
              </th>
              <th scope="col" className="numeric">
                Ads billed
              </th>
              <th scope="col" className="numeric">
                Commission paid
              </th>
              <th scope="col" className="numeric">
                Ads paid
              </th>
              <th scope="col" className="numeric">
                Commission due
              </th>
              <th scope="col" className="numeric">
                Ads due
              </th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(current * 20, current * 20 + 20).map((row) => (
              <tr key={row.date} data-bill-date={row.date}>
                <td data-label="Bill date" className="payment-date-identity">
                  <strong>{dateLabel(row.date)}</strong>
                  <small>
                    {row.invoiceCount} invoice
                    {row.invoiceCount === 1 ? '' : 's'}
                  </small>
                  {row.commission.credit > 0 ? (
                    <small>
                      Commission credit {money(row.commission.credit)}
                    </small>
                  ) : null}
                  {row.ads.credit > 0 ? (
                    <small>Ads credit {money(row.ads.credit)}</small>
                  ) : null}
                </td>
                <td data-label="Commission billed" className="numeric">
                  {money(row.commission.billed)}
                </td>
                <td data-label="Ads billed" className="numeric">
                  {money(row.ads.billed)}
                </td>
                <td data-label="Commission paid" className="numeric">
                  {money(row.commission.paid)}
                </td>
                <td data-label="Ads paid" className="numeric">
                  {money(row.ads.paid)}
                </td>
                <td data-label="Commission due" className="numeric">
                  <strong>{money(row.commission.due)}</strong>
                </td>
                <td data-label="Ads due" className="numeric">
                  <strong>{money(row.ads.due)}</strong>
                </td>
                <td data-label="Action" className="payment-date-action">
                  {row.commission.due > 0 || row.ads.due > 0 ? (
                    <button
                      className="secondary compact"
                      disabled={disabled}
                      onClick={() => {
                        onPayDate(row.date);
                      }}
                    >
                      Pay this date
                    </button>
                  ) : (
                    <span className="invoice-status">
                      {row.commission.billed + row.ads.billed > 0
                        ? 'Paid'
                        : 'Nothing due'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!filtered.length ? (
              <tr>
                <td colSpan={8}>
                  No bills for {filterDate ? 'this date' : 'this brand yet'}.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="pagination-actions">
        <button
          className="secondary compact"
          disabled={current === 0}
          onClick={() => {
            setPage(current - 1);
          }}
        >
          Previous dates
        </button>
        <span>
          Page {current + 1} of {lastPage + 1} · 20 dates per page
        </span>
        <button
          className="secondary compact"
          disabled={current >= lastPage}
          onClick={() => {
            setPage(current + 1);
          }}
        >
          Next dates
        </button>
      </div>
    </section>
  );
}
