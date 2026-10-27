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
  return (
    <div className="invoice-row-actions">
      {(['View', 'Edit', 'Payment', 'PDF', 'Delete'] as const).map((action) => (
        <button
          key={action}
          className={`secondary compact ${action === 'Delete' ? 'danger-text' : ''}`}
          disabled={pending}
          onClick={() => {
            onAction(action);
          }}
        >
          {action}
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
