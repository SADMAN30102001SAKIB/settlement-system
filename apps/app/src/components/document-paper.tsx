import type { z } from 'zod';
import type { Settings } from '../lib/api';
import type { companySchema } from '../../shared/manual-invoices';
import { lineTotal } from '../../shared/manual-invoices';
import { dateLabel, money, amountInput } from '../lib/format';
import { InvoiceStamp } from './invoice-stamp';
export function DocumentPaper({
  title,
  number,
  date,
  recipient,
  lines,
  notes,
  total,
  settings,
  company = settings,
  fileBase = '/api/manage/files',
  stamp = null,
}: {
  title: string;
  number: string;
  date: string;
  recipient: string;
  lines: { description: string; quantityMilli: number; price: number }[];
  notes: string;
  total: number;
  settings: Settings;
  company?: z.infer<typeof companySchema>;
  fileBase?: string;
  stamp?: 'Paid' | 'Unpaid' | 'Due' | null;
}) {
  return (
    <article className="invoice-document">
      {settings.watermarkFileId ? (
        <img
          className="invoice-watermark"
          src={`${fileBase}/${settings.watermarkFileId}`}
          alt=""
        />
      ) : null}
      <header className="invoice-header">
        <div>
          <p className="eyebrow">{title}</p>
          <h1>{company.companyName}</h1>
          <p>{company.address}</p>
          <p>
            {company.phone} · {company.email}
          </p>
        </div>
        <span className="invoice-logo">H</span>
      </header>
      <div className="invoice-meta">
        <div>
          <small>DOCUMENT NUMBER</small>
          <strong>{number}</strong>
          <p>{recipient}</p>
        </div>
        {stamp ? (
          <InvoiceStamp
            settings={settings}
            fileBase={fileBase}
            status={stamp}
          />
        ) : null}
        <div>
          <small>DATE</small>
          <strong>{dateLabel(date)}</strong>
        </div>
      </div>
      <section>
        <h2>{title}</h2>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th className="numeric">Quantity</th>
              <th className="numeric">Unit price</th>
              <th className="numeric">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td>{line.description}</td>
                <td className="numeric">{amountInput(line.quantityMilli)}</td>
                <td className="numeric">{money(line.price)}</td>
                <td className="numeric">{money(lineTotal(line))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="invoice-final">
        <span>Total</span>
        <strong>{money(total)}</strong>
      </div>
      {notes ? <p className="receipt-note">{notes}</p> : null}
      <footer className="invoice-footer">
        <p>Prepared by {company.companyName}</p>
        <div className="signature-line">
          {settings.signatureFileId ? (
            <img
              className="invoice-signature"
              src={`${fileBase}/${settings.signatureFileId}`}
              alt="Authorized signature"
            />
          ) : null}
          <span className="signature-rule" />
          <span>{settings.signatureLabel}</span>
        </div>
      </footer>
    </article>
  );
}
