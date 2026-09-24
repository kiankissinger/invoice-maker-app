import type { BusinessProfile, Client, InvoiceDocument, Payment, SyncChange, SyncType } from '../../src/lib/types';
import type { Queryable } from './db';

export type RecordRow = {
  type: SyncType;
  id: string;
  data: any;
  updated_at: Date | string;
  deleted: boolean;
  seq: string | number;
};

export const iso = (value: Date | string) => new Date(value).toISOString();

export function toChange(row: RecordRow): SyncChange & { seq: number } {
  return { type: row.type, id: row.id, updatedAt: iso(row.updated_at), deleted: row.deleted, data: row.data, seq: Number(row.seq) };
}

export async function getRecord(q: Queryable, userId: string, type: SyncType, id: string, forUpdate = false) {
  const { rows } = await q.query<RecordRow>(
    `SELECT type, id, data, updated_at, deleted, seq FROM records WHERE user_id = $1 AND type = $2 AND id = $3${forUpdate ? ' FOR UPDATE' : ''}`,
    [userId, type, id]
  );
  return rows[0];
}

export async function writeRecord(
  q: Queryable,
  userId: string,
  type: SyncType,
  id: string,
  data: unknown,
  updatedAt: string,
  deleted: boolean
): Promise<number> {
  const { rows } = await q.query<{ seq: string }>(
    `INSERT INTO records (user_id, type, id, data, updated_at, deleted, seq)
     VALUES ($1, $2, $3, $4, $5, $6, nextval('records_seq'))
     ON CONFLICT (user_id, type, id) DO UPDATE
       SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at, deleted = EXCLUDED.deleted, seq = EXCLUDED.seq
     RETURNING seq`,
    [userId, type, id, deleted ? null : JSON.stringify(data), updatedAt, deleted]
  );
  return Number(rows[0].seq);
}

/** Live (non-deleted) record data, or undefined. */
export async function getData<T>(q: Queryable, userId: string, type: SyncType, id: string): Promise<T | undefined> {
  const row = await getRecord(q, userId, type, id);
  return row && !row.deleted ? (row.data as T) : undefined;
}

export const getDocument = (q: Queryable, userId: string, id: string) => getData<InvoiceDocument>(q, userId, 'document', id);
export const getProfile = (q: Queryable, userId: string) => getData<BusinessProfile>(q, userId, 'profile', 'profile');
export const getClient = (q: Queryable, userId: string, id: string | undefined) =>
  id ? getData<Client>(q, userId, 'client', id) : Promise.resolve(undefined);

/**
 * Re-applies fields only the server can know (online payments, first view, share link) onto a
 * document, so a device pushing a stale copy can never erase them. Returns null when unchanged.
 */
export async function mergeServerOwned(q: Queryable, userId: string, doc: InvoiceDocument): Promise<InvoiceDocument | null> {
  const [payments, shares] = await Promise.all([
    q.query<{ payment: Payment }>(`SELECT payment FROM online_payments WHERE user_id = $1 AND doc_id = $2 ORDER BY created_at`, [userId, doc.id]),
    q.query<{ viewed_at: Date | null }>(`SELECT viewed_at FROM shares WHERE user_id = $1 AND doc_id = $2`, [userId, doc.id]),
  ]);
  let changed = false;
  const next: InvoiceDocument = { ...doc, payments: Array.isArray(doc.payments) ? [...doc.payments] : [] };
  for (const { payment } of payments.rows) {
    if (!next.payments.some((p) => p.id === payment.id)) {
      next.payments.push(payment);
      changed = true;
    }
  }
  const viewedAt = shares.rows[0]?.viewed_at;
  if (viewedAt && !next.viewedAt) {
    next.viewedAt = iso(viewedAt);
    changed = true;
  }
  return changed ? next : null;
}

/**
 * Server-side edit of a document inside a transaction. Bumps updatedAt so every device
 * pulls the new version. `fn` may return null to skip the write.
 */
export async function mutateDocument(
  tx: Queryable,
  userId: string,
  docId: string,
  now: Date,
  fn: (doc: InvoiceDocument) => InvoiceDocument | null
): Promise<InvoiceDocument | undefined> {
  const row = await getRecord(tx, userId, 'document', docId, true);
  if (!row || row.deleted) return undefined;
  const updated = fn(row.data as InvoiceDocument);
  if (!updated) return row.data as InvoiceDocument;
  // Keep timestamps strictly increasing even if a device clock ran ahead of ours.
  const updatedAt = new Date(Math.max(now.getTime(), new Date(row.updated_at).getTime() + 1)).toISOString();
  const next = { ...updated, updatedAt };
  await writeRecord(tx, userId, 'document', docId, next, updatedAt, false);
  return next;
}
