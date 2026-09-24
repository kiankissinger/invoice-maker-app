import { randomUUID } from 'node:crypto';

import { addDays, computeTotals, daysBetween, formatDocNumber, lateFeeAmount, localDateParts, recurrenceDate } from '../../src/lib/calc';
import { formatMoney } from '../../src/lib/format';
import type { BusinessProfile, InvoiceDocument, ReminderSettings } from '../../src/lib/types';
import { isPro } from './auth';
import type { Context } from './context';
import type { DocumentEmailKind } from './emails';
import { notifyUser } from './notify';
import { getClient, getProfile, getRecord, mutateDocument, writeRecord } from './records';
import { emailDocument } from './sharing';

const JOBS_LOCK = 72_001;
const MAX_CATCH_UP = 12;
/** Reminders go out during local business hours only. */
const SEND_FROM_HOUR = 9;
const SEND_UNTIL_HOUR = 20;

export type ReminderDue = { key: string; kind: DocumentEmailKind };

/** Which reminder (if any) applies today. Each key is sent at most once per invoice. */
export function reminderFor(settings: ReminderSettings, dueDate: string, today: string): ReminderDue | null {
  const daysLate = daysBetween(dueDate, today);
  if (daysLate < 0) {
    return settings.daysBefore > 0 && -daysLate <= settings.daysBefore ? { key: 'before', kind: 'reminder_before' } : null;
  }
  if (daysLate === 0) return settings.onDueDate ? { key: 'due', kind: 'reminder_due' } : null;
  if (settings.everyDaysAfter <= 0) return null;
  const n = Math.floor(daysLate / settings.everyDaysAfter);
  return n >= 1 && n <= settings.maxAfter ? { key: `after-${n}`, kind: 'reminder_after' } : null;
}

export async function runJobs(ctx: Context): Promise<void> {
  await ctx.db.withLock(JOBS_LOCK, async () => {
    await runRecurring(ctx);
    await runLateFees(ctx);
    await runReminders(ctx);
  });
}

export async function runRecurring(ctx: Context): Promise<void> {
  const { rows } = await ctx.db.query<{ user_id: string; id: string }>(
    `SELECT user_id, id FROM records
     WHERE type = 'document' AND deleted = false AND (data->'recurrence'->>'active') = 'true'`
  );
  for (const { user_id: userId, id } of rows) {
    try {
      if (!(await isPro(ctx, userId))) continue;
      for (let i = 0; i < MAX_CATCH_UP; i++) {
        const created = await generateNext(ctx, userId, id);
        if (!created) break;
        const { doc, autoSend } = created;
        const client = await getClient(ctx.db, userId, doc.clientId);
        if (autoSend && client?.email) {
          await emailDocument(ctx, userId, doc.id, client.email, 'send');
          await notifyUser(ctx, userId, 'Recurring invoice sent', `Invoice ${doc.number} was emailed to ${client.name}.`, { docId: doc.id });
        } else {
          await notifyUser(ctx, userId, 'Recurring invoice ready', `Invoice ${doc.number} is ready to review and send.`, { docId: doc.id });
        }
      }
    } catch (error) {
      console.error(`Recurring invoice failed for ${userId}/${id}`, error);
    }
  }
}

async function generateNext(ctx: Context, userId: string, parentId: string) {
  return ctx.db.tx(async (tx) => {
    const parentRow = await getRecord(tx, userId, 'document', parentId, true);
    if (!parentRow || parentRow.deleted) return null;
    const parent = parentRow.data as InvoiceDocument;
    const rec = parent.recurrence;
    if (!rec?.active) return null;

    const profileRow = await getRecord(tx, userId, 'profile', 'profile', true);
    const profile = profileRow && !profileRow.deleted ? (profileRow.data as BusinessProfile) : undefined;
    const today = localDateParts(ctx.now(), profile?.timeZone).date;
    if (rec.nextIssueDate > today) return null;

    const now = ctx.now().toISOString();
    if (rec.endDate && rec.nextIssueDate > rec.endDate) {
      await mutateDocument(tx, userId, parentId, ctx.now(), (d) => ({ ...d, recurrence: { ...rec, active: false } }));
      return null;
    }

    let number = `${parent.number}-${rec.count + 1}`;
    if (profile) {
      number = formatDocNumber(profile.invoicePrefix ?? 'INV', profile.nextInvoiceNumber ?? 1);
      const nextProfile = { ...profile, nextInvoiceNumber: (profile.nextInvoiceNumber ?? 1) + 1, updatedAt: now };
      await writeRecord(tx, userId, 'profile', 'profile', nextProfile, now, false);
    }

    const termDays = parent.dueDate ? daysBetween(parent.issueDate, parent.dueDate) : (profile?.defaultPaymentTermsDays ?? 14);
    const doc: InvoiceDocument = {
      ...parent,
      id: randomUUID(),
      number,
      status: 'draft',
      issueDate: rec.nextIssueDate,
      dueDate: addDays(rec.nextIssueDate, termDays),
      items: parent.items.map((item) => ({ ...item, id: randomUUID() })),
      payments: [],
      signature: undefined,
      shareUrl: undefined,
      sentAt: undefined,
      lastSentTo: undefined,
      viewedAt: undefined,
      recurrence: undefined,
      recurringParentId: parent.id,
      convertedFromId: undefined,
      convertedToId: undefined,
      createdAt: now,
      updatedAt: now,
    };
    await writeRecord(tx, userId, 'document', doc.id, JSON.parse(JSON.stringify(doc)), now, false);

    const count = rec.count + 1;
    const nextIssueDate = recurrenceDate(rec.anchorDate, rec.frequency, count + 1);
    const active = !(rec.endDate && nextIssueDate > rec.endDate);
    await mutateDocument(tx, userId, parentId, ctx.now(), (d) => ({ ...d, recurrence: { ...rec, count, nextIssueDate, active } }));
    return { doc, autoSend: rec.autoSend };
  });
}

export async function runReminders(ctx: Context): Promise<void> {
  const { rows: profiles } = await ctx.db.query<{ user_id: string }>(
    `SELECT user_id FROM records WHERE type = 'profile' AND id = 'profile' AND deleted = false AND (data->'reminders'->>'enabled') = 'true'`
  );
  for (const { user_id: userId } of profiles) {
    try {
      const profile = await getProfile(ctx.db, userId);
      if (!profile?.reminders?.enabled) continue;
      const { date: today, hour } = localDateParts(ctx.now(), profile.timeZone);
      if (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR) continue;
      if (!(await isPro(ctx, userId))) continue;

      const { rows: docs } = await ctx.db.query<{ data: InvoiceDocument }>(
        `SELECT data FROM records WHERE user_id = $1 AND type = 'document' AND deleted = false
           AND data->>'type' = 'invoice' AND data->>'status' = 'sent'`,
        [userId]
      );
      for (const { data: doc } of docs) {
        if (doc.remindersEnabled === false || !doc.dueDate || computeTotals(doc).balance <= 0) continue;
        const due = reminderFor(profile.reminders, doc.dueDate, today);
        if (!due) continue;
        const client = await getClient(ctx.db, userId, doc.clientId);
        if (!client?.email) continue;

        const { rows: claimed } = await ctx.db.query(
          `INSERT INTO reminder_log (user_id, doc_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING kind`,
          [userId, doc.id, due.key]
        );
        if (claimed.length === 0) continue;
        try {
          await emailDocument(ctx, userId, doc.id, client.email, due.kind);
        } catch (error) {
          // Release the claim so the next run retries.
          await ctx.db.query(`DELETE FROM reminder_log WHERE user_id = $1 AND doc_id = $2 AND kind = $3`, [userId, doc.id, due.key]);
          throw error;
        }
      }
    } catch (error) {
      console.error(`Reminders failed for ${userId}`, error);
    }
  }
}

/** Adds a one-time late fee line to invoices that are past due by more than the grace period. */
export async function runLateFees(ctx: Context): Promise<void> {
  const { rows: profiles } = await ctx.db.query<{ user_id: string }>(
    `SELECT user_id FROM records WHERE type = 'profile' AND id = 'profile' AND deleted = false AND (data->'lateFee'->>'enabled') = 'true'`
  );
  for (const { user_id: userId } of profiles) {
    try {
      const profile = await getProfile(ctx.db, userId);
      const fee = profile?.lateFee;
      if (!profile || !fee?.enabled || fee.value <= 0) continue;
      if (!(await isPro(ctx, userId))) continue;
      const today = localDateParts(ctx.now(), profile.timeZone).date;

      const { rows: docs } = await ctx.db.query<{ data: InvoiceDocument }>(
        `SELECT data FROM records WHERE user_id = $1 AND type = 'document' AND deleted = false
           AND data->>'type' = 'invoice' AND data->>'status' = 'sent' AND data->>'lateFeeAppliedAt' IS NULL`,
        [userId]
      );
      for (const { data: candidate } of docs) {
        if (!candidate.dueDate || daysBetween(candidate.dueDate, today) <= Math.max(0, fee.graceDays)) continue;
        const updated = await ctx.db.tx((tx) =>
          mutateDocument(tx, userId, candidate.id, ctx.now(), (doc) => {
            const { balance } = computeTotals(doc);
            if (doc.lateFeeAppliedAt || doc.status !== 'sent' || balance <= 0) return null;
            const amount = lateFeeAmount(balance, fee.kind, fee.value);
            if (amount <= 0) return null;
            return {
              ...doc,
              lateFeeAppliedAt: ctx.now().toISOString(),
              items: [
                ...doc.items,
                {
                  id: 'late-fee',
                  description: 'Late payment fee',
                  details: fee.kind === 'percent' ? `${fee.value}% of the overdue balance` : undefined,
                  quantity: 1,
                  unitPrice: amount,
                  taxable: false,
                },
              ],
            };
          })
        );
        if (updated?.lateFeeAppliedAt) {
          const fee = updated.items.find((i) => i.id === 'late-fee');
          await notifyUser(ctx, userId, 'Late fee added', `${formatMoney(fee?.unitPrice ?? 0, updated.currency)} added to overdue invoice ${updated.number}.`, {
            docId: updated.id,
          });
        }
      }
    } catch (error) {
      console.error(`Late fees failed for ${userId}`, error);
    }
  }
}

export function startJobs(ctx: Context): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runJobs(ctx);
    } catch (error) {
      console.error('Background jobs failed', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, ctx.config.jobsIntervalMinutes * 60_000);
  setTimeout(tick, 5_000);
  return () => clearInterval(timer);
}
