import { useState } from 'react';
import { z } from 'zod';
import {
  importColumns,
  mapOrder,
  parseDelimited,
} from '@settlement/domain/imports';
import type { ImportColumn } from '@settlement/domain/imports';
import { Alert, ErrorMessage, Field } from '../../components/ui';
import { api } from '../../lib/api';
import type { Brand } from '../../lib/api';
import { money } from '../../lib/format';
import { readImport } from './import-file';

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
}: {
  brands: Brand[];
  onImported?: () => void;
  onReviewed?: (brandId: string, rows: ReturnType<typeof mapOrder>[]) => void;
}) {
  const [brandId, setBrandId] = useState('');
  const [mode, setMode] = useState<'orders' | 'courier'>('courier');
  const [format, setFormat] = useState<'ISO' | 'DMY'>('ISO');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  const [header, setHeader] = useState(0);
  const [mapping, setMapping] = useState<Record<ImportColumn, number>>({
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
  const [reviewed, setReviewed] = useState(false);
  const [message, setMessage] = useState('');
  const [blankCodChargeIsZero, setBlankCodChargeIsZero] = useState(false);
  const [blankCodAmountIsZero, setBlankCodAmountIsZero] = useState(false);
  function loadRows(data: string[][]) {
    setRows(data);
    setHeader(0);
    setReviewed(false);
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
  async function upload(file: File) {
    setPending(true);
    setError('');
    setReviewed(false);
    try {
      loadRows(await readImport(file));
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
    setPending(true);
    setError('');
    try {
      if (onReviewed !== undefined) {
        onReviewed(
          brandId,
          preview.flatMap((row) => (row.order === null ? [] : [row.order])),
        );
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
      setReviewed(false);
      onImported?.();
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel">
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
              setReviewed(false);
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
        <Field label="Import type">
          <select
            value={mode}
            onChange={(event) => {
              setMode(event.target.value === 'orders' ? 'orders' : 'courier');
              setReviewed(false);
            }}
          >
            <option value="courier">Courier update</option>
            <option value="orders">
              Daily order IDs (does not replace courier status)
            </option>
          </select>
        </Field>
        <Field label="Source date format">
          <select
            value={format}
            onChange={(event) => {
              setFormat(event.target.value === 'DMY' ? 'DMY' : 'ISO');
              setReviewed(false);
            }}
          >
            <option value="ISO">YYYY-MM-DD (including Excel dates)</option>
            <option value="DMY">DD/MM/YYYY</option>
          </select>
        </Field>
        <Field label="CSV / XLSX / PDF">
          <input
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.pdf"
            disabled={pending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file)
                upload(file).catch((reason: unknown) => {
                  setError(ErrorMessage(reason));
                });
              event.target.value = '';
            }}
          />
        </Field>
      </div>
      <Field label="Or paste spreadsheet cells (including headers)">
        <textarea
          rows={5}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          placeholder={
            'Order ID\tOrder Date\tDelivery Date\tStatus\tCOD Amount\tShipping Charge\tCOD Charge'
          }
        />
      </Field>
      <button
        className="secondary"
        disabled={pending || !text.trim()}
        onClick={() => {
          try {
            loadRows(parseDelimited(text));
            setReviewed(false);
            setError('');
          } catch (reason) {
            setError(ErrorMessage(reason));
          }
        }}
      >
        Preview pasted rows
      </button>
      {message ? <p role="status">{message}</p> : null}
      {error ? <Alert>{error}</Alert> : null}
      {rows.length ? (
        <>
          <div className="form-grid">
            <Field label="Header row">
              <select
                value={header}
                onChange={(event) => {
                  setHeader(Number(event.target.value));
                  setReviewed(false);
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
                      setReviewed(false);
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
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={blankCodChargeIsZero}
              onChange={(event) => {
                setBlankCodChargeIsZero(event.target.checked);
                setReviewed(false);
              }}
            />
            I explicitly confirm that blank COD-charge cells in this export mean
            ৳0. Otherwise leave unchecked and correct the source file.
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={blankCodAmountIsZero}
              onChange={(event) => {
                setBlankCodAmountIsZero(event.target.checked);
                setReviewed(false);
              }}
            />
            I explicitly confirm that blank COD-amount cells mean ৳0 collected.
            Otherwise correct the source file.
          </label>
          <div className="table-scroll import-preview">
            <table>
              <thead>
                <tr>
                  <th>Source row</th>
                  <th>Order ID</th>
                  <th>Order date</th>
                  <th>Status</th>
                  <th>COD</th>
                  <th>Shipping</th>
                  <th>COD charge</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{row.order?.id ?? '—'}</td>
                    <td>{row.order?.orderDate ?? '—'}</td>
                    <td>{row.order?.status ?? '—'}</td>
                    <td>{row.order ? money(row.order.codAmount) : '—'}</td>
                    <td>{row.order ? money(row.order.shipping) : '—'}</td>
                    <td>{row.order ? money(row.order.codCharge) : '—'}</td>
                    <td>{row.error || 'Ready'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => {
                setReviewed(event.target.checked);
              }}
            />
            I checked the dates, IDs, status and amounts against the source.
          </label>
          <button
            className="primary"
            disabled={
              pending ||
              !brandId ||
              invalid ||
              !preview.length ||
              !reviewed ||
              preview.length > 2000
            }
            onClick={() => {
              save().catch((reason: unknown) => {
                setError(ErrorMessage(reason));
              });
            }}
          >
            {pending
              ? 'Importing…'
              : onReviewed
                ? 'Use verified rows in settlement'
                : `Import ${String(preview.length)} orders`}
          </button>
        </>
      ) : null}
    </section>
  );
}
