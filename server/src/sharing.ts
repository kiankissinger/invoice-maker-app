import { randomBytes } from 'node:crypto';

import { computeTotals, depositStatus } from '../../src/lib/calc';
import type { InvoiceDocument } from '../../src/lib/types';
import { HttpError, type Context } from './context';
import type { Queryable } from './db';
import { documentEmail, type DocumentEmailKind } from './emails';
import { getClient, getDocument, getProfile, mutateDocument } from './records';

export const shareUrl = (ctx: Context, token: string) => `${ctx.config.publicUrl}/i/${token}`;

/** Returns the hosted link for a document, creating it on first use. */
export async function ensureShare(ctx: Context, q: Queryable, userId: string, docId: string): Promise<string> {
  const token = randomBytes(18).toString('base64url');
  await q.query(`INSERT INTO shares (token, user_id, doc_id) VALUES ($1, $2, $3) ON CONFLICT (user_id, doc_id) DO NOTHING`, [
    token,
    userId,
    docId,
  ]);
  const { rows } = await q.query<{ token: string }>(`SELECT token FROM shares WHERE user_id = $1 AND doc_id = $2`, [userId, docId]);
  return shareUrl(ctx, rows[0].token);
}

export async function paymentsEnabled(q: Queryable, userId: string): Promise<boolean> {
  const { rows } = await q.query<{ ok: boolean }>(
    `SELECT (stripe_account_id IS NOT NULL AND stripe_charges_enabled) AS ok FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0]?.ok ?? false;
}

export type Payable = { deposit?: number; balance?: number };

/** What the client can pay online right now: the outstanding deposit and/or the full balance. */
export function payableAmounts(doc: InvoiceDocument, stripeReady: boolean): Payable {
  if (!stripeReady || doc.status === 'void' || doc.allowOnlinePayment === false) return {};
  const { balance } = computeTotals(doc);
  const { outstanding } = depositStatus(doc);
  if (doc.type === 'estimate') {
    return doc.status === 'accepted' && outstanding > 0 ? { deposit: outstanding } : {};
  }
  if (balance <= 0) return {};
  return outstanding > 0 && outstanding < balance ? { deposit: outstanding, balance } : { balance };
}

export const canPayOnline = (doc: InvoiceDocument, stripeReady: boolean) => {
  const p = payableAmounts(doc, stripeReady);
  return p.deposit !== undefined || p.balance !== undefined;
};

/** Shares the document, stores the link on it and returns the updated document. */
export async function shareDocument(ctx: Context, userId: string, docId: string) {
  return ctx.db.tx(async (tx) => {
    const url = await ensureShare(ctx, tx, userId, docId);
    const doc = await mutateDocument(tx, userId, docId, ctx.now(), (d) => (d.shareUrl === url ? null : { ...d, shareUrl: url }));
    if (!doc) throw new HttpError(404, 'not_synced', 'Sync this document before sharing it.');
    return { url, doc };
  });
}

/** Emails a document (or a reminder about it) to `to` and records the send on the document. */
export async function emailDocument(
  ctx: Context,
  userId: string,
  docId: string,
  to: string,
  kind: DocumentEmailKind,
  message?: string
): Promise<{ url: string; doc: InvoiceDocument }> {
  const { url } = await shareDocument(ctx, userId, docId);
  const [doc, profile, stripeReady] = await Promise.all([
    getDocument(ctx.db, userId, docId),
    getProfile(ctx.db, userId),
    paymentsEnabled(ctx.db, userId),
  ]);
  if (!doc) throw new HttpError(404, 'not_found');
  const client = await getClient(ctx.db, userId, doc.clientId);

  await ctx.mailer.send(documentEmail({ kind, to, doc, client, profile, url, message, canPayOnline: canPayOnline(doc, stripeReady) }));

  const sentAt = ctx.now().toISOString();
  const updated = await ctx.db.tx((tx) =>
    mutateDocument(tx, userId, docId, ctx.now(), (d) =>
      kind === 'send' ? { ...d, sentAt, lastSentTo: to, status: d.status === 'draft' ? 'sent' : d.status } : null
    )
  );
  return { url, doc: updated ?? doc };
}
