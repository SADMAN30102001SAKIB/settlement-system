import { describe, expect, it } from 'vitest';

import {
  allocateDailyAds,
  moneyInput,
  parseMoney,
  parsePercentage,
  percentage,
  sumMoney,
  toPaisaPrecision,
} from './money';
import { allocateBrandPayments, paymentStatus } from './payments';
import { calculateProfit, orderFinancials } from './profit';
import { calculateSettlement, settlementProductCost } from './settlement';

const settlement = {
  rule: 'v2' as const,
  deliveredAmount: parseMoney('2069305'),
  cancelledAmount: parseMoney('392223'),
  partialAmount: parseMoney('72987'),
  shipping: parseMoney('227245'),
  codCharge: parseMoney('21422.92'),
  ads: parseMoney('356356'),
  productCost: parseMoney('730350'),
  agencyBasisPoints: 1500,
};
const order = {
  status: 'Delivered' as const,
  quantity: 1,
  partialQuantity: null,
  costPerPiece: parseMoney('450'),
  salesOverride: null,
  codAmount: parseMoney('1280'),
  shipping: parseMoney('115'),
  codCharge: parseMoney('12.8'),
  ads: parseMoney('100'),
};

describe('decimal-safe money', () => {
  it.each([
    ['0.29', 29],
    ['1.1', 110],
    ['15.25', 1525],
    ['100', 10000],
    ['0', 0],
  ] as const)('parses percentage %s exactly', (input, expected) => {
    expect(parsePercentage(input)).toBe(expected);
  });
  it.each(['', '-1', '100.01', '0.001', '1e1', 'Infinity', 'abc'])(
    'rejects invalid percentage %s',
    (input) => {
      expect(() => parsePercentage(input)).toThrow(RangeError);
    },
  );
  it.each(['0', '0.001', '123.456', '-12.345', '999999.999'])(
    'round trips %s',
    (value) => {
      expect(moneyInput(parseMoney(value))).toBe(value);
    },
  );
  it('parses BDT formatting without binary fractional errors', () => {
    expect(parseMoney('৳1,21,037.712')).toBe(121037712);
    expect(sumMoney([parseMoney('0.1'), parseMoney('0.2')])).toBe(300);
  });
  it.each(['', '1e3', 'abc', '1.2345', 'Infinity', '1foo', '9999999999999999'])(
    'rejects malformed or unsafe amount %s',
    (value) => {
      expect(() => parseMoney(value)).toThrow(RangeError);
    },
  );
  it('rounds payable balances consistently to paisa', () => {
    expect(toPaisaPrecision(121037712)).toBe(121037710);
    expect(toPaisaPrecision(-1166075)).toBe(-1166080);
  });
  it('rejects invalid percentages', () => {
    expect(() => percentage(1000, 10001)).toThrow(RangeError);
    expect(() => percentage(1000, 1.5)).toThrow(RangeError);
  });
  it('conserves the exact advertising expense including the remainder', () => {
    const ids = Array.from({ length: 330 }, (_, index) => String(index));
    const allocated = allocateDailyAds(parseMoney('34802'), ids);
    expect(allocated.get('0')).toBe(parseMoney('105.46'));
    expect(allocated.get('329')).toBe(parseMoney('105.66'));
    expect(sumMoney([...allocated.values()])).toBe(parseMoney('34802'));
  });
  it('handles empty/small allocations without negative balances', () => {
    expect(allocateDailyAds(1000, []).size).toBe(0);
    const values = [...allocateDailyAds(10, ['a', 'b', 'c']).values()];
    expect(values.every((value) => value >= 0)).toBe(true);
    expect(sumMoney(values)).toBe(10);
    expect(() => allocateDailyAds(1000, ['a', 'a'])).toThrow(RangeError);
  });
});

describe('saved settlement rules', () => {
  it('matches screenshots 05–06 without adding VAT', () => {
    expect(calculateSettlement(settlement)).toEqual({
      gross: parseMoney('1893624.08'),
      net: parseMoney('806918.08'),
      commission: parseMoney('121037.712'),
      payable: parseMoney('121037.71'),
      vat: 0,
      adsTotal: settlement.ads,
    });
  });
  it('preserves legacy cancellation deductions', () => {
    const result = calculateSettlement({
      ...settlement,
      rule: 'legacy',
      shipping: parseMoney('237615'),
    });
    expect(result.gross).toBe(parseMoney('1491031.08'));
    expect(result.net).toBe(parseMoney('404325.08'));
    expect(result.commission).toBe(parseMoney('60648.762'));
  });
  it('applies v3 COD charges and VAT once without deducting shipping', () => {
    const result = calculateSettlement({
      ...settlement,
      rule: 'v3',
      deliveredAmount: 1000000,
      partialAmount: 200000,
      deliveredCodCharge: 10000,
      partialCodCharge: 2000,
      ads: 100000,
      productCost: 450000,
      vatBasisPoints: 1000,
    });
    expect(result).toEqual({
      gross: 1188000,
      vat: 10000,
      adsTotal: 110000,
      net: 628000,
      commission: 94200,
      payable: 94200,
    });
    expect(
      calculateSettlement({
        ...settlement,
        rule: 'v3',
        deliveredAmount: 0,
        partialAmount: 0,
        ads: 100000,
        productCost: 0,
      }).commission,
    ).toBe(-16500);
  });
  it('preserves the negative historical settlement commission', () => {
    const result = calculateSettlement({
      ...settlement,
      rule: 'legacy',
      deliveredAmount: parseMoney('1180'),
      cancelledAmount: parseMoney('1270'),
      partialAmount: 0,
      shipping: parseMoney('170'),
      codCharge: parseMoney('11.8'),
      ads: parseMoney('6602'),
      productCost: parseMoney('900'),
    });
    expect(result.net).toBe(parseMoney('-7773.8'));
    expect(result.commission).toBe(parseMoney('-1166.07'));
  });
  it('uses all finalized parcel counts for screenshot-era automatic report cost', () => {
    expect(settlementProductCost(parseMoney('450'), 187, 30, 50)).toBe(
      parseMoney('120150'),
    );
    expect(() => settlementProductCost(450000, 1.5, 0, 0)).toThrow(RangeError);
  });
  it('rejects negative source amounts rather than silently coercing them', () => {
    expect(() => calculateSettlement({ ...settlement, ads: -1 })).toThrow(
      RangeError,
    );
  });
});

describe('order profitability', () => {
  it('charges pending advertising but no unfinished revenue or courier costs', () => {
    expect(orderFinancials({ ...order, status: 'Pending' })).toEqual({
      revenue: 0,
      ads: 100000,
      productCost: 0,
      shipping: 0,
      codCharge: 0,
      missingCost: false,
    });
  });
  it('charges cancelled product and courier costs without sales revenue', () => {
    const result = orderFinancials({
      ...order,
      status: 'Cancelled',
      codCharge: 0,
    });
    expect(result.revenue).toBe(0);
    expect(result.productCost).toBe(450000);
    expect(result.shipping).toBe(115000);
  });
  it('uses recorded partial quantity and flags missing partial data', () => {
    expect(
      orderFinancials({ ...order, status: 'Partial Delivered' }).missingCost,
    ).toBe(true);
    expect(
      orderFinancials({
        ...order,
        status: 'Partial Delivered',
        quantity: 3,
        partialQuantity: 2,
      }).productCost,
    ).toBe(900000);
    expect(() => orderFinancials({ ...order, partialQuantity: 2 })).toThrow(
      RangeError,
    );
  });
  it('respects an explicit zero sales override and the historical making cost', () => {
    const result = orderFinancials({
      ...order,
      salesOverride: 0,
      costPerPiece: 300000,
      quantity: 2,
    });
    expect(result.revenue).toBe(0);
    expect(result.productCost).toBe(600000);
  });
  it('floors allocation on range-wide loss and never adds VAT', () => {
    const result = calculateProfit([{ ...order, status: 'Pending' }], 0, 1500);
    expect(result.ads).toBe(100000);
    expect(result.net).toBe(-100000);
    expect(result.commission).toBe(0);
  });
  it('calculates allocation from range net, not sum of positive daily shares', () => {
    const result = calculateProfit(
      [order, { ...order, status: 'Pending', ads: 500000 }],
      0,
      1500,
    );
    expect(result.net).toBe(102200);
    expect(result.commission).toBe(15330);
  });
});

describe('payments and brand accounts', () => {
  it.each([
    [100000, 0, 'Unpaid'],
    [100000, 50000, 'Due'],
    [100000, 100000, 'Paid'],
    [100000, 110000, 'Advance'],
    [-100000, 0, 'N/A'],
  ] as const)(
    'classifies %i payable / %i paid as %s',
    (total, paid, status) => {
      expect(paymentStatus(total, paid).status).toBe(status);
    },
  );
  it('allocates oldest first while honoring direct payments', () => {
    const invoices = [
      {
        id: 'new',
        date: '2026-10-12',
        createdAt: 2,
        total: 100000,
        directPaid: 0,
      },
      {
        id: 'old',
        date: '2026-10-10',
        createdAt: 1,
        total: 100000,
        directPaid: 40000,
      },
    ];
    const result = allocateBrandPayments(invoices, 80000);
    expect(result.paidByInvoice.get('old')).toBe(100000);
    expect(result.paidByInvoice.get('new')).toBe(20000);
    expect(result.advance).toBe(0);
    expect(allocateBrandPayments(invoices, 200000).advance).toBe(40000);
  });
  it('moves direct overpayments into the remaining invoice pool without duplication', () => {
    const result = allocateBrandPayments(
      [
        {
          id: 'old',
          date: '2026-10-10',
          createdAt: 1,
          total: 100000,
          directPaid: 150000,
        },
        {
          id: 'new',
          date: '2026-10-12',
          createdAt: 2,
          total: 100000,
          directPaid: 0,
        },
      ],
      25000,
    );
    expect(result.paidByInvoice.get('old')).toBe(100000);
    expect(result.paidByInvoice.get('new')).toBe(75000);
  });
  it('retains advances before any invoice exists', () => {
    expect(allocateBrandPayments([], 50000).advance).toBe(50000);
  });
});
