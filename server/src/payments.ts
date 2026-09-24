import { localDateParts } from '../../src/lib/calc';
import { formatMoney } from '../../src/lib/format';
import type { Payment } from '../../src/lib/types';
import { HttpError, type Context } from './context';
import { notifyUser } from './notify';
import { getClient, getProfile, mutateDocument } from './records';
import { fromMinorUnits, type PaymentEvent, type PaymentsGateway } from './services';

export function gateway(ctx: Context): PaymentsGateway {
  if (!ctx.payments) throw new HttpError(503, 'payments_not_configured', 'Online payments are not configured on this server.');
  return ctx.payments;
}

export async function connectStripe(ctx: Context, userId: string, email: string): Promise<string> {
  const stripe = gateway(ctx);
  const { rows } = await ctx.db.query<{ stripe_account_id: string | null }>(`SELECT stripe_account_id FROM users WHERE id = $1`, [userId]);
  let accountId = rows[0]?.stripe_account_id;
  if (!accountId) {
    accountId = await stripe.createAccount(email, userId);
    await ctx.db.query(`UPDATE users SET stripe_account_id = $2 WHERE id = $1`, [userId, accountId]);
  }
  const base = ctx.config.publicUrl;
  return stripe.onboardingLink(accountId, `${base}/stripe/return?refresh=1`, `${base}/stripe/return`);
}

export async function stripeStatus(ctx: Context, userId: string) {
  const { rows } = await ctx.db.query<{ stripe_account_id: string | null }>(`SELECT stripe_account_id FROM users WHERE id = $1`, [userId]);
  const accountId = rows[0]?.stripe_account_id;
  if (!accountId || !ctx.payments) {
    return { configured: !!ctx.payments, connected: false, chargesEnabled: false, detailsSubmitted: false };
  }
  const account = await ctx.payments.getAccount(accountId);
  await ctx.db.query(`UPDATE users SET stripe_charges_enabled = $2 WHERE id = $1`, [userId, account.chargesEnabled]);
  return { configured: true, connected: true, ...account };
}

export async function stripeDashboard(ctx: Context, userId: string): Promise<string> {
  const { rows } = await ctx.db.query<{ stripe_account_id: string | null }>(`SELECT stripe_account_id FROM users WHERE id = $1`, [userId]);
  if (!rows[0]?.stripe_account_id) throw new HttpError(400, 'not_connected');
  return gateway(ctx).dashboardLink(rows[0].stripe_account_id);
}

/** Applies a verified Stripe event. Idempotent: replays of the same checkout are ignored. */
export async function handlePaymentEvent(ctx: Context, event: PaymentEvent): Promise<void> {
  if (event.kind === 'account_updated') {
    await ctx.db.query(`UPDATE users SET stripe_charges_enabled = $2 WHERE stripe_account_id = $1`, [event.accountId, event.chargesEnabled]);
    return;
  }
  if (event.kind !== 'checkout_paid') return;

  const { userId, docId } = event.metadata;
  if (!userId || !docId) return;
  const { rows } = await ctx.db.query<{ stripe_account_id: string | null }>(`SELECT stripe_account_id FROM users WHERE id = $1`, [userId]);
  // Only trust metadata that belongs to the account the event came from.
  if (!rows[0] || (event.accountId && rows[0].stripe_account_id !== event.accountId)) {
    console.warn(`Ignoring checkout ${event.sessionId}: account mismatch`);
    return;
  }

  const profile = await getProfile(ctx.db, userId);
  const payment: Payment = {
    id: `stripe_${event.sessionId}`,
    date: localDateParts(ctx.now(), profile?.timeZone).date,
    amount: fromMinorUnits(event.amountMinor, event.currency),
    method: 'card',
    note: 'Paid online',
    source: 'stripe',
  };

  const doc = await ctx.db.tx(async (tx) => {
    const { rows: inserted } = await tx.query(
      `INSERT INTO online_payments (id, user_id, doc_id, payment) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [event.sessionId, userId, docId, JSON.stringify(payment)]
    );
    if (inserted.length === 0) return undefined; // already processed
    return mutateDocument(tx, userId, docId, ctx.now(), (d) =>
      d.payments.some((p) => p.id === payment.id)
        ? null
        : { ...d, payments: [...d.payments, payment], status: d.status === 'draft' ? 'sent' : d.status }
    );
  });
  if (!doc) return;

  const client = await getClient(ctx.db, userId, doc.clientId);
  await notifyUser(
    ctx,
    userId,
    'Payment received 🎉',
    `${client?.name ?? 'A client'} paid ${formatMoney(payment.amount, doc.currency)} on invoice ${doc.number}.`,
    { docId }
  );
}
