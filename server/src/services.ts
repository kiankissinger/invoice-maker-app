import Stripe from 'stripe';

import type { Config } from './config';

// ---------- Email ----------

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Display name for the From header (the sending address comes from config). */
  fromName?: string;
  replyTo?: string;
};

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

export function createMailer(config: Config): Mailer {
  if (!config.resendApiKey || !config.emailFrom) {
    return {
      async send(message) {
        console.log(`[email:dev] to=${message.to} subject="${message.subject}"\n${message.text}`);
      },
    };
  }
  return {
    async send(message) {
      const fromName = (message.fromName ?? config.appName).replace(/[<>"]/g, '');
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${fromName} <${config.emailFrom}>`,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          reply_to: message.replyTo || undefined,
        }),
      });
      if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
    },
  };
}

// ---------- Push notifications (Expo) ----------

export type PushMessage = { to: string; title: string; body: string; data?: Record<string, unknown> };

export interface Pusher {
  /** Returns the tokens Expo reported as no longer registered, so callers can delete them. */
  send(messages: PushMessage[]): Promise<string[]>;
}

export function createPusher(config: Config): Pusher {
  return {
    async send(messages) {
      if (messages.length === 0) return [];
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.expoAccessToken ? { Authorization: `Bearer ${config.expoAccessToken}` } : {}),
        },
        body: JSON.stringify(messages.map((m) => ({ ...m, sound: 'default' }))),
      });
      if (!res.ok) throw new Error(`Expo push error ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      return (json.data ?? [])
        .map((ticket, i) => (ticket.details?.error === 'DeviceNotRegistered' ? messages[i].to : null))
        .filter((t): t is string => t !== null);
    },
  };
}

// ---------- Stripe Connect ----------

export type CheckoutParams = {
  accountId: string;
  currency: string;
  amountMinor: number;
  applicationFeeMinor: number;
  description: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
};

export type PaymentEvent =
  | {
      kind: 'checkout_paid';
      sessionId: string;
      accountId?: string;
      amountMinor: number;
      currency: string;
      metadata: Record<string, string>;
    }
  | { kind: 'account_updated'; accountId: string; chargesEnabled: boolean }
  | { kind: 'ignored'; type: string };

export interface PaymentsGateway {
  createAccount(email: string, userId: string): Promise<string>;
  onboardingLink(accountId: string, refreshUrl: string, returnUrl: string): Promise<string>;
  getAccount(accountId: string): Promise<{ chargesEnabled: boolean; detailsSubmitted: boolean }>;
  dashboardLink(accountId: string): Promise<string>;
  createCheckout(params: CheckoutParams): Promise<string>;
  /** Verifies the signature and normalizes the events we care about. Throws on a bad signature. */
  parseWebhook(rawBody: Buffer, signature: string): PaymentEvent;
}

export function createStripeGateway(config: Config): PaymentsGateway | null {
  if (!config.stripeSecretKey) return null;
  const stripe = new Stripe(config.stripeSecretKey);
  return {
    async createAccount(email, userId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email,
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { userId },
      });
      return account.id;
    },
    async onboardingLink(accountId, refreshUrl, returnUrl) {
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      });
      return link.url;
    },
    async getAccount(accountId) {
      const account = await stripe.accounts.retrieve(accountId);
      return { chargesEnabled: account.charges_enabled ?? false, detailsSubmitted: account.details_submitted ?? false };
    },
    async dashboardLink(accountId) {
      const link = await stripe.accounts.createLoginLink(accountId);
      return link.url;
    },
    async createCheckout(p) {
      // Direct charge on the connected account: the business is the merchant of record.
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          line_items: [
            {
              quantity: 1,
              price_data: { currency: p.currency.toLowerCase(), unit_amount: p.amountMinor, product_data: { name: p.description } },
            },
          ],
          customer_email: p.customerEmail,
          success_url: p.successUrl,
          cancel_url: p.cancelUrl,
          metadata: p.metadata,
          payment_intent_data: {
            metadata: p.metadata,
            ...(p.applicationFeeMinor > 0 ? { application_fee_amount: p.applicationFeeMinor } : {}),
          },
        },
        { stripeAccount: p.accountId }
      );
      if (!session.url) throw new Error('Stripe did not return a checkout URL');
      return session.url;
    },
    parseWebhook(rawBody, signature) {
      if (!config.stripeWebhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
      const event = stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
      if (
        (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') &&
        event.data.object.payment_status === 'paid'
      ) {
        const session = event.data.object;
        return {
          kind: 'checkout_paid',
          sessionId: session.id,
          accountId: event.account ?? undefined,
          amountMinor: session.amount_total ?? 0,
          currency: session.currency ?? 'usd',
          metadata: (session.metadata ?? {}) as Record<string, string>,
        };
      }
      if (event.type === 'account.updated') {
        return { kind: 'account_updated', accountId: event.data.object.id, chargesEnabled: event.data.object.charges_enabled ?? false };
      }
      return { kind: 'ignored', type: event.type };
    },
  };
}

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

export function toMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100);
}

export function fromMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? amount : amount / 100;
}

// ---------- RevenueCat entitlements ----------

export interface EntitlementChecker {
  /** Returns whether the RevenueCat app user currently has the Pro entitlement. */
  isPro(userId: string): Promise<boolean>;
}

export function createEntitlementChecker(config: Config): EntitlementChecker {
  if (!config.revenuecatSecretKey) {
    return { isPro: async () => config.allowAllPro };
  }
  return {
    async isPro(userId) {
      const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${config.revenuecatSecretKey}` },
      });
      if (!res.ok) throw new Error(`RevenueCat error ${res.status}`);
      const json = (await res.json()) as {
        subscriber?: { entitlements?: Record<string, { expires_date: string | null }> };
      };
      const entitlement = json.subscriber?.entitlements?.[config.revenuecatEntitlement];
      if (!entitlement) return false;
      return entitlement.expires_date === null || new Date(entitlement.expires_date).getTime() > Date.now();
    },
  };
}
