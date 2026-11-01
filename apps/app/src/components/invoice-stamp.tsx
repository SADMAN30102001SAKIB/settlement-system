import type { InvoiceStatus } from '../../shared/invoice-status';
import type { Settings } from '../lib/api';

export function InvoiceStamp({
  status,
  settings,
  fileBase = '/api/manage/files',
}: {
  status: InvoiceStatus;
  settings: Settings;
  fileBase?: string;
}) {
  const file =
    status === 'Paid'
      ? settings.paidStampFileId
      : status === 'Unpaid'
        ? settings.unpaidStampFileId
        : status === 'Due'
          ? settings.dueStampFileId
          : null;
  return file ? (
    <img
      className="invoice-stamp"
      src={`${fileBase}/${file}`}
      alt={`${status} stamp`}
    />
  ) : null;
}
