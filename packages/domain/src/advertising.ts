import { percentage, sumMoney, toPaisaPrecision } from './money';

export function calculateAdvertising(
  amounts: readonly number[],
  vatBasisPoints: number,
) {
  const subtotal = sumMoney(amounts);
  const vat = toPaisaPrecision(percentage(subtotal, vatBasisPoints));
  return { subtotal, vat, total: sumMoney([subtotal, vat]) };
}
