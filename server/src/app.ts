import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { isPro, requirePro, requireUser, startLogin, verifyLogin } from './auth';
import { HttpError, type Context } from './context';
import { notifyUser } from './notify';
import { connectStripe, gateway, handlePaymentEvent, stripeDashboard, stripeStatus } from './payments';
import { hostedInvoicePage, simplePage } from './public-page';
import { getClient, getDocument, getProfile, mutateDocument } from './records';
import { toMinorUnits } from './services';
import { canPayOnline, emailDocument, paymentsEnabled, shareDocument } from './sharing';
import { sync, syncRequestSchema } from './sync';
import { computeTotals } from '../../src/lib/calc';

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'invalid_request', result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
}

/** Small fixed-window limiter per IP; enough to stop code-spamming from one machine. */
function rateLimit(max: number, windowMs: number, now: () => Date) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const t = now().getTime();
    const key = req.ip ?? 'unknown';
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      if (hits.size > 10_000) hits.clear();
      hits.set(key, { count: 1, resetAt: t + windowMs });
      return next();
    }
    if (++entry.count > max) return next(new HttpError(429, 'rate_limited', 'Too many requests. Try again in a few minutes.'));
    next();
  };
}

const PUBLIC_CSP =
  "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self' https://checkout.stripe.com; base-uri 'none'; frame-ancestors 'none'";

export function createApp(ctx: Context) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Stripe needs the raw body for signature verification, so this route comes before express.json().
  app.post(
    '/stripe/webhook',
    express.raw({ type: 'application/json', limit: '1mb' }),
    wrap(async (req, res) => {
      let event;
      try {
        event = gateway(ctx).parseWebhook(req.body as Buffer, String(req.headers['stripe-signature'] ?? ''));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, 'invalid_signature');
      }
      await handlePaymentEvent(ctx, event);
      res.json({ received: true });
    })
  );

  // Bearer tokens (no cookies), so allowing any origin is safe; only needed for the web build.
  app.use('/v1', (req, res, next) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Max-Age': '86400',
    });
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });

  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', wrap(async (_req, res) => {
    await ctx.db.query('SELECT 1');
    res.json({ ok: true });
  }));

  // ---------- Auth ----------

  app.use('/v1/auth', rateLimit(ctx.config.authRateLimit, 15 * 60_000, ctx.now));

  app.post('/v1/auth/start', wrap(async (req, res) => {
    const { email } = parse(z.object({ email: z.string().trim().email() }), req.body);
    await startLogin(ctx, email);
    res.json({ ok: true });
  }));

  app.post('/v1/auth/verify', wrap(async (req, res) => {
    const { email, code } = parse(z.object({ email: z.string().trim().email(), code: z.string().regex(/^\s*\d{6}\s*$/) }), req.body);
    res.json(await verifyLogin(ctx, email, code.trim()));
  }));

  const authed = express.Router();
  authed.use(requireUser(ctx));

  authed.get('/me', wrap(async (req, res) => {
    const force = req.query.refresh === '1';
    const pro = await isPro(ctx, req.user!.id, force);
    const { rows } = await ctx.db.query<{ stripe_account_id: string | null; stripe_charges_enabled: boolean }>(
      `SELECT stripe_account_id, stripe_charges_enabled FROM users WHERE id = $1`,
      [req.user!.id]
    );
    res.json({
      user: req.user,
      isPro: pro,
      payments: {
        configured: !!ctx.payments,
        connected: !!rows[0]?.stripe_account_id,
        chargesEnabled: !!rows[0]?.stripe_charges_enabled,
      },
    });
  }));

  authed.delete('/me', wrap(async (req, res) => {
    await ctx.db.query(`DELETE FROM users WHERE id = $1`, [req.user!.id]);
    res.json({ ok: true });
  }));

  authed.post('/devices', wrap(async (req, res) => {
    const { token, platform } = parse(z.object({ token: z.string().min(10).max(300), platform: z.string().max(20).optional() }), req.body);
    await ctx.db.query(
      `INSERT INTO devices (push_token, user_id, platform, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (push_token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`,
      [token, req.user!.id, platform ?? null]
    );
    res.json({ ok: true });
  }));

  authed.delete('/devices/:token', wrap(async (req, res) => {
    await ctx.db.query(`DELETE FROM devices WHERE push_token = $1 AND user_id = $2`, [req.params.token, req.user!.id]);
    res.json({ ok: true });
  }));

  // ---------- Pro features ----------

  const pro = requirePro(ctx);

  authed.post('/sync', pro, wrap(async (req, res) => {
    res.json(await sync(ctx, req.user!.id, parse(syncRequestSchema, req.body)));
  }));

  authed.post('/documents/:id/share', pro, wrap(async (req, res) => {
    const { url, doc } = await shareDocument(ctx, req.user!.id, String(req.params.id));
    res.json({ url, document: doc });
  }));

  authed.post('/documents/:id/send', pro, wrap(async (req, res) => {
    const { to, message } = parse(z.object({ to: z.string().email(), message: z.string().max(2000).optional() }), req.body);
    const { url, doc } = await emailDocument(ctx, req.user!.id, String(req.params.id), to, 'send', message?.trim() || undefined);
    res.json({ url, document: doc });
  }));

  authed.post('/stripe/connect', pro, wrap(async (req, res) => {
    res.json({ url: await connectStripe(ctx, req.user!.id, req.user!.email) });
  }));

  authed.get('/stripe/status', wrap(async (req, res) => {
    res.json(await stripeStatus(ctx, req.user!.id));
  }));

  authed.post('/stripe/dashboard', wrap(async (req, res) => {
    res.json({ url: await stripeDashboard(ctx, req.user!.id) });
  }));

  app.use('/v1', authed);

  // ---------- Public hosted invoice ----------

  const loadShare = async (token: string) => {
    const { rows } = await ctx.db.query<{ user_id: string; doc_id: string; viewed_at: Date | null }>(
      `SELECT user_id, doc_id, viewed_at FROM shares WHERE token = $1`,
      [token]
    );
    const share = rows[0];
    if (!share) return undefined;
    const doc = await getDocument(ctx.db, share.user_id, share.doc_id);
    return doc ? { share, doc } : undefined;
  };

  const notFound = (res: Response) =>
    res.status(404).type('html').send(simplePage('Link not found', '<p>This link is no longer available. Please contact the sender.</p>'));

  app.get('/i/:token', wrap(async (req, res) => {
    const token = String(req.params.token);
    const found = await loadShare(token);
    if (!found) return notFound(res);
    const { share, doc: loaded } = found;
    let doc = loaded;

    // First open by the client (the app's own preview passes ?preview=1).
    if (!share.viewed_at && req.query.preview !== '1') {
      const now = ctx.now();
      const { rows } = await ctx.db.query(
        `UPDATE shares SET viewed_at = $2 WHERE token = $1 AND viewed_at IS NULL RETURNING token`,
        [token, now]
      );
      if (rows.length) {
        doc = (await ctx.db.tx((tx) => mutateDocument(tx, share.user_id, share.doc_id, now, (d) => ({ ...d, viewedAt: now.toISOString() })))) ?? doc;
        const client = await getClient(ctx.db, share.user_id, doc.clientId);
        await notifyUser(
          ctx,
          share.user_id,
          `${client?.name ?? 'Your client'} viewed ${doc.type === 'invoice' ? 'invoice' : 'estimate'} ${doc.number}`,
          'Opened just now.',
          { docId: doc.id }
        );
      }
    }

    const [profile, client, stripeReady] = await Promise.all([
      getProfile(ctx.db, share.user_id),
      getClient(ctx.db, share.user_id, doc.clientId),
      paymentsEnabled(ctx.db, share.user_id),
    ]);
    res
      .set({ 'Content-Security-Policy': PUBLIC_CSP, 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' })
      .type('html')
      .send(
        hostedInvoicePage({
          doc,
          profile,
          client,
          appName: ctx.config.appName,
          token,
          payable: canPayOnline(doc, stripeReady),
          justPaid: req.query.paid === '1',
        })
      );
  }));

  app.post('/i/:token/pay', wrap(async (req, res) => {
    const token = String(req.params.token);
    const found = await loadShare(token);
    if (!found) return notFound(res);
    const { share, doc } = found;
    const { rows } = await ctx.db.query<{ stripe_account_id: string | null; stripe_charges_enabled: boolean }>(
      `SELECT stripe_account_id, stripe_charges_enabled FROM users WHERE id = $1`,
      [share.user_id]
    );
    const accountId = rows[0]?.stripe_account_id;
    if (!accountId || !canPayOnline(doc, rows[0].stripe_charges_enabled)) return res.redirect(303, `/i/${token}`);

    const client = await getClient(ctx.db, share.user_id, doc.clientId);
    const amountMinor = toMinorUnits(computeTotals(doc).balance, doc.currency);
    const url = await gateway(ctx).createCheckout({
      accountId,
      currency: doc.currency,
      amountMinor,
      applicationFeeMinor: Math.floor((amountMinor * ctx.config.platformFeeBps) / 10_000),
      description: `Invoice ${doc.number}`,
      customerEmail: client?.email || undefined,
      successUrl: `${ctx.config.publicUrl}/i/${token}?paid=1`,
      cancelUrl: `${ctx.config.publicUrl}/i/${token}`,
      metadata: { userId: share.user_id, docId: doc.id, token },
    });
    res.redirect(303, url);
  }));

  app.get('/stripe/return', (req, res) => {
    const deepLink = `${ctx.config.appScheme}://payments`;
    const refresh = req.query.refresh === '1';
    res.type('html').send(
      simplePage(
        refresh ? 'Link expired' : 'Stripe setup complete',
        `<p>${refresh ? 'Return to the app and tap “Connect Stripe” again to continue.' : 'You can now accept card payments on your invoices.'}</p>
         <a class="btn" href="${deepLink}">Return to ${ctx.config.appName}</a>`
      )
    );
  });

  // ---------- Errors ----------

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.code, message: error.message });
    if ((error as { type?: string }).type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    console.error(error);
    res.status(500).json({ error: 'internal', message: 'Something went wrong.' });
  });

  return app;
}
