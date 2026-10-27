import { useEffect, useRef } from 'react';
import type { AdInvoice, Payment, Report, Settings } from '../../lib/api';
import { Invoice } from './invoice';
import { PaymentsPanel } from '../payments/panel';

export function InvoiceRowActions({
  pending,
  onAction,
}: {
  pending: boolean;
  onAction: (action: 'View' | 'Edit' | 'Payment' | 'PDF' | 'Delete') => void;
}) {
  const paths = {
    View: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    Edit: 'm15 4 5 5M4 20l5-1L21 7a2.1 2.1 0 0 0-5-3L4 16l-1 5Z',
    Payment: 'M3 7h17v13H3V7Zm0 0V4h15v3m-3 5h6v5h-6v-5Zm3 2v1',
    PDF: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    Delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  };
  return (
    <div className="invoice-row-actions">
      {(['View', 'Edit', 'Payment', 'PDF', 'Delete'] as const).map((action) => (
        <button
          key={action}
          className={`secondary compact invoice-icon-action ${action === 'Delete' ? 'danger-text' : ''}`}
          aria-label={action}
          data-tooltip={
            action === 'PDF'
              ? 'Download PDF'
              : action === 'Payment'
                ? 'Record payment'
                : action
          }
          disabled={pending}
          onClick={() => {
            onAction(action);
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={paths[action]} />
          </svg>
        </button>
      ))}
    </div>
  );
}

export function InvoiceActionDialog({
  detail,
  mode,
  settings,
  onClose,
  onEdit,
  onDelete,
  refresh,
}: {
  detail: { item: Report | AdInvoice; payments: Payment[] } | null;
  mode: 'view' | 'pdf' | 'payment';
  settings: Settings;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  refresh: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (detail) dialog.current?.showModal();
    else dialog.current?.close();
  }, [detail]);
  return (
    <dialog
      ref={dialog}
      className="business-dialog invoice-dialog"
      onCancel={onClose}
    >
      <header className="business-dialog-heading">
        <h2>
          {mode === 'payment' ? 'Record invoice payment' : 'Invoice preview'}
        </h2>
        <button className="secondary compact" onClick={onClose}>
          Close
        </button>
      </header>
      {detail ? (
        <div className="invoice-dialog-body">
          {mode === 'payment' ? (
            <PaymentsPanel
              key={detail.item.id}
              brandName={detail.item.brandName}
              target={{
                kind: 'campaigns' in detail.item ? 'ads' : 'settlement',
                targetId: detail.item.id,
              }}
              total={
                'campaigns' in detail.item
                  ? detail.item.total
                  : detail.item.commission
              }
              paid={detail.item.paid}
              payments={detail.payments}
              refresh={refresh}
            />
          ) : (
            <Invoice
              key={detail.item.id}
              autoDownload={mode === 'pdf'}
              report={detail.item}
              settings={settings}
              onBack={onClose}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          )}
        </div>
      ) : null}
    </dialog>
  );
}
