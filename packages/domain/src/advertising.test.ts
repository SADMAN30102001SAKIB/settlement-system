import { expect, it } from 'vitest';
import { calculateAdvertising } from './advertising';
import { calculateSettlement } from './settlement';
import { parseMoney } from './money';

it('adds advertising VAT after the agency percentage, without deducting VAT from net', () => {
  const input = {
    rule: 'v3' as const,
    deliveredAmount: parseMoney('12000'),
    partialAmount: 0,
    cancelledAmount: 0,
    shipping: 0,
    codCharge: 0,
    ads: parseMoney('2000'),
    productCost: 0,
    agencyBasisPoints: 1500,
    vatBasisPoints: 1000,
    vatAddedToAgency: true,
  };
  expect(calculateSettlement(input)).toMatchObject({
    net: parseMoney('10000'),
    vat: parseMoney('200'),
    commission: parseMoney('1700'),
  });
  expect(
    calculateSettlement({ ...input, vatAddedToAgency: false }),
  ).toMatchObject({ net: parseMoney('9800'), commission: parseMoney('1470') });
});
it('keeps legacy advertising invoices at zero VAT and new ones at their saved rate', () => {
  expect(
    calculateAdvertising([parseMoney('1500'), parseMoney('500')], 1000),
  ).toEqual({
    subtotal: parseMoney('2000'),
    vat: parseMoney('200'),
    total: parseMoney('2200'),
  });
  expect(calculateAdvertising([parseMoney('2000')], 0).total).toBe(
    parseMoney('2000'),
  );
  expect(calculateAdvertising([parseMoney('0.29')], 1000).vat).toBe(
    parseMoney('0.03'),
  );
});
