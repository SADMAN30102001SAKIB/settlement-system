import { useState } from 'react';
import { z } from 'zod';
import {
  importColumns,
  mapOrder,
  parseDelimited,
} from '@settlement/domain/imports';
import type { ImportColumn } from '@settlement/domain/imports';
import { Alert, ErrorMessage, Field, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import type { Brand } from '../../lib/api';
import { money } from '../../lib/format';
import { readImport } from './import-file';
import { FilePicker } from '../../components/file-picker';

const labels = {
  id: 'Order ID',
  orderDate: 'Order date',
  deliveryDate: 'Delivery date',
  status: 'Delivery status',
  codAmount: 'COD amount',
  shipping: 'Shipping charge',
  codCharge: 'COD charge',
};
export function Importer({
  brands,
  onImported,
  onReviewed,
  initialBrandId = '',
  onBrandChange,
}: {
  brands: Brand[];
  initialBrandId?: string;
  onBrandChange?: (brandId: string) => void;
  onImported?: () => void;
  onReviewed?: (
    brandId: string,
    rows: ReturnType<typeof mapOrder>[],
  ) => boolean;
}) {
  const [brandId, setBrandId] = useState(initialBrandId);
  const [mode, setMode] = useState<'orders' | 'courier'>('courier');
  const [format, setFormat] = useState<'ISO' | 'DMY'>('ISO');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  const [header, setHeader] = useState(0);
  const [mapping, setMapping] = useState<
    Record<ImportColumn, number> & { quantity: number }
  >({
    quantity: -1,
    id: -1,
    orderDate: -1,
    deliveryDate: -1,
    status: -1,
    codAmount: -1,
    shipping: -1,
    codCharge: -1,
  });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [blankCodChargeIsZero, setBlankCodChargeIsZero] = useState(false);
  const [blankCodAmountIsZero, setBlankCodAmountIsZero] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [sourceName, setSourceName] = useState('Pasted spreadsheet');
  function loadRows(data: string[][]) {
    setRows(data);
    setHeader(0);
    setBlankCodChargeIsZero(false);
    setBlankCodAmountIsZero(false);
    const aliases: Record<ImportColumn, string[]> = {
      id: ['order id'],
      orderDate: ['created at', 'order date'],
      deliveryDate: ['delivery time', 'delivery date'],
      status: ['delivery status', 'status'],
      codAmount: ['cod amount'],
      shipping: ['shipping charge'],
      codCharge: ['cod charge'],
    };
    setMapping({
      quantity:
        data[0]?.findIndex((cell) =>
          ['quantity', 'qty', 'item quantity'].includes(
            cell.toLowerCase().trim(),
          ),
        ) ?? -1,
      id:
        data[0]?.findIndex((cell) =>
          aliases.id.includes(cell.toLowerCase().trim()),
        ) ?? -1,
      orderDate:
        data[0]?.findIndex((cell) =>
          aliases.orderDate.includes(cell.toLowerCase().trim()),
        ) ?? -1,
      deliveryDate:
        data[0]?.findIndex((cell) =>
          aliases.deliveryDate.includes(cell.toLowerCase().trim()),
        ) ?? -1,
      status:
        data[0]?.findIndex((cell) =>
          aliases.status.includes(cell.toLowerCase().trim()),
        ) ?? -1,
      codAmount:
        data[0]?.findIndex((cell) =>
          aliases.codAmount.includes(cell.toLowerCase().trim()),
        ) ?? -1,
      shipping:
        data[0]?.findIndex((cell) =>
          aliases.shipping.includes(cell.toLowerCase().trim()),
        ) ?? -1,
      codCharge:
        data[0]?.findIndex((cell) =>
          aliases.codCharge.includes(cell.toLowerCase().trim()),
        ) ?? -1,
    });
  }
  const seen = new Set<string>();
  const preview = rows.slice(header + 1).map((row, index) => {
    try {
      const order = mapOrder(
        row,
        mapping,
        format,
        mode,
        blankCodChargeIsZero,
        blankCodAmountIsZero,
      );
      if (seen.has(order.id))
        throw new Error('Duplicate order ID in this file.');
      seen.add(order.id);
      return { row: index + header + 2, order, error: '' };
    } catch (reason) {
      return {
        row: index + header + 2,
        order: null,
        error: ErrorMessage(reason),
      };
    }
  });
  const invalid = preview.some((row) => row.error);
  const blanks = (key: 'codAmount' | 'codCharge') =>
    mapping[key] < 0
      ? 0
      : rows.slice(header + 1).filter((row) => !row[mapping[key]]?.trim())
          .length;
  const modeConflict =
    mode === 'orders' &&
    rows
      .slice(header + 1)
      .some((row) =>
        [
          mapping.status,
          mapping.codAmount,
          mapping.shipping,
          mapping.codCharge,
        ].some((index) => index >= 0 && Boolean(row[index]?.trim())),
      );
  const valid = preview.flatMap((row) =>
    row.order === null ? [] : [row.order],
  );
  const reconciliation = valid.reduce(
    (sum, row) => ({
      cod: sum.cod + row.codAmount,
      shipping: sum.shipping + row.shipping,
      codCharge: sum.codCharge + row.codCharge,
      quantity: sum.quantity + row.quantity,
    }),
    { cod: 0, shipping: 0, codCharge: 0, quantity: 0 },
  );
  async function upload(file: File) {
    setPending(true);
    setError('');
    try {
      loadRows(await readImport(file));
      setSourceName(file.name);
      setMessage(
        /\.pdf$/i.test(file.name)
          ? 'Verified-layout PDF extracted. Check every mapped column and blank amount before confirming.'
          : 'Select the header row and map the source columns.',
      );
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  async function save() {
    if (
      pending ||
      !brandId ||
      invalid ||
      modeConflict ||
      !preview.length ||
      preview.length > 2000
    )
      return;
    setPending(true);
    setError('');
    try {
      if (onReviewed !== undefined) {
        const loaded = onReviewed(
          brandId,
          preview.flatMap((row) => (row.order === null ? [] : [row.order])),
        );
        if (!loaded) return;
        setMessage(
          'Verified rows loaded into the settlement form. Review and save the invoice below.',
        );
        setRows([]);
        return;
      }
      await api('/manage/business/import', z.object({ imported: z.number() }), {
        method: 'POST',
        body: {
          brandId,
          mode,
          rows: preview.flatMap((row) =>
            row.order === null ? [] : [row.order],
          ),
        },
      });
      setMessage(
        `${String(preview.length)} orders imported. Existing IDs were updated without duplicate orders or costs.`,
      );
      setRows([]);
      setText('');
      onImported?.();
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel importer">
      <h2>Import orders & courier updates</h2>
      <p className="muted">
        Files are parsed in your browser. Nothing is saved until you review and
        confirm. Existing order quantities, sales overrides and making-cost
        snapshots are preserved.
      </p>
      <div className="form-grid">
        <Field label="Brand">
          <select
            required
            value={brandId}
            onChange={(event) => {
              setBrandId(event.target.value);
              onBrandChange?.(event.target.value);
            }}
          >
            <option value="">Choose brand</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </Field>
        {onReviewed === undefined ? (
          <Field label="Import type">
            <select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value === 'orders' ? 'orders' : 'courier');
              }}
            >
              <option value="courier">Courier update</option>
              <option value="orders">
                Daily order IDs (does not replace courier status)
              </option>
            </select>
          </Field>
        ) : (
          <p className="muted">
            Courier outcomes: preserve statuses and collection amounts.
          </p>
        )}
        {!rows.length ? (
          <Field label="CSV / XLSX / PDF">
            <FilePicker
              accept=".csv,.tsv,.txt,.xlsx,.pdf"
              disabled={pending}
              onFile={(file) => {
                upload(file).catch((reason: unknown) => {
                  setError(ErrorMessage(reason));
                });
              }}
            />
          </Field>
        ) : null}
      </div>
      {!rows.length ? (
        <>
          <Field label="Or paste spreadsheet cells (including headers)">
            <textarea
              rows={5}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
              placeholder={
                'Order Date\tOrder ID\tDelivery Status\tDelivery Time\tCOD Amount\tShipping Charge\tCOD Charge'
              }
            />
          </Field>
          <button
            className="secondary"
            disabled={pending || !text.trim()}
            onClick={() => {
              try {
                loadRows(parseDelimited(text));
                setSourceName('Pasted spreadsheet');
                setError('');
              } catch (reason) {
                setError(ErrorMessage(reason));
              }
            }}
          >
            Preview pasted rows
          </button>
        </>
      ) : (
        <div className="import-source-bar">
          <div>
            <strong>{sourceName}</strong>
            <small className="muted">
              {rows.length - header - 1} source rows · review before confirming
            </small>
          </div>
          <button
            className="secondary compact"
            disabled={pending}
            onClick={() => {
              setRows([]);
              setError('');
              setMessage('');
            }}
          >
            Change source
          </button>
        </div>
      )}
      {message ? <p role="status">{message}</p> : null}
      {error ? <Alert>{error}</Alert> : null}
      {rows.length ? (
        <>
          <section className="import-options">
            <button
              className="secondary"
              aria-expanded={mappingOpen}
              onClick={() => {
                setMappingOpen(!mappingOpen);
              }}
            >
              Check date format & column mapping
            </button>
            {mappingOpen ? (
              <div className="form-grid">
                <Field label="Source date format">
                  <select
                    value={format}
                    onChange={(event) => {
                      setFormat(event.target.value === 'DMY' ? 'DMY' : 'ISO');
                    }}
                  >
                    <option value="ISO">
                      YYYY-MM-DD (including Excel dates)
                    </option>
                    <option value="DMY">DD/MM/YYYY</option>
                  </select>
                </Field>
                <Field label="Header row">
                  <select
                    value={header}
                    onChange={(event) => {
                      setHeader(Number(event.target.value));
                    }}
                  >
                    {rows.slice(0, 100).map((row, index) => (
                      <option key={index} value={index}>
                        Row {index + 1}: {row.join(' · ').slice(0, 120)}
                      </option>
                    ))}
                  </select>
                </Field>
                {importColumns
                  .filter(
                    (key) =>
                      mode === 'courier' || key === 'id' || key === 'orderDate',
                  )
                  .map((key) => (
                    <Field key={key} label={labels[key]}>
                      <select
                        value={mapping[key]}
                        onChange={(event) => {
                          setMapping((current) => ({
                            ...current,
                            [key]: Number(event.target.value),
                          }));
                        }}
                      >
                        <option value={-1}>Map a column</option>
                        {rows[header]?.map((cell, index) => (
                          <option key={index} value={index}>
                            {index + 1}: {cell}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                <Field
                  label="Item quantity column (optional)"
                  hint="Without a quantity column each parcel starts with one item. Correct multi-item orders before settling."
                >
                  <select
                    value={mapping.quantity}
                    onChange={(event) => {
                      setMapping((current) => ({
                        ...current,
                        quantity: Number(event.target.value),
                      }));
                    }}
                  >
                    <option value={-1}>One item per parcel</option>
                    {rows[header]?.map((cell, index) => (
                      <option key={index} value={index}>
                        {index + 1}: {cell}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : null}
          </section>
          {modeConflict ? (
            <Alert>
              This file contains courier statuses or financial amounts. Daily
              order-ID mode would ignore them.{' '}
              <button
                className="secondary"
                onClick={() => {
                  setMode('courier');
                }}
              >
                Use courier update
              </button>
            </Alert>
          ) : null}
          {mode === 'courier' ? (
            <div className="blank-decisions">
              {(['codCharge', 'codAmount'] as const)
                .filter((key) => blanks(key) > 0)
                .map((key) => (
                  <Field
                    key={key}
                    label={`${key === 'codCharge' ? 'Blank COD fees' : 'Blank COD collection'} · ${String(blanks(key))} rows`}
                    hint="A blank is not automatically zero. Only choose zero if that is what this export means."
                  >
                    <select
                      value={
                        (
                          key === 'codCharge'
                            ? blankCodChargeIsZero
                            : blankCodAmountIsZero
                        )
                          ? 'zero'
                          : 'unresolved'
                      }
                      onChange={(event) => {
                        (key === 'codCharge'
                          ? setBlankCodChargeIsZero
                          : setBlankCodAmountIsZero)(
                          event.target.value === 'zero',
                        );
                      }}
                    >
                      <option value="unresolved">
                        Keep unresolved — correct the source
                      </option>
                      <option value="zero">These blank cells mean ৳0</option>
                    </select>
                  </Field>
                ))}
            </div>
          ) : null}
          <section
            className="import-reconciliation"
            aria-label="Source reconciliation"
          >
            <h3>Compare with your source</h3>
            <p className="muted">
              {valid.length} valid rows · {preview.length - valid.length} rows
              need correction. Totals below include valid rows only; no rows are
              silently discarded.
            </p>
            <dl className="summary-grid">
              <div>
                <dt>Source COD total</dt>
                <dd>{money(reconciliation.cod)}</dd>
              </div>
              <div>
                <dt>Source delivery charges</dt>
                <dd>{money(reconciliation.shipping)}</dd>
              </div>
              <div>
                <dt>Source COD charges</dt>
                <dd>{money(reconciliation.codCharge)}</dd>
              </div>
              <div>
                <dt>Item quantity</dt>
                <dd>{reconciliation.quantity}</dd>
              </div>
            </dl>
          </section>
          <div
            className="table-scroll import-preview"
            role="region"
            aria-label="Imported order preview"
          >
            <table>
              <thead>
                <tr>
                  <th>Source row</th>
                  <th>Order date</th>
                  <th>Order ID</th>
                  <th>Status</th>
                  <th>Delivery time</th>
                  <th>COD</th>
                  <th>Shipping</th>
                  <th>COD charge</th>
                  <th>Item quantity</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{row.order?.orderDate ?? '—'}</td>
                    <td>{row.order?.id ?? '—'}</td>
                    <td>{row.order?.status ?? '—'}</td>
                    <td>{row.order?.deliveryDate ?? '—'}</td>
                    <td>{row.order ? money(row.order.codAmount) : '—'}</td>
                    <td>{row.order ? money(row.order.shipping) : '—'}</td>
                    <td>{row.order ? money(row.order.codCharge) : '—'}</td>
                    <td>{row.order?.quantity ?? '—'}</td>
                    <td>{row.error || 'Ready'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="import-footer">
            <p className="muted">
              Review the totals and rows above. Confirming updates existing IDs
              without duplicating orders.
            </p>
            <button
              className="primary"
              disabled={
                pending ||
                !brandId ||
                invalid ||
                !preview.length ||
                modeConflict ||
                preview.length > 2000
              }
              onClick={() => {
                save().catch((reason: unknown) => {
                  setError(ErrorMessage(reason));
                });
              }}
            >
              {pending ? (
                <>
                  <Spinner size={12} /> Importing…
                </>
              ) : onReviewed ? (
                'Confirm & use rows in settlement'
              ) : (
                `Confirm & import ${String(preview.length)} orders`
              )}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
