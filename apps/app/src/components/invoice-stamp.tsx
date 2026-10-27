import type { InvoiceStatus } from '../../shared/invoice-status';
import type { Settings } from '../lib/api';

export function InvoiceStamp({
  status,
  settings,
}: {
  status: InvoiceStatus;
  settings: Settings;
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
      src={`/api/manage/files/${file}`}
      alt={`${status} stamp`}
    />
  ) : null;
}
