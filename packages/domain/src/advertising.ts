import { percentage, sumMoney, toPaisaPrecision } from './money';

export const DEFAULT_ADVERTISING_VAT_BASIS_POINTS = 1500;

export function calculateAdvertising(
  amounts: readonly number[],
  vatBasisPoints: number,
) {
  const subtotal = sumMoney(amounts);
  const vat = toPaisaPrecision(percentage(subtotal, vatBasisPoints));
  return { subtotal, vat, total: sumMoney([subtotal, vat]) };
}
