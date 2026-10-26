import { moneyInput } from '@settlement/domain/money';

export function formText(form: FormData, key: string): string {
  const value = form.get(key);
  if (value === null) return '';
  if (typeof value !== 'string') throw new Error('Expected a text field.');
  return value;
}

const currency = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

export function money(amount: number): string {
  return `${amount < 0 ? '−' : ''}৳${currency.format(Math.abs(amount) / 1000)}`;
}

export function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

export function amountInput(amount: number | null): string {
  return amount === null ? '' : moneyInput(amount);
}
