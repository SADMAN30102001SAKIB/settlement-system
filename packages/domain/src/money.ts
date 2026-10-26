// Integer milli-taka preserves the original three-decimal settlement commissions.
const SCALE = 1000n;
const MAX_MONEY = 1_000_000_000_000;

export function assertMoney(value: number): number {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_MONEY) {
    throw new RangeError('Money must be a bounded integer in milli-taka.');
  }
  return value;
}

export function parseMoney(input: string): number {
  const normalized = input.trim().replaceAll(',', '').replace(/^৳\s*/, '');
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(normalized);
  if (!match)
    throw new RangeError(
      'Enter a monetary amount with at most 3 decimal places.',
    );
  const whole = match[2];
  if (whole === undefined) throw new RangeError('Invalid amount.');
  const amount =
    BigInt(whole) * SCALE + BigInt((match[3] ?? '').padEnd(3, '0'));
  return assertMoney(Number(match[1] === '-' ? -amount : amount));
}

export function moneyInput(amount: number): string {
  assertMoney(amount);
  const absolute = BigInt(Math.abs(amount));
  const fraction = String(absolute % SCALE)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${amount < 0 ? '-' : ''}${String(absolute / SCALE)}${fraction ? `.${fraction}` : ''}`;
}

export function parsePercentage(input: string): number {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  const whole = match?.[1];
  if (match === null || whole === undefined)
    throw new RangeError(
      'Enter a percentage between 0 and 100, with at most 2 decimal places.',
    );
  const basisPoints =
    Number(whole) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (basisPoints > 10_000)
    throw new RangeError('Percentage must be between 0 and 100.');
  return basisPoints;
}

export function sumMoney(values: readonly number[]): number {
  return assertMoney(
    values.reduce((sum, value) => sum + assertMoney(value), 0),
  );
}

export function ratio(
  amount: number,
  numerator: number,
  denominator: number,
): number {
  assertMoney(amount);
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator < 0 ||
    denominator <= 0
  ) {
    throw new RangeError('Invalid monetary ratio.');
  }
  const product = BigInt(amount) * BigInt(numerator);
  const divisor = BigInt(denominator);
  const sign = product < 0n ? -1n : 1n;
  const rounded = ((product * sign + divisor / 2n) / divisor) * sign;
  return assertMoney(Number(rounded));
}

export function percentage(amount: number, basisPoints: number): number {
  if (
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10_000
  ) {
    throw new RangeError('Percentage must be between 0 and 100.');
  }
  return ratio(amount, basisPoints, 10_000);
}

export function toPaisaPrecision(amount: number): number {
  return assertMoney(ratio(amount, 1, 10) * 10);
}

export function allocateDailyAds(
  amount: number,
  orderedIds: readonly string[],
): ReadonlyMap<string, number> {
  assertMoney(amount);
  if (amount < 0 || new Set(orderedIds).size !== orderedIds.length) {
    throw new RangeError(
      'Advertising requires a nonnegative amount and unique order IDs.',
    );
  }
  const allocations = new Map<string, number>();
  if (orderedIds.length === 0) return allocations;
  const share = toPaisaPrecision(ratio(amount, 1, orderedIds.length));
  let remaining = amount;
  orderedIds.forEach((id, index) => {
    const value =
      index === orderedIds.length - 1 ? remaining : Math.min(share, remaining);
    allocations.set(id, value);
    remaining -= value;
  });
  return allocations;
}
