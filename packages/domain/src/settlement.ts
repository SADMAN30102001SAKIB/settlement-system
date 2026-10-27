import { assertMoney, percentage, sumMoney, toPaisaPrecision } from './money';

export interface SettlementInput {
  rule: 'legacy' | 'v2' | 'v3';
  deliveredCodCharge?: number;
  partialCodCharge?: number;
  vatBasisPoints?: number;
  vatAddedToAgency?: boolean;
  deductShipping?: boolean;
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
    input.rule === 'v3' && !input.deductShipping ? 0 : -input.shipping,
    input.rule === 'v3' ? -(input.deliveredCodCharge ?? 0) : -input.codCharge,
    input.rule === 'v3' ? -(input.partialCodCharge ?? 0) : 0,
  ]);
  for (const charge of [
    input.deliveredCodCharge ?? 0,
    input.partialCodCharge ?? 0,
  ]) {
    if (assertMoney(charge) < 0)
      throw new RangeError('COD charges cannot be negative.');
  }
  const vat =
    input.rule === 'v3'
      ? toPaisaPrecision(percentage(input.ads, input.vatBasisPoints ?? 1000))
      : 0;
  const adsTotal = sumMoney([input.ads, vat]);
  const net = sumMoney([
    gross,
    -(input.vatAddedToAgency ? input.ads : adsTotal),
    -input.productCost,
  ]);
  const commission =
    input.rule === 'v3'
      ? sumMoney([
          toPaisaPrecision(percentage(net, input.agencyBasisPoints)),
          input.vatAddedToAgency ? vat : 0,
        ])
      : percentage(net, input.agencyBasisPoints);
  return {
    gross,
    net,
    commission,
    vat,
    adsTotal,
    payable: toPaisaPrecision(commission),
  };
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
