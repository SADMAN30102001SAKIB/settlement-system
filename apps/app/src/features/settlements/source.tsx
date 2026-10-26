import { useState } from 'react';
import { z } from 'zod';
import type { Brand } from '../../lib/api';
import { api } from '../../lib/api';
import { amountInput, today } from '../../lib/format';
import { Alert, ErrorMessage, Field } from '../../components/ui';
import { Importer } from '../business/importer';

const amount = z.number().int();
const totals = z.object({
  deliveredQty: amount,
  cancelledQty: amount,
  partialQty: amount,
  pendingQty: amount,
  deliveredAmount: amount,
  cancelledAmount: amount,
  partialAmount: amount,
  shipping: amount,
  codCharge: amount,
  ads: amount,
});
export type SourceValues = {
  brandId: string;
  date: string;
  period: string;
} & Record<keyof z.infer<typeof totals>, string>;
export function SettlementSource({
  brands,
  onLoad,
}: {
  brands: Brand[];
  onLoad: (values: SourceValues) => void;
}) {
  const [from, setFrom] = useState(today()),
    [to, setTo] = useState(today()),
    [brandId, setBrandId] = useState(''),
    [basis, setBasis] = useState('order');
  const [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  function load(
    key: string,
    start: string,
    end: string,
    values: z.infer<typeof totals>,
  ) {
    onLoad({
      brandId: key,
      date: end,
      period: start === end ? start : `${start} – ${end}`,
      deliveredQty: String(values.deliveredQty),
      cancelledQty: String(values.cancelledQty),
      partialQty: String(values.partialQty),
      pendingQty: String(values.pendingQty),
      deliveredAmount: amountInput(values.deliveredAmount),
      cancelledAmount: amountInput(values.cancelledAmount),
      partialAmount: amountInput(values.partialAmount),
      shipping: amountInput(values.shipping),
      codCharge: amountInput(values.codCharge),
      ads: amountInput(values.ads),
    });
  }
  async function fetchData() {
    setPending(true);
    setError('');
    try {
      const values = await api(
        `/manage/business/settlement?${new URLSearchParams({ from, to, brandId, basis }).toString()}`,
        totals,
      );
      load(brandId, from, to, values);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <details className="panel no-print">
      <summary>
        Step 1 · Load from Business Tracking or a courier file (optional)
      </summary>
      <div className="form-grid">
        <Field label="Brand">
          <select
            value={brandId}
            onChange={(event) => {
              setBrandId(event.target.value);
            }}
          >
            <option value="">Select brand</option>
            {brands.map((brand) => (
              <option value={brand.id} key={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date basis">
          <select
            value={basis}
            onChange={(event) => {
              setBasis(event.target.value);
            }}
          >
            <option value="order">Order date</option>
            <option value="delivery">Delivery date</option>
          </select>
        </Field>
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
      </div>
      <button
        className="secondary"
        disabled={!brandId || pending}
        onClick={() => {
          fetchData().catch((reason: unknown) => {
            setError(ErrorMessage(reason));
          });
        }}
      >
        Load saved courier totals & allocated ads
      </button>
      {error ? <Alert>{error}</Alert> : null}
      <Importer
        brands={brands}
        onReviewed={(key, rows) => {
          const values = {
            deliveredQty: 0,
            cancelledQty: 0,
            partialQty: 0,
            pendingQty: 0,
            deliveredAmount: 0,
            cancelledAmount: 0,
            partialAmount: 0,
            shipping: 0,
            codCharge: 0,
            ads: 0,
          };
          for (const row of rows) {
            if (row.status === 'Delivered') {
              values.deliveredQty++;
              values.deliveredAmount += row.codAmount;
            } else if (row.status === 'Cancelled') {
              values.cancelledQty++;
              values.cancelledAmount += row.codAmount;
            } else if (row.status === 'Partial Delivered') {
              values.partialQty++;
              values.partialAmount += row.codAmount;
            } else values.pendingQty++;
            if (row.status !== 'Pending') {
              values.shipping += row.shipping;
              values.codCharge += row.codCharge;
            }
          }
          const dates = rows.map((row) => row.orderDate).sort();
          const start = dates[0],
            end = dates.at(-1);
          if (start !== undefined && end !== undefined)
            load(key, start, end, values);
        }}
      />
    </details>
  );
}
