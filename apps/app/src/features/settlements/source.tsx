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
  deliveredUnits: amount,
  productCost: amount,
  cancelledQty: amount,
  partialQty: amount,
  pendingQty: amount,
  deliveredAmount: amount,
  cancelledAmount: amount,
  partialAmount: amount,
  shipping: amount,
  codCharge: amount,
  deliveredCodCharge: amount,
  partialCodCharge: amount,
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
  brandId,
  onBrandChange,
}: {
  brands: Brand[];
  brandId: string;
  onBrandChange: (brandId: string) => void;
  onLoad: (values: SourceValues) => void;
}) {
  const [from, setFrom] = useState(today()),
    [to, setTo] = useState(today()),
    [basis, setBasis] = useState('order');
  const [source, setSource] = useState<'saved' | 'file'>('saved');
  const [open, setOpen] = useState(false);
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
      deliveredUnits: String(values.deliveredUnits),
      productCost: amountInput(values.productCost),
      cancelledQty: String(values.cancelledQty),
      partialQty: String(values.partialQty),
      pendingQty: String(values.pendingQty),
      deliveredAmount: amountInput(values.deliveredAmount),
      cancelledAmount: amountInput(values.cancelledAmount),
      partialAmount: amountInput(values.partialAmount),
      shipping: amountInput(values.shipping),
      codCharge: amountInput(values.codCharge),
      deliveredCodCharge: amountInput(values.deliveredCodCharge),
      partialCodCharge: amountInput(values.partialCodCharge),
      ads: amountInput(values.ads),
    });
    setOpen(false);
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
    <section className="panel no-print settlement-source">
      <div className="section-heading">
        <div>
          <h2>Start from existing data</h2>
          <p className="muted">
            Optional — load verified totals instead of entering them again.
          </p>
        </div>
        <button
          className="secondary"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {open ? 'Close data source' : 'Load settlement totals'}
        </button>
      </div>
      {open ? (
        <>
          <p className="muted">
            Choose one source, or leave this closed and enter totals manually.
          </p>
          <div
            className="source-options"
            role="group"
            aria-label="Settlement data source"
          >
            <button
              className={source === 'saved' ? 'primary' : 'secondary'}
              aria-pressed={source === 'saved'}
              onClick={() => {
                setSource('saved');
              }}
            >
              Business Tracking
            </button>
            <button
              className={source === 'file' ? 'primary' : 'secondary'}
              aria-pressed={source === 'file'}
              onClick={() => {
                setSource('file');
              }}
            >
              Courier file
            </button>
          </div>
          {error ? <Alert>{error}</Alert> : null}
          {source === 'saved' ? (
            <>
              <div className="form-grid">
                <Field label="Brand">
                  <select
                    value={brandId}
                    onChange={(event) => {
                      onBrandChange(event.target.value);
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
            </>
          ) : null}
          {source === 'file' ? (
            <Importer
              brands={brands}
              initialBrandId={brandId}
              onBrandChange={onBrandChange}
              onReviewed={(key, rows) => {
                const values = {
                  deliveredQty: 0,
                  deliveredUnits: 0,
                  productCost: 0,
                  cancelledQty: 0,
                  partialQty: 0,
                  pendingQty: 0,
                  deliveredAmount: 0,
                  cancelledAmount: 0,
                  partialAmount: 0,
                  shipping: 0,
                  codCharge: 0,
                  deliveredCodCharge: 0,
                  partialCodCharge: 0,
                  ads: 0,
                };
                for (const row of rows) {
                  if (row.status === 'Delivered') {
                    values.deliveredQty++;
                    values.deliveredUnits += row.quantity;
                    values.deliveredAmount += row.codAmount;
                    values.deliveredCodCharge += row.codCharge;
                  } else if (row.status === 'Cancelled') {
                    values.cancelledQty++;
                    values.cancelledAmount += row.codAmount;
                  } else if (row.status === 'Partial Delivered') {
                    values.partialQty++;
                    values.partialAmount += row.codAmount;
                    values.partialCodCharge += row.codCharge;
                  } else values.pendingQty++;
                  if (row.status !== 'Pending') {
                    values.shipping += row.shipping;
                    values.codCharge += row.codCharge;
                  }
                }
                const makingCost = brands.find(
                  (brand) => brand.id === key,
                )?.makingCost;
                if (makingCost === null || makingCost === undefined) {
                  setError(
                    'Set this brand’s making cost before loading a courier file.',
                  );
                  return;
                }
                values.productCost = makingCost * values.deliveredUnits;
                const dates = rows.map((row) => row.orderDate).sort();
                const start = dates[0],
                  end = dates.at(-1);
                if (start !== undefined && end !== undefined)
                  load(key, start, end, values);
              }}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}
