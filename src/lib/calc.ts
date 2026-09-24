// Pure money/date math. No React Native imports so it runs under `node --test`.
import type { DisplayStatus, InvoiceDocument, LineItem, RecurrenceFrequency } from './types';

export type Totals = {
  subtotal: number;
  discount: number;
  taxableBase: number;
  tax: number;
  shipping: number;
  withholding: number;
  total: number;
  paid: number;
  balance: number;
};

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function lineTotal(item: Pick<LineItem, 'quantity' | 'unitPrice'>): number {
  return roundMoney((item.quantity || 0) * (item.unitPrice || 0));
}

export function computeTotals(
  doc: Pick<InvoiceDocument, 'items' | 'discount' | 'taxRate' | 'shipping' | 'payments' | 'withholdingRate'>
): Totals {
  const subtotal = roundMoney(doc.items.reduce((sum, item) => sum + lineTotal(item), 0));
  const taxableSubtotal = doc.items
    .filter((item) => item.taxable)
    .reduce((sum, item) => sum + lineTotal(item), 0);

  const rawDiscount =
    doc.discount.kind === 'percent'
      ? (subtotal * clamp(doc.discount.value, 0, 100)) / 100
      : Math.max(0, doc.discount.value);
  const discount = roundMoney(Math.min(rawDiscount, subtotal));

  // Spread the discount across line items proportionally so only the taxable share is taxed.
  const taxableBase =
    subtotal > 0 ? roundMoney(taxableSubtotal - (discount * taxableSubtotal) / subtotal) : 0;
  const tax = roundMoney((taxableBase * Math.max(0, doc.taxRate)) / 100);
  const shipping = roundMoney(Math.max(0, doc.shipping));
  // Withholding applies to the net amount before tax and shipping.
  const withholding = roundMoney(((subtotal - discount) * clamp(doc.withholdingRate ?? 0, 0, 100)) / 100);
  const total = roundMoney(subtotal - discount + tax + shipping - withholding);
  const paid = roundMoney(doc.payments.reduce((sum, p) => sum + p.amount, 0));
  const balance = roundMoney(total - paid);

  return { subtotal, discount, taxableBase, tax, shipping, withholding, total, paid, balance };
}

/** Requested deposit and how much of it is still unpaid (0 when no deposit is set). */
export function depositStatus(doc: Pick<InvoiceDocument, 'items' | 'discount' | 'taxRate' | 'shipping' | 'payments' | 'withholdingRate' | 'deposit'>): {
  amount: number;
  outstanding: number;
} {
  if (!doc.deposit || doc.deposit.value <= 0) return { amount: 0, outstanding: 0 };
  const { total, paid } = computeTotals(doc);
  const amount = roundMoney(
    doc.deposit.kind === 'percent' ? (total * clamp(doc.deposit.value, 0, 100)) / 100 : Math.min(doc.deposit.value, total)
  );
  return { amount, outstanding: roundMoney(Math.max(0, amount - paid)) };
}

/** Late fee for an overdue balance under the given settings. */
export function lateFeeAmount(balance: number, kind: 'percent' | 'amount', value: number): number {
  return roundMoney(kind === 'percent' ? (Math.max(0, balance) * Math.max(0, value)) / 100 : Math.max(0, value));
}

export function displayStatus(doc: InvoiceDocument, today: string = todayISO()): DisplayStatus {
  if (doc.type === 'estimate') return doc.status as DisplayStatus;
  if (doc.status === 'void') return 'void';

  const { total, paid, balance } = computeTotals(doc);
  if (total > 0 && balance <= 0) return 'paid';
  if (doc.status === 'draft' && paid === 0) return 'draft';
  if (doc.dueDate && doc.dueDate < today) return 'overdue';
  if (paid > 0) return 'partial';
  return 'sent';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Parses user-entered numbers, tolerating currency symbols and thousands separators. */
export function parseAmount(text: string): number {
  const cleaned = text.replace(/[^0-9.-]/g, '');
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

export function todayISO(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return todayISO(new Date(y, m - 1, d + days));
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function daysBetween(fromISO: string, toISO: string): number {
  const [y1, m1, d1] = fromISO.split('-').map(Number);
  const [y2, m2, d2] = toISO.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function formatDocNumber(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(4, '0')}`;
}

/** Adds months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return todayISO(new Date(target.getFullYear(), target.getMonth(), Math.min(d, lastDay)));
}

/** Issue date of the nth occurrence of a recurring invoice (n = 0 is the anchor). */
export function recurrenceDate(anchor: string, frequency: RecurrenceFrequency, n: number): string {
  switch (frequency) {
    case 'weekly':
      return addDays(anchor, 7 * n);
    case 'biweekly':
      return addDays(anchor, 14 * n);
    case 'monthly':
      return addMonths(anchor, n);
    case 'quarterly':
      return addMonths(anchor, 3 * n);
    case 'yearly':
      return addMonths(anchor, 12 * n);
  }
}

/** Calendar date (YYYY-MM-DD) and hour for an instant in an IANA time zone. */
export function localDateParts(now: Date, timeZone = 'UTC'): { date: string; hour: number } {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** First occurrence on or after `today` (n >= 1), so enabling a schedule never back-fills the past. */
export function nextOccurrence(anchor: string, frequency: RecurrenceFrequency, today: string): { count: number; nextIssueDate: string } {
  let n = 1;
  while (recurrenceDate(anchor, frequency, n) < today && n < 10_000) n++;
  return { count: n - 1, nextIssueDate: recurrenceDate(anchor, frequency, n) };
}
