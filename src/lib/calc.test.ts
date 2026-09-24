/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addDays,
  addMonths,
  computeTotals,
  daysBetween,
  displayStatus,
  formatDocNumber,
  isValidISODate,
  localDateParts,
  nextOccurrence,
  parseAmount,
  recurrenceDate,
} from './calc.ts';
import type { InvoiceDocument } from './types.ts';

function doc(overrides: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    id: 'd1',
    type: 'invoice',
    number: 'INV0001',
    status: 'sent',
    issueDate: '2026-01-01',
    dueDate: '2026-01-31',
    items: [],
    discount: { kind: 'percent', value: 0 },
    taxRate: 0,
    taxLabel: 'Tax',
    shipping: 0,
    notes: '',
    terms: '',
    payments: [],
    currency: 'USD',
    templateId: 'classic',
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const item = (quantity: number, unitPrice: number, taxable = true) => ({
  id: Math.random().toString(),
  description: 'x',
  quantity,
  unitPrice,
  taxable,
});

test('sums line items, tax and shipping', () => {
  const t = computeTotals(doc({ items: [item(2, 50), item(1, 25.5)], taxRate: 10, shipping: 5 }));
  assert.equal(t.subtotal, 125.5);
  assert.equal(t.tax, 12.55);
  assert.equal(t.total, 143.05);
  assert.equal(t.balance, 143.05);
});

test('only taxes taxable items, after a proportional discount', () => {
  const t = computeTotals(
    doc({
      items: [item(1, 100, true), item(1, 100, false)],
      discount: { kind: 'percent', value: 10 },
      taxRate: 10,
    })
  );
  assert.equal(t.discount, 20);
  assert.equal(t.taxableBase, 90);
  assert.equal(t.tax, 9);
  assert.equal(t.total, 189);
});

test('fixed discount never exceeds subtotal', () => {
  const t = computeTotals(doc({ items: [item(1, 30)], discount: { kind: 'amount', value: 50 } }));
  assert.equal(t.discount, 30);
  assert.equal(t.total, 0);
});

test('avoids floating point drift', () => {
  const t = computeTotals(doc({ items: [item(3, 0.1)], taxRate: 0 }));
  assert.equal(t.total, 0.3);
});

test('derives invoice status from payments and due date', () => {
  const base = { items: [item(1, 100)] };
  assert.equal(displayStatus(doc({ ...base, status: 'draft' }), '2026-01-10'), 'draft');
  assert.equal(displayStatus(doc(base), '2026-01-10'), 'sent');
  assert.equal(displayStatus(doc(base), '2026-02-10'), 'overdue');
  const partial = [{ id: 'p', date: '2026-01-05', amount: 40, method: 'cash' as const }];
  assert.equal(displayStatus(doc({ ...base, payments: partial }), '2026-01-10'), 'partial');
  const full = [{ id: 'p', date: '2026-01-05', amount: 100, method: 'cash' as const }];
  assert.equal(displayStatus(doc({ ...base, payments: full }), '2026-02-10'), 'paid');
  assert.equal(displayStatus(doc({ ...base, status: 'void' }), '2026-02-10'), 'void');
});

test('parses loosely formatted amounts', () => {
  assert.equal(parseAmount('$1,234.50'), 1234.5);
  assert.equal(parseAmount(''), 0);
  assert.equal(parseAmount('abc'), 0);
});

test('date helpers', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 30), '2027-01-30');
  assert.equal(daysBetween('2026-01-01', '2026-03-01'), 59);
  assert.equal(isValidISODate('2026-02-30'), false);
  assert.equal(isValidISODate('2026-02-28'), true);
  assert.equal(isValidISODate('02/28/2026'), false);
});

test('pads document numbers', () => {
  assert.equal(formatDocNumber('INV', 7), 'INV0007');
  assert.equal(formatDocNumber('EST-', 12345), 'EST-12345');
});

test('month math clamps to month end without drifting', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(recurrenceDate('2026-01-31', 'monthly', 1), '2026-02-28');
  assert.equal(recurrenceDate('2026-01-31', 'monthly', 2), '2026-03-31');
  assert.equal(recurrenceDate('2026-01-01', 'biweekly', 2), '2026-01-29');
  assert.equal(recurrenceDate('2026-02-15', 'quarterly', 1), '2026-05-15');
  assert.equal(recurrenceDate('2024-02-29', 'yearly', 1), '2025-02-28');
});

test('local date parts respect the time zone', () => {
  const instant = new Date('2026-03-01T03:30:00Z');
  assert.deepEqual(localDateParts(instant, 'UTC'), { date: '2026-03-01', hour: 3 });
  assert.deepEqual(localDateParts(instant, 'America/Los_Angeles'), { date: '2026-02-28', hour: 19 });
  assert.deepEqual(localDateParts(instant, 'Not/AZone'), { date: '2026-03-01', hour: 3 });
});

test('nextOccurrence skips past dates', () => {
  assert.deepEqual(nextOccurrence('2026-01-15', 'monthly', '2026-01-20'), { count: 0, nextIssueDate: '2026-02-15' });
  assert.deepEqual(nextOccurrence('2026-01-15', 'monthly', '2026-05-15'), { count: 3, nextIssueDate: '2026-05-15' });
  assert.deepEqual(nextOccurrence('2026-01-01', 'weekly', '2026-01-02'), { count: 0, nextIssueDate: '2026-01-08' });
});
