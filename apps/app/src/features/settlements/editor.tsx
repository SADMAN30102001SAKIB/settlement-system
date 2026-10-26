import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { parseMoney, parsePercentage } from '@settlement/domain/money';
import {
  calculateSettlement,
  settlementProductCost,
} from '@settlement/domain/settlement';
import { z } from 'zod';

import { Alert, ErrorMessage, Field, PageHeading } from '../../components/ui';
import { api, reportSchema } from '../../lib/api';
import type { Brand, Report, Settings } from '../../lib/api';
import { amountInput, money, today } from '../../lib/format';
import { SettlementSource } from './source';

const countFields = [
  ['deliveredQty', 'Delivered parcels'],
  ['cancelledQty', 'Cancelled parcels'],
  ['partialQty', 'Partial parcels'],
  ['pendingQty', 'Pending parcels'],
] as const;
const moneyFields = [
  ['deliveredAmount', 'Delivered amount'],
  ['partialAmount', 'Partial collection'],
  ['shipping', 'Shipping charges'],
  ['codCharge', 'COD charges'],
  ['ads', 'Advertising cost'],
] as const;
const initial = {
  date: today(),
  period: '',
  brandId: '',
  deliveredQty: '0',
  cancelledQty: '0',
  partialQty: '0',
  pendingQty: '0',
  deliveredAmount: '0',
  cancelledAmount: '0',
  partialAmount: '0',
  shipping: '0',
  codCharge: '0',
  deliveredCodCharge: '0',
  partialCodCharge: '0',
  vatPercentage: '10',
  ads: '0',
  productCost: '0',
  percentage: '15',
};

export function ReportEditor({
  report,
  brands,
  settings,
  onSaved,
  onCancel,
}: {
  report: Report | null;
  brands: Brand[];
  settings: Settings;
  onSaved: (report: Report) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(() =>
    report
      ? {
          date: report.date,
          period: report.period,
          brandId: report.brandId,
          deliveredQty: String(report.deliveredQty),
          cancelledQty: String(report.cancelledQty),
          partialQty: String(report.partialQty),
          pendingQty: String(report.pendingQty),
          deliveredAmount: amountInput(report.deliveredAmount),
          cancelledAmount: amountInput(report.cancelledAmount),
          partialAmount: amountInput(report.partialAmount),
          shipping: amountInput(report.shipping),
          codCharge: amountInput(report.codCharge),
          deliveredCodCharge: amountInput(report.deliveredCodCharge),
          partialCodCharge: amountInput(report.partialCodCharge),
          vatPercentage: String(report.vatBasisPoints / 100),
          ads: amountInput(report.ads),
          productCost: amountInput(report.productCost),
          percentage: String(report.agencyBasisPoints / 100),
        }
      : {
          ...initial,
          date: today(),
          percentage: String(settings.agencyBasisPoints / 100),
        },
  );
  const [autoCost, setAutoCost] = useState(report === null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  function update(key: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setError('');
  }
  const brand = brands.find((item) => item.id === values.brandId);
  const rule = report?.rule ?? 'v3';
  const isV3 = rule === 'v3';
  function input() {
    const count = (value: string) => {
      const parsed = Number(value);
      if (
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(parsed) ||
        parsed > 1_000_000
      )
        throw new Error('Parcel counts must be nonnegative whole numbers.');
      return parsed;
    };
    const deliveredQty = count(values.deliveredQty),
      cancelledQty = count(values.cancelledQty),
      partialQty = count(values.partialQty);
    const makingCost = brand?.makingCost ?? null;
    if (autoCost && makingCost === null)
      throw new Error(
        'Set this brand’s making cost or enter product cost manually.',
      );
    const productCost =
      autoCost && makingCost !== null
        ? settlementProductCost(
            makingCost,
            deliveredQty,
            isV3 ? 0 : cancelledQty,
            isV3 ? 0 : partialQty,
          )
        : parseMoney(values.productCost);
    const agencyBasisPoints = parsePercentage(values.percentage);
    return {
      brandId: values.brandId,
      date: values.date,
      period: values.period,
      rule,
      deliveredQty,
      cancelledQty,
      partialQty,
      pendingQty: count(values.pendingQty),
      deliveredAmount: parseMoney(values.deliveredAmount),
      cancelledAmount: parseMoney(values.cancelledAmount),
      partialAmount: parseMoney(values.partialAmount),
      shipping: parseMoney(values.shipping),
      codCharge: parseMoney(values.codCharge),
      deliveredCodCharge: parseMoney(values.deliveredCodCharge),
      partialCodCharge: parseMoney(values.partialCodCharge),
      vatBasisPoints: parsePercentage(values.vatPercentage),
      ads: parseMoney(values.ads),
      productCost,
      costPerPiece: autoCost ? makingCost : (report?.costPerPiece ?? null),
      agencyBasisPoints,
    };
  }
  let calculation = null;
  let productCost = 0;
  try {
    const data = input();
    productCost = data.productCost;
    calculation = calculateSettlement(data);
  } catch {
    /* Incomplete form fields are shown as an unavailable preview. */
  }
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      const body = input();
      if (!body.brandId) throw new Error('Select a brand.');
      if (!body.period.trim()) throw new Error('Enter the settlement period.');
      const result = await api(
        `/manage/settlements${report ? `/${report.id}` : ''}`,
        z.object({ item: reportSchema }),
        {
          method: report ? 'PUT' : 'POST',
          body: { ...body, ...(report ? { revision: report.revision } : {}) },
        },
      );
      onSaved(result.item);
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="SETTLEMENTS / REPORT"
        title={report ? 'Edit settlement' : 'A clear path to settlement'}
        description={
          report
            ? `${report.invoiceNumber} · Saved calculation rules are preserved.`
            : 'Enter verified totals. Review the calculation. Save a professional invoice.'
        }
        action={
          <button className="secondary" onClick={onCancel}>
            Back to reports
          </button>
        }
      />
      {report === null ? (
        <SettlementSource
          brands={brands}
          brandId={values.brandId}
          onBrandChange={(value) => {
            update('brandId', value);
          }}
          onLoad={(source) => {
            setValues((current) => ({ ...current, ...source }));
            setAutoCost(true);
            setError('');
          }}
        />
      ) : null}
      <form
        className="editor-layout settlement-editor"
        onSubmit={(event) => {
          submit(event).catch((reason: unknown) => {
            setError(ErrorMessage(reason));
          });
        }}
      >
        <div className="form-sections">
          <section className="panel">
            <div className="section-heading">
              <h2>
                <span className="step">01</span> Brand & period
              </h2>
              <span className="pill">{rule} calculation</span>
            </div>
            <div className="form-grid settlement-identity">
              <Field label="Brand">
                <select
                  value={values.brandId}
                  onChange={(event) => {
                    update('brandId', event.target.value);
                  }}
                  required
                >
                  <option value="">Choose a brand</option>
                  {brands.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Report date">
                <input
                  type="date"
                  value={values.date}
                  onChange={(event) => {
                    update('date', event.target.value);
                  }}
                  required
                />
              </Field>
              <Field
                label="Settlement period"
                hint="Printed on the invoice exactly as entered."
              >
                <input
                  value={values.period}
                  onChange={(event) => {
                    update('period', event.target.value);
                  }}
                  required
                  maxLength={120}
                  placeholder="e.g. 21–26 October 2026"
                />
              </Field>
            </div>
          </section>
          <section className="panel">
            <h2>
              <span className="step">02</span> Verify delivery totals
            </h2>
            <p className="muted">
              Pending parcels are counted separately. Check totals against your
              courier report.
            </p>
            <div className="form-grid settlement-counts">
              {countFields.map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={values[key]}
                    onChange={(event) => {
                      update(key, event.target.value);
                    }}
                  />
                </Field>
              ))}
            </div>
            <div className="form-grid settlement-amounts">
              {moneyFields
                .filter(
                  ([key]) =>
                    !isV3 || (key !== 'shipping' && key !== 'codCharge'),
                )
                .map(([key, label]) => (
                  <Field key={key} label={`${label} (৳)`}>
                    <input
                      inputMode="decimal"
                      required
                      value={values[key]}
                      onChange={(event) => {
                        update(key, event.target.value);
                      }}
                    />
                  </Field>
                ))}
              {isV3
                ? (['deliveredCodCharge', 'partialCodCharge'] as const).map(
                    (key) => (
                      <Field
                        key={key}
                        label={
                          key === 'deliveredCodCharge'
                            ? 'Delivered COD charges (৳)'
                            : 'Partial COD charges (৳)'
                        }
                      >
                        <input
                          inputMode="decimal"
                          required
                          value={values[key]}
                          onChange={(event) => {
                            update(key, event.target.value);
                          }}
                        />
                      </Field>
                    ),
                  )
                : null}
              {report?.rule === 'legacy' ? (
                <Field label="Cancelled amount (৳)">
                  <input
                    inputMode="decimal"
                    value={values.cancelledAmount}
                    onChange={(event) => {
                      update('cancelledAmount', event.target.value);
                    }}
                    required
                  />
                </Field>
              ) : null}
            </div>
          </section>
          <section className="panel">
            <h2>
              <span className="step">03</span> Product cost & agency share
            </h2>
            <label className="check-field">
              <input
                type="checkbox"
                checked={autoCost}
                onChange={(event) => {
                  setAutoCost(event.target.checked);
                  setError('');
                }}
              />{' '}
              Calculate product cost from brand making cost
            </label>
            <p className="muted">
              {isV3
                ? 'Making cost × delivered parcels only. Partial, cancelled and pending parcels have no product-cost deduction.'
                : 'Making cost × delivered, cancelled and partial parcel counts. Pending parcels are excluded.'}
            </p>
            <div className="form-grid">
              <Field label="Product cost (৳)">
                <input
                  inputMode="decimal"
                  required
                  readOnly={autoCost}
                  value={
                    autoCost ? amountInput(productCost) : values.productCost
                  }
                  onChange={(event) => {
                    update('productCost', event.target.value);
                  }}
                />
              </Field>
              <Field label="Agency percentage (%)">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  required
                  value={values.percentage}
                  onChange={(event) => {
                    update('percentage', event.target.value);
                  }}
                />
              </Field>
              {isV3 ? (
                <Field label="Advertising VAT (%)">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    required
                    value={values.vatPercentage}
                    onChange={(event) => {
                      update('vatPercentage', event.target.value);
                    }}
                  />
                </Field>
              ) : null}
            </div>
          </section>
        </div>
        <aside className="panel calculation">
          <p className="eyebrow">LIVE CALCULATION</p>
          <h2>Review & save</h2>
          <section
            className="calculation-breakdown"
            aria-label="Calculation breakdown"
          >
            <dl>
              <div>
                <dt>Delivered</dt>
                <dd>
                  {values.deliveredAmount ? `৳${values.deliveredAmount}` : '—'}
                </dd>
              </div>
              <div>
                <dt>Partial collection</dt>
                <dd>
                  {values.partialAmount ? `৳${values.partialAmount}` : '—'}
                </dd>
              </div>
              {!isV3 ? (
                <div>
                  <dt>Shipping</dt>
                  <dd>−৳{values.shipping || '0'}</dd>
                </div>
              ) : null}
              {!isV3 ? (
                <div>
                  <dt>COD charges</dt>
                  <dd>−৳{values.codCharge || '0'}</dd>
                </div>
              ) : (
                <>
                  <div>
                    <dt>Delivered COD charges</dt>
                    <dd>−৳{values.deliveredCodCharge || '0'}</dd>
                  </div>
                  <div>
                    <dt>Partial COD charges</dt>
                    <dd>−৳{values.partialCodCharge || '0'}</dd>
                  </div>
                </>
              )}
              <div className="total-row">
                <dt>Gross settlement</dt>
                <dd>{calculation ? money(calculation.gross) : '—'}</dd>
              </div>
              <div>
                <dt>Advertising</dt>
                <dd>−৳{values.ads || '0'}</dd>
              </div>
              <div>
                <dt>Product cost</dt>
                <dd>{calculation ? money(-productCost) : '—'}</dd>
              </div>
              {isV3 ? (
                <div>
                  <dt>Advertising VAT · {values.vatPercentage}%</dt>
                  <dd>{calculation ? money(-calculation.vat) : '—'}</dd>
                </div>
              ) : null}
              <div className="total-row">
                <dt>Net amount</dt>
                <dd>{calculation ? money(calculation.net) : '—'}</dd>
              </div>
            </dl>
          </section>
          <div className="commission">
            <span>Agency share · {values.percentage}%</span>
            <strong>{calculation ? money(calculation.commission) : '—'}</strong>
          </div>
          {calculation && calculation.net < 0 ? (
            <p className="warning-text">
              This settlement records a loss. Its signed commission is
              preserved.
            </p>
          ) : null}
          {error ? <Alert>{error}</Alert> : null}
          <button
            className="primary full"
            disabled={pending || brands.length === 0}
          >
            {pending ? 'Saving…' : 'Save & view invoice'}
            <span aria-hidden="true">→</span>
          </button>
          <p className="caption">
            {isV3
              ? 'Advertising VAT is applied once. Shipping is already included in courier collection; it is not deducted again.'
              : 'No VAT is added under this saved calculation version.'}
          </p>
        </aside>
      </form>
    </>
  );
}
