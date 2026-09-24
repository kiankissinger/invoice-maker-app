import { PGlite } from '@electric-sql/pglite';
import request from 'supertest';

import type { InvoiceDocument } from '../../src/lib/types';
import type { AiService, DraftContext } from '../src/ai';
import { createApp } from '../src/app';
import type { Config } from '../src/config';
import type { Context } from '../src/context';
import { migrate, type Db, type Queryable } from '../src/db';
import type { CheckoutParams, EmailMessage, PaymentEvent, PaymentsGateway, PushMessage } from '../src/services';

export const config: Config = {
  env: 'test',
  port: 0,
  databaseUrl: 'pglite',
  publicUrl: 'https://api.test',
  jwtSecret: 'test-secret-test-secret-test-secret-123',
  appName: 'Invoice Maker',
  appScheme: 'invoicemaker',
  platformFeeBps: 100,
  revenuecatEntitlement: 'pro',
  allowAllPro: false,
  jobsEnabled: false,
  jobsIntervalMinutes: 15,
  authRateLimit: 1000,
};

export async function createTestContext(overrides: Partial<Config> = {}) {
  const pg = new PGlite();
  const wrapQ = (q: { query: PGlite['query'] }): Queryable => ({
    query: (sql, params) => q.query(sql, params as unknown[]) as never,
  });
  const db: Db = {
    ...wrapQ(pg),
    tx: (fn) => pg.transaction((tx) => fn(wrapQ(tx))),
    withLock: async (_key, fn) => {
      await fn();
      return true;
    },
    close: () => pg.close(),
  };
  await migrate(db);

  const emails: EmailMessage[] = [];
  const pushes: PushMessage[] = [];
  const checkouts: CheckoutParams[] = [];
  const proUsers = new Set<string>();
  const clock = { now: new Date('2026-09-24T15:00:00Z') };
  const aiCalls: { receipts: string[]; drafts: DraftContext[] } = { receipts: [], drafts: [] };
  const ai: AiService = {
    scanReceipt: async ({ data }) => {
      aiCalls.receipts.push(data);
      return { vendor: 'Home Depot', date: '2026-09-23', total: 128.4, tax: 9.4, currency: 'USD', category: 'Materials' };
    },
    draftItems: async (context) => {
      aiCalls.drafts.push(context);
      return {
        items: [{ description: 'Labor', details: null, quantity: 4, unitPrice: 85, unit: 'hrs', taxable: false }],
        notes: null,
      };
    },
  };

  let accounts = 0;
  const payments: PaymentsGateway = {
    createAccount: async () => `acct_test_${++accounts}`,
    onboardingLink: async (id) => `https://connect.stripe.com/setup/${id}`,
    getAccount: async () => ({ chargesEnabled: true, detailsSubmitted: true }),
    dashboardLink: async () => 'https://connect.stripe.com/express/dashboard',
    createCheckout: async (params) => {
      checkouts.push(params);
      return `https://checkout.stripe.com/c/pay/cs_test_${checkouts.length}`;
    },
    parseWebhook: (raw, signature) => {
      if (signature !== 'valid') throw new Error('bad signature');
      return JSON.parse(raw.toString()) as PaymentEvent;
    },
  };

  const ctx: Context = {
    config: { ...config, ...overrides },
    db,
    mailer: { send: async (m) => void emails.push(m) },
    pusher: {
      send: async (messages) => {
        pushes.push(...messages);
        return [];
      },
    },
    payments,
    entitlements: { isPro: async (userId) => proUsers.has(userId) },
    ai,
    now: () => clock.now,
  };

  const app = createApp(ctx);
  const api = () => request(app);

  /** Signs a user in through the real email-code flow. */
  async function signIn(email: string, { pro = true } = {}) {
    await api().post('/v1/auth/start').send({ email }).expect(200);
    const code = /(\d{6})/.exec(emails.at(-1)!.subject)![1];
    const res = await api().post('/v1/auth/verify').send({ email, code }).expect(200);
    if (pro) proUsers.add(res.body.user.id);
    const auth = { Authorization: `Bearer ${res.body.token}` };
    return { token: res.body.token as string, user: res.body.user as { id: string; email: string }, auth };
  }

  return { ctx, db, api, emails, pushes, checkouts, proUsers, clock, aiCalls, signIn, close: () => pg.close() };
}

export function makeInvoice(overrides: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    id: 'doc-1',
    type: 'invoice',
    number: 'INV0001',
    status: 'sent',
    clientId: 'client-1',
    issueDate: '2026-09-20',
    dueDate: '2026-10-04',
    items: [{ id: 'i1', description: 'Design', quantity: 2, unitPrice: 250, taxable: true }],
    discount: { kind: 'percent', value: 0 },
    taxRate: 10,
    taxLabel: 'Tax',
    shipping: 0,
    notes: '',
    terms: '',
    payments: [],
    currency: 'USD',
    templateId: 'classic',
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

export const change = (type: string, data: { id: string; updatedAt?: string }, updatedAt = data.updatedAt!) => ({
  type,
  id: data.id,
  updatedAt,
  deleted: false,
  data,
});
