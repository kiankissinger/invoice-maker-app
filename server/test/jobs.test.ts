import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import type { ReminderSettings } from '../../src/lib/types';
import { reminderFor, runRecurring, runReminders } from '../src/jobs';
import { change, createTestContext, makeInvoice } from './helpers';

let t: Awaited<ReturnType<typeof createTestContext>>;
before(async () => {
  t = await createTestContext();
});
after(() => t.close());

const settings: ReminderSettings = { enabled: true, daysBefore: 3, onDueDate: true, everyDaysAfter: 7, maxAfter: 3 };

test('reminderFor picks the right reminder for each day', () => {
  assert.equal(reminderFor(settings, '2026-10-10', '2026-10-06'), null);
  assert.deepEqual(reminderFor(settings, '2026-10-10', '2026-10-07'), { key: 'before', kind: 'reminder_before' });
  assert.deepEqual(reminderFor(settings, '2026-10-10', '2026-10-10'), { key: 'due', kind: 'reminder_due' });
  assert.equal(reminderFor(settings, '2026-10-10', '2026-10-16'), null);
  assert.deepEqual(reminderFor(settings, '2026-10-10', '2026-10-17'), { key: 'after-1', kind: 'reminder_after' });
  assert.deepEqual(reminderFor(settings, '2026-10-10', '2026-10-25'), { key: 'after-2', kind: 'reminder_after' });
  assert.equal(reminderFor(settings, '2026-10-10', '2026-11-07'), null); // past maxAfter
  assert.equal(reminderFor({ ...settings, daysBefore: 0, onDueDate: false, everyDaysAfter: 0 }, '2026-10-10', '2026-10-10'), null);
});

const profile = (overrides = {}) => ({
  id: 'profile',
  name: 'Bright Studio',
  email: 'owner@bright.studio',
  invoicePrefix: 'INV',
  nextInvoiceNumber: 8,
  defaultPaymentTermsDays: 14,
  timeZone: 'America/New_York',
  reminders: settings,
  updatedAt: '2026-09-20T10:00:00.000Z',
  ...overrides,
});
const client = { id: 'client-1', name: 'Acme Co.', email: 'ap@acme.com', createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-20T10:00:00.000Z' };

test('reminders go out once, during local business hours, only for unpaid sent invoices', async () => {
  const s = await t.signIn('remind@example.com');
  const unpaid = makeInvoice({ id: 'unpaid', number: 'INV0001', dueDate: '2026-10-01' });
  const paid = makeInvoice({ id: 'paid', number: 'INV0002', dueDate: '2026-10-01', payments: [{ id: 'p', date: '2026-09-25', amount: 550, method: 'cash' }] });
  const draft = makeInvoice({ id: 'draft', number: 'INV0003', status: 'draft', dueDate: '2026-10-01' });
  const optedOut = makeInvoice({ id: 'optout', number: 'INV0004', dueDate: '2026-10-01', remindersEnabled: false });
  await t.api()
    .post('/v1/sync')
    .set(s.auth)
    .send({ cursor: 0, changes: [change('profile', profile()), change('client', client), ...[unpaid, paid, draft, optedOut].map((d) => change('document', d))] })
    .expect(200);

  const count = () => t.emails.filter((e) => e.to === 'ap@acme.com').length;
  const start = count();

  // 2026-09-28 06:00 in New York: 3 days before due, but too early in the day.
  t.clock.now = new Date('2026-09-28T10:00:00Z');
  await runReminders(t.ctx);
  assert.equal(count(), start);

  // 10:00 local: the "due soon" reminder goes out for the unpaid invoice only.
  t.clock.now = new Date('2026-09-28T14:00:00Z');
  await runReminders(t.ctx);
  assert.equal(count(), start + 1);
  assert.match(t.emails.at(-1)!.subject, /Reminder: invoice INV0001 is due/);

  // Running again the same day doesn't resend.
  await runReminders(t.ctx);
  assert.equal(count(), start + 1);

  // Due date, then a week late.
  t.clock.now = new Date('2026-10-01T14:00:00Z');
  await runReminders(t.ctx);
  assert.match(t.emails.at(-1)!.subject, /due today/);
  t.clock.now = new Date('2026-10-08T14:00:00Z');
  await runReminders(t.ctx);
  assert.match(t.emails.at(-1)!.subject, /Overdue: invoice INV0001/);
  assert.equal(count(), start + 3);

  // Lapsed subscription: no more reminders.
  t.proUsers.delete(s.user.id);
  await t.db.query(`UPDATE users SET pro_checked_at = NULL WHERE id = $1`, [s.user.id]);
  t.clock.now = new Date('2026-10-15T14:00:00Z');
  await runReminders(t.ctx);
  assert.equal(count(), start + 3);
});

test('recurring invoices are generated on schedule, numbered, and auto-sent', async () => {
  const s = await t.signIn('recurring@example.com');
  await t.api().post('/v1/devices').set(s.auth).send({ token: 'ExponentPushToken[recurring1]', platform: 'ios' }).expect(200);
  const parent = makeInvoice({
    id: 'retainer',
    number: 'INV0007',
    issueDate: '2026-08-31',
    dueDate: '2026-09-14',
    recurrence: { active: true, frequency: 'monthly', anchorDate: '2026-08-31', count: 0, nextIssueDate: '2026-09-30', autoSend: true },
  });
  const first = await t.api()
    .post('/v1/sync')
    .set(s.auth)
    .send({ cursor: 0, changes: [change('profile', profile({ reminders: { ...settings, enabled: false } })), change('client', client), change('document', parent)] })
    .expect(200);

  t.clock.now = new Date('2026-09-29T15:00:00Z');
  await runRecurring(t.ctx);
  let pull = await t.api().post('/v1/sync').set(s.auth).send({ cursor: first.body.cursor, changes: [] }).expect(200);
  assert.equal(pull.body.changes.length, 0, 'nothing before the next issue date');

  // Catch up after downtime: Sep 30 and Oct 31 are both due by Nov 2.
  t.clock.now = new Date('2026-11-02T15:00:00Z');
  const sentBefore = t.emails.length;
  await runRecurring(t.ctx);
  await runRecurring(t.ctx); // idempotent
  pull = await t.api().post('/v1/sync').set(s.auth).send({ cursor: first.body.cursor, changes: [] }).expect(200);

  const docs = pull.body.changes.filter((c: { type: string }) => c.type === 'document').map((c: { data: any }) => c.data);
  const children = docs.filter((d: any) => d.recurringParentId === 'retainer').sort((a: any, b: any) => a.issueDate.localeCompare(b.issueDate));
  assert.deepEqual(children.map((d: any) => [d.number, d.issueDate, d.dueDate]), [
    ['INV0008', '2026-09-30', '2026-10-14'],
    ['INV0009', '2026-10-31', '2026-11-14'],
  ]);
  assert.ok(children.every((d: any) => d.status === 'sent' && d.lastSentTo === 'ap@acme.com' && !d.recurrence && d.payments.length === 0));
  assert.notEqual(children[0].items[0].id, parent.items[0].id);

  const updatedParent = docs.find((d: any) => d.id === 'retainer');
  assert.equal(updatedParent.recurrence.count, 2);
  assert.equal(updatedParent.recurrence.nextIssueDate, '2026-11-30');

  const updatedProfile = pull.body.changes.find((c: { type: string }) => c.type === 'profile').data;
  assert.equal(updatedProfile.nextInvoiceNumber, 10);

  assert.equal(t.emails.length - sentBefore, 2);
  assert.ok(t.pushes.some((p) => p.title === 'Recurring invoice sent'));
});

test('recurrence stops after the end date', async () => {
  const s = await t.signIn('ending@example.com');
  const parent = makeInvoice({
    id: 'ends',
    recurrence: { active: true, frequency: 'weekly', anchorDate: '2026-09-01', count: 0, nextIssueDate: '2026-09-08', endDate: '2026-09-10', autoSend: false },
  });
  await t.api().post('/v1/sync').set(s.auth).send({ cursor: 0, changes: [change('document', parent)] }).expect(200);
  t.clock.now = new Date('2026-10-01T15:00:00Z');
  await runRecurring(t.ctx);
  const pull = await t.api().post('/v1/sync').set(s.auth).send({ cursor: 0, changes: [] }).expect(200);
  const docs = pull.body.changes.map((c: { data: any }) => c.data);
  assert.equal(docs.filter((d: any) => d.recurringParentId === 'ends').length, 1);
  assert.equal(docs.find((d: any) => d.id === 'ends').recurrence.active, false);
});
