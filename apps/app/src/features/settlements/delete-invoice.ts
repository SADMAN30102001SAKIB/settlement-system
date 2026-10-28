import { z } from 'zod';
import { api } from '../../lib/api';
import type { Confirmation } from '../../components/confirmation-context';

export async function confirmInvoiceDeletion(
  kind: 'settlements' | 'advertising',
  item: {
    id: string;
    brandId: string;
    brandName: string;
    invoiceNumber: string;
  },
  confirm: (options: Confirmation) => Promise<boolean>,
  navigate: (path: string) => void,
) {
  const result = await api(
    `/manage/${kind}/${item.id}/deletion`,
    z.object({
      allowed: z.boolean(),
      receipts: z.array(
        z.object({ id: z.string(), number: z.string(), shared: z.boolean() }),
      ),
      more: z.boolean(),
    }),
  );
  if (!result.allowed) {
    if (
      await confirm({
        title: 'Reverse linked payments first',
        message: `${item.invoiceNumber} has active receipt(s): ${result.receipts.map((r) => r.number).join(', ')}${result.more ? ' and more' : ''}. Reverse all active receipts in Payments, then return to delete this invoice. ${result.receipts.some((r) => r.shared) ? 'A linked receipt covers other invoices: reversing it also restores their outstanding balances. ' : ''}Receipt history will remain intact.`,
        action: 'View payments',
      })
    )
      navigate(`/payments/brand/${item.brandId}`);
    return false;
  }
  return confirm({
    title:
      kind === 'settlements'
        ? 'Delete settlement?'
        : 'Delete advertising invoice?',
    message: `Permanently delete ${item.invoiceNumber} for ${item.brandName}? Direct legacy payments are also removed; advertising account advances are retained and reallocated. Reversed receipt snapshots remain in payment history and identify the source as deleted. Other invoices are not deleted. This cannot be undone.`,
    action: kind === 'settlements' ? 'Delete settlement' : 'Delete invoice',
    destructive: true,
  });
}
