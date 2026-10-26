import { useRef, useState } from 'react';
import { calculateSettlement } from '@settlement/domain/settlement';
import type { AdInvoice, Report, Settings } from '../../lib/api';
import { dateLabel, money } from '../../lib/format';
import { Alert, ErrorMessage, PageHeading } from '../../components/ui';

export function Invoice({
  report,
  settings,
  onEdit,
  onBack,
}: {
  report: Report | AdInvoice;
  settings: Settings;
  onEdit: () => void;
  onBack: () => void;
}) {
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const documentRef = useRef<HTMLElement>(null);
  async function download() {
    if (documentRef.current === null || downloading) return;
    setDownloading(true);
    setError('');
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      await document.fonts.ready;
      let rowEdges: number[] = [];
      const canvas = await html2canvas(documentRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        windowWidth: 1200,
        onclone: (cloned) => {
          const invoice =
            cloned.querySelector<HTMLElement>('.invoice-document');
          if (invoice !== null) {
            invoice.style.width = '794px';
            invoice.style.maxWidth = 'none';
            invoice.style.margin = '0';
            invoice.style.boxShadow = 'none';
            const top = invoice.getBoundingClientRect().top;
            rowEdges = [
              ...invoice.querySelectorAll(
                'tr, .invoice-footer, .invoice-final, section h2',
              ),
            ].map((node) => node.getBoundingClientRect().top - top);
          }
        },
      });
      const advertising = 'campaigns' in report;
      const compactHeight = Math.max(
        100,
        Math.min(297, canvas.height * (186 / canvas.width) + 26),
      );
      const pdf = new jsPDF({
        unit: 'mm',
        orientation:
          advertising && compactHeight < 210 ? 'landscape' : 'portrait',
        format: advertising ? [210, compactHeight] : 'a4',
        compress: true,
      });
      const width = pdf.internal.pageSize.getWidth() - 24;
      const height = pdf.internal.pageSize.getHeight() - 24;
      const scale = width / canvas.width;
      const capacity = Math.floor(height / scale);
      let offset = 0;
      while (offset < canvas.height) {
        const remaining = canvas.height - offset;
        const target =
          remaining > capacity && remaining < capacity * 1.3
            ? offset + Math.floor(remaining / 2)
            : offset + capacity;
        let end = Math.min(canvas.height, target);
        if (end < canvas.height) {
          const boundary = rowEdges
            .map((edge) => Math.floor(edge * 2))
            .filter((edge) => edge > offset + capacity / 3 && edge <= end)
            .at(-1);
          if (boundary !== undefined) end = boundary;
        }
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = end - offset;
        const drawing = slice.getContext('2d');
        if (drawing === null)
          throw new Error(
            'This browser could not prepare the PDF. Use Print instead.',
          );
        drawing.drawImage(
          canvas,
          0,
          offset,
          canvas.width,
          slice.height,
          0,
          0,
          slice.width,
          slice.height,
        );
        if (offset > 0) pdf.addPage();
        if (offset > 0) {
          pdf.setFontSize(8);
          pdf.text(`${report.invoiceNumber} - continued`, 12, 8);
        }
        pdf.addImage(slice, 'PNG', 12, 12, width, slice.height * scale);
        offset = end;
      }
      const pageCount = pdf.getNumberOfPages();
      for (let page = 1; page <= pageCount; page++) {
        pdf.setPage(page);
        pdf.setFontSize(8);
        pdf.text(
          `Page ${String(page)} / ${String(pageCount)}`,
          pdf.internal.pageSize.getWidth() - 12,
          pdf.internal.pageSize.getHeight() - 6,
          { align: 'right' },
        );
      }
      await pdf.save(`${report.invoiceNumber}.pdf`, { returnPromise: true });
    } catch (reason) {
      setError(ErrorMessage(reason));
    } finally {
      setDownloading(false);
    }
  }
  function print() {
    try {
      window.print();
    } catch (reason) {
      setError(ErrorMessage(reason));
    }
  }
  const row = (label: string, value: number, total = false) => (
    <tr className={total ? 'invoice-total' : ''}>
      <td>{label}</td>
      <td>{money(value)}</td>
    </tr>
  );
  return (
    <>
      <div className="no-print">
        <PageHeading
          eyebrow="SETTLEMENTS / INVOICE"
          title={report.invoiceNumber}
          description={`${report.brandName} · ${report.period}`}
          action={
            <div className="actions">
              <button className="secondary" onClick={onBack}>
                Back
              </button>
              <button className="secondary" onClick={onEdit}>
                Edit report
              </button>
              <button className="secondary" onClick={print}>
                Print
              </button>
              <button
                className="primary"
                disabled={downloading}
                onClick={() => {
                  download().catch((reason: unknown) => {
                    setError(ErrorMessage(reason));
                  });
                }}
              >
                {downloading ? 'Preparing PDF…' : 'Download PDF'}
              </button>
            </div>
          }
        />
        {error ? <Alert>{error}</Alert> : null}
      </div>
      <article
        className={`invoice-document ${'campaigns' in report ? 'invoice-advertising' : 'invoice-settlement'}`}
        ref={documentRef}
      >
        {settings.watermarkFileId ? (
          <img
            className="invoice-watermark"
            src={`/api/manage/files/${settings.watermarkFileId}`}
            alt=""
          />
        ) : null}
        <header className="invoice-header">
          <div>
            <p className="eyebrow">
              {'campaigns' in report
                ? 'ADVERTISING COST INVOICE'
                : 'DELIVERY & SALES SETTLEMENT'}
            </p>
            <h1>{settings.companyName}</h1>
            <p>{settings.address}</p>
            <p>
              {settings.phone}
              {settings.phone && settings.email ? ' · ' : ''}
              {settings.email}
            </p>
          </div>
          <span className="invoice-logo">H</span>
        </header>
        <div className="invoice-meta">
          <div>
            <small>INVOICE NUMBER</small>
            <strong>{report.invoiceNumber}</strong>
            <p>{report.brandName}</p>
          </div>
          <div>
            <small>REPORT DATE</small>
            <strong>{dateLabel(report.date)}</strong>
            <p>{report.period}</p>
          </div>
        </div>
        {'campaigns' in report ? (
          <>
            <section>
              <h2>Campaign-wise advertising spend</h2>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Campaign</th>
                    <th>Amount spent</th>
                  </tr>
                </thead>
                <tbody>
                  {report.campaigns.map((line, index) => (
                    <tr key={index}>
                      <td>{index + 1}</td>
                      <td>{line.name}</td>
                      <td>{money(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <div className="invoice-final">
              <span>Total advertising cost</span>
              <strong>{money(report.total)}</strong>
            </div>
          </>
        ) : (
          <>
            <section>
              <h2>Delivery summary</h2>
              <table>
                <thead>
                  <tr>
                    <th>Particular</th>
                    <th>Parcels</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Delivered</td>
                    <td>{report.deliveredQty}</td>
                    <td>{money(report.deliveredAmount)}</td>
                  </tr>
                  <tr>
                    <td>Cancelled</td>
                    <td>{report.cancelledQty}</td>
                    <td>
                      {report.rule === 'legacy'
                        ? money(report.cancelledAmount)
                        : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td>Partial delivered</td>
                    <td>{report.partialQty}</td>
                    <td>{money(report.partialAmount)}</td>
                  </tr>
                  <tr>
                    <td>Pending</td>
                    <td>{report.pendingQty}</td>
                    <td>—</td>
                  </tr>
                </tbody>
              </table>
            </section>
            <section>
              <h2>Settlement calculation</h2>
              <table>
                <tbody>
                  {row('Delivered collection', report.deliveredAmount)}
                  {report.rule === 'legacy'
                    ? row('Less: cancelled amount', -report.cancelledAmount)
                    : null}
                  {row('Add: partial collection', report.partialAmount)}
                  {report.rule === 'v3' ? (
                    <>
                      {report.deductShipping
                        ? row('Less: delivery charges', -report.shipping)
                        : null}
                      {row(
                        'Less: delivered COD charges',
                        -report.deliveredCodCharge,
                      )}
                      {row(
                        'Less: partial COD charges',
                        -report.partialCodCharge,
                      )}
                    </>
                  ) : (
                    <>
                      {row('Less: shipping charges', -report.shipping)}
                      {row('Less: COD charges', -report.codCharge)}
                    </>
                  )}
                  {row('Gross settlement', report.gross, true)}
                  {row('Less: advertising cost', -report.ads)}
                  {report.rule === 'v3'
                    ? row(
                        `Less: advertising VAT (${String(report.vatBasisPoints / 100)}%)`,
                        -calculateSettlement(report).vat,
                      )
                    : null}
                  {row('Less: product cost', -report.productCost)}
                  {report.rule === 'v3' &&
                  report.deliveredUnits !== null &&
                  report.costPerPiece !== null ? (
                    <tr>
                      <td colSpan={2} className="invoice-cost-note">
                        {report.deliveredUnits} delivered items ×{' '}
                        {money(report.costPerPiece)} per item
                      </td>
                    </tr>
                  ) : null}
                  {row('Net amount', report.net, true)}
                </tbody>
              </table>
            </section>
            <div className="invoice-final">
              <span>Agency share · {report.agencyBasisPoints / 100}%</span>
              <strong>{money(report.commission)}</strong>
            </div>
          </>
        )}
        <footer className="invoice-footer">
          <p>
            Generated by {settings.companyName}
            <br />
            <small>
              {'rule' in report
                ? `Calculation version: ${report.rule}${report.rule === 'v3' ? (report.deductShipping ? ' / delivery deducted' : ' / original shipping rule') : ''} · `
                : ''}
              Amounts in BDT
            </small>
          </p>
          <div className="signature-line">
            {settings.signatureFileId ? (
              <img
                className="invoice-signature"
                src={`/api/manage/files/${settings.signatureFileId}`}
                alt="Authorized signature"
              />
            ) : null}
            {settings.signatureLabel}
          </div>
        </footer>
      </article>
    </>
  );
}
