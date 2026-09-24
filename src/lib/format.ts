import type { PaymentMethod } from './types';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  check: 'Check',
  card: 'Card',
  bank: 'Bank transfer',
  paypal: 'PayPal',
  venmo: 'Venmo',
  zelle: 'Zelle',
  other: 'Other',
};

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency: string): string {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    } catch {
      formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    moneyFormatters.set(currency, formatter);
  }
  return formatter.format(amount);
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Renders a number for a TextInput without trailing noise ("12.5", not "12.50000001"). */
export function numberToInput(value: number): string {
  if (!value) return '';
  return String(Math.round(value * 10000) / 10000);
}

export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CHF', 'SEK', 'NOK', 'DKK', 'MXN', 'BRL',
  'INR', 'ZAR', 'SGD', 'HKD', 'AED', 'PHP', 'NGN',
] as const;
