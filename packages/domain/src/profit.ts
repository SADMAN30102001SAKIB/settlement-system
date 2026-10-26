import { assertMoney, percentage, sumMoney, toPaisaPrecision } from './money';

export interface ProfitOrder {
  status: 'Delivered' | 'Cancelled' | 'Partial Delivered' | 'Pending';
  quantity: number;
  partialQuantity: number | null;
  costPerPiece: number | null;
  salesOverride: number | null;
  codAmount: number;
  shipping: number;
  codCharge: number;
  ads: number;
}

export function orderFinancials(order: ProfitOrder) {
  if (!Number.isSafeInteger(order.quantity) || order.quantity < 1)
    throw new RangeError('Quantity must be a positive integer.');
  if (
    order.partialQuantity !== null &&
    (!Number.isSafeInteger(order.partialQuantity) ||
      order.partialQuantity < 0 ||
      order.partialQuantity > order.quantity)
  ) {
    throw new RangeError('Partial quantity cannot exceed ordered quantity.');
  }
  for (const value of [
    order.costPerPiece,
    order.salesOverride,
    order.codAmount,
    order.shipping,
    order.codCharge,
    order.ads,
  ]) {
    if (value !== null && assertMoney(value) < 0)
      throw new RangeError('Order amounts cannot be negative.');
  }
  const finalized = order.status !== 'Pending';
  const earnsRevenue =
    order.status === 'Delivered' || order.status === 'Partial Delivered';
  const missingCost =
    finalized &&
    (order.costPerPiece === null ||
      (order.status === 'Partial Delivered' && order.partialQuantity === null));
  const productQuantity =
    order.status === 'Partial Delivered'
      ? order.partialQuantity
      : order.quantity;
  const productCost =
    finalized &&
    !missingCost &&
    order.costPerPiece !== null &&
    productQuantity !== null
      ? assertMoney(order.costPerPiece * productQuantity)
      : 0;
  return {
    revenue: earnsRevenue ? (order.salesOverride ?? order.codAmount) : 0,
    ads: order.ads,
    productCost,
    shipping: finalized ? order.shipping : 0,
    codCharge: finalized ? order.codCharge : 0,
    missingCost,
  };
}

export function calculateProfit(
  orders: readonly ProfitOrder[],
  otherExpenses: number,
  agencyBasisPoints: number,
) {
  if (assertMoney(otherExpenses) < 0)
    throw new RangeError('Expenses cannot be negative.');
  const items = orders.map(orderFinancials);
  const revenue = sumMoney(items.map((item) => item.revenue));
  const ads = sumMoney(items.map((item) => item.ads));
  const productCost = sumMoney(items.map((item) => item.productCost));
  const shipping = sumMoney(items.map((item) => item.shipping));
  const codCharge = sumMoney(items.map((item) => item.codCharge));
  const net = sumMoney([
    revenue,
    -ads,
    -productCost,
    -shipping,
    -codCharge,
    -otherExpenses,
  ]);
  return {
    revenue,
    ads,
    productCost,
    shipping,
    codCharge,
    otherExpenses,
    net,
    commission: toPaisaPrecision(
      percentage(Math.max(0, net), agencyBasisPoints),
    ),
    missingCosts: items.filter((item) => item.missingCost).length,
  };
}
