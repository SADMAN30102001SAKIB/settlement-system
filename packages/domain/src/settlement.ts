import { assertMoney, percentage, sumMoney, toPaisaPrecision } from './money';

export interface SettlementInput {
  rule: 'legacy' | 'v2';
  deliveredAmount: number;
  cancelledAmount: number;
  partialAmount: number;
  shipping: number;
  codCharge: number;
  ads: number;
  productCost: number;
  agencyBasisPoints: number;
}

export function calculateSettlement(input: SettlementInput) {
  for (const value of [
    input.deliveredAmount,
    input.cancelledAmount,
    input.partialAmount,
    input.shipping,
    input.codCharge,
    input.ads,
    input.productCost,
  ]) {
    if (assertMoney(value) < 0)
      throw new RangeError('Settlement inputs cannot be negative.');
  }
  const gross = sumMoney([
    input.deliveredAmount,
    input.partialAmount,
    input.rule === 'legacy' ? -input.cancelledAmount : 0,
    -input.shipping,
    -input.codCharge,
  ]);
  const net = sumMoney([gross, -input.ads, -input.productCost]);
  const commission = percentage(net, input.agencyBasisPoints);
  return { gross, net, commission, payable: toPaisaPrecision(commission) };
}

export function settlementProductCost(
  costPerPiece: number,
  delivered: number,
  cancelled: number,
  partial: number,
): number {
  for (const count of [delivered, cancelled, partial]) {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new RangeError('Parcel counts must be nonnegative integers.');
  }
  if (assertMoney(costPerPiece) < 0)
    throw new RangeError('Making cost cannot be negative.');
  return assertMoney(costPerPiece * (delivered + cancelled + partial));
}
