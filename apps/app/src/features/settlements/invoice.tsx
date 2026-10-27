import { downloadDocument } from '../../lib/pdf';
import { useEffect, useRef, useState } from 'react';
import { calculateSettlement } from '@settlement/domain/settlement';
import { calculateAdvertising } from '@settlement/domain/advertising';
import type { AdInvoice, Report, Settings } from '../../lib/api';
import { dateLabel, money } from '../../lib/format';
import { Alert, ErrorMessage, PageHeading, Spinner } from '../../components/ui';
import { InvoiceStamp } from '../../components/invoice-stamp';
import { paymentStatus } from '@settlement/domain/payments';

export function Invoice({
  report,
  settings,
  onEdit,
  onBack,
  onDelete,
  autoDownload = false,
}: {
  report: Report | AdInvoice;
  settings: Settings;
  onEdit: () => void;
  onBack: () => void;
  onDelete: () => void;
  autoDownload?: boolean;
}) {
  const downloadButton = useRef<HTMLButtonElement>(null);
  const downloadStarted = useRef(false);
  useEffect(() => {
    if (autoDownload && !downloadStarted.current) {
      downloadStarted.current = true;
      downloadButton.current?.click();
    }
  }, [autoDownload]);
  const [moreOpen, setMoreOpen] = useState(false);
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !more.current?.contains(event.target))
        setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoreOpen(false);
        more.current?.querySelector('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [moreOpen]);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const documentRef = useRef<HTMLElement>(null);
  async function download() {
    if (documentRef.current === null || downloading) return;
    setDownloading(true);
    setError('');
    try {
      await downloadDocument(
        documentRef.current,
        report.invoiceNumber,
        'campaigns' in report,
      );
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
              <div className="invoice-more" ref={more}>
                <button
                  className="secondary"
                  aria-expanded={moreOpen}
                  onClick={() => {
                    setMoreOpen(!moreOpen);
                  }}
                >
                  More actions
                </button>
                {moreOpen ? (
                  <div className="invoice-action-popover">
                    <p className="caption">Invoice management</p>
                    <button
                      className="text-button danger-text"
                      onClick={() => {
                        setMoreOpen(false);
                        onDelete();
                      }}
                    >
                      {'campaigns' in report
                        ? 'Delete invoice'
                        : 'Delete settlement'}
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                className="primary"
                ref={downloadButton}
                disabled={downloading}
                onClick={() => {
                  download().catch((reason: unknown) => {
                    setError(ErrorMessage(reason));
                  });
                }}
              >
                {downloading ? (
                  <>
                    <Spinner size={12} /> Preparing PDF…
                  </>
                ) : (
                  'Download PDF'
                )}
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
          <InvoiceStamp
            status={
              report.statusOverride ??
              paymentStatus(
                'campaigns' in report ? report.total : report.commission,
                report.paid,
              ).status
            }
            settings={settings}
          />
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
            <table className="invoice-ad-totals">
              <tbody>
                {row(
                  'Advertising subtotal',
                  calculateAdvertising(
                    report.campaigns.map((line) => line.amount),
                    report.vatBasisPoints,
                  ).subtotal,
                )}
                {row(
                  `Advertising VAT (${String(report.vatBasisPoints / 100)}%)`,
                  calculateAdvertising(
                    report.campaigns.map((line) => line.amount),
                    report.vatBasisPoints,
                  ).vat,
                )}
              </tbody>
            </table>
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
                  {report.rule === 'v3' && !report.vatAddedToAgency
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
              <span>
                Agency share · {report.agencyBasisPoints / 100}%
                {report.vatAddedToAgency ? ' + advertising VAT' : ''}
              </span>
              <strong>{money(report.commission)}</strong>
            </div>
            {report.vatAddedToAgency ? (
              <table>
                <tbody>
                  {row(
                    'Agency percentage on net',
                    report.commission - calculateSettlement(report).vat,
                  )}
                  {row('Add: advertising VAT', calculateSettlement(report).vat)}
                </tbody>
              </table>
            ) : null}
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
            <span className="signature-rule" />
            <span>{settings.signatureLabel}</span>
          </div>
        </footer>
      </article>
    </>
  );
}
