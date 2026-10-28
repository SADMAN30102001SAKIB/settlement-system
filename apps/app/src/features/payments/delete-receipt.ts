import type { Confirmation } from '../../components/confirmation-context';
import type { PaymentReceipt } from '../../../shared/receipts';
import { api, okSchema } from '../../lib/api';

export async function deleteReceipt(
  receipt: PaymentReceipt,
  confirm: (options: Confirmation) => Promise<boolean>,
) {
  if (receipt.reversedAt === null)
    throw new Error('Reverse the receipt before deleting it.');
  if (
    !(await confirm({
      title: 'Permanently delete reversed receipt?',
      message: `Delete ${receipt.number} for ${receipt.data.brandName}? This permanently removes its receipt contents, allocation history and reversal reason. Download its PDF first if you need a copy. Balances and original invoices will not change. Uploaded proof files stay in Private files. This cannot be undone.`,
      action: 'Delete receipt',
      destructive: true,
    }))
  )
    return false;
  await api(`/manage/receipts/${receipt.id}`, okSchema, {
    method: 'DELETE',
    body: { receiptNumber: receipt.number },
  });
  return true;
}
