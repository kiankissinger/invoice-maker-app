import { z } from 'zod';

import type { InvoiceDocument, SyncType } from '../../src/lib/types';
import type { Context } from './context';
import { getRecord, mergeServerOwned, toChange, writeRecord, type RecordRow } from './records';

export const PAGE_SIZE = 500;
const TYPES: [SyncType, ...SyncType[]] = ['document', 'client', 'catalog', 'profile'];

export const syncRequestSchema = z.object({
  cursor: z.number().int().min(0),
  changes: z
    .array(
      z.object({
        type: z.enum(TYPES),
        id: z.string().min(1).max(100),
        updatedAt: z.string().datetime({ offset: true }),
        deleted: z.boolean(),
        data: z.record(z.string(), z.unknown()).nullable().optional(),
      })
    )
    .max(PAGE_SIZE),
});

export type SyncRequest = z.infer<typeof syncRequestSchema>;

/**
 * Last-write-wins sync. Incoming changes are applied when strictly newer than the stored copy;
 * the response contains everything after `cursor` plus the current server copy of any rejected
 * change, so the device converges either way.
 */
export async function sync(ctx: Context, userId: string, request: SyncRequest) {
  const rejected: RecordRow[] = [];

  await ctx.db.tx(async (tx) => {
    for (const change of request.changes) {
      const existing = await getRecord(tx, userId, change.type, change.id, true);
      if (existing && new Date(change.updatedAt).getTime() <= new Date(existing.updated_at).getTime()) {
        rejected.push(existing);
        continue;
      }
      if (!change.deleted && !change.data) continue;

      let data: Record<string, unknown> | null = change.deleted ? null : { ...change.data, id: change.id };
      let updatedAt = change.updatedAt;
      if (change.type === 'document' && data) {
        const merged = await mergeServerOwned(tx, userId, data as unknown as InvoiceDocument);
        if (merged) {
          // Newer than the device's copy, so the device takes the merged version on pull.
          updatedAt = new Date(Math.max(ctx.now().getTime(), new Date(change.updatedAt).getTime() + 1)).toISOString();
          data = { ...merged, updatedAt };
        }
      }
      await writeRecord(tx, userId, change.type, change.id, data, updatedAt, change.deleted);
    }
  });

  const { rows } = await ctx.db.query<RecordRow>(
    `SELECT type, id, data, updated_at, deleted, seq FROM records WHERE user_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
    [userId, request.cursor, PAGE_SIZE + 1]
  );
  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  const cursor = page.length ? Number(page[page.length - 1].seq) : request.cursor;
  const changes = page.map(toChange);
  for (const row of rejected) {
    if (Number(row.seq) <= request.cursor) changes.push(toChange(row));
  }
  return { cursor, hasMore, changes: changes.map(({ seq: _seq, ...c }) => c) };
}
