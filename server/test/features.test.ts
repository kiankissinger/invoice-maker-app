import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { runLateFees } from '../src/jobs';
import { change, createTestContext, makeInvoice } from './helpers';

let t: Awaited<ReturnType<typeof createTestContext>>;
before(async () => {
  t = await createTestContext();
});
after(() => t.close());

const hook = (body: unknown) =>
  t.api().post('/stripe/webhook').set({ 'stripe-signature': 'valid', 'content-type': 'application/json' }).send(JSON.stringify(body));

async function connectedUser(email: string) {
  const s = await t.signIn(email);
  await t.api().post('/v1/stripe/connect').set(s.auth).expect(200);
  const { rows } = await t.db.query<{ stripe_account_id: string }>(`SELECT stripe_account_id FROM users WHERE id = $1`, [s.user.id]);
  const accountId = rows[0].stripe_account_id;
  await hook({ kind: 'account_updated', accountId, chargesEnabled: true }).expect(200);
  await t.api().post('/v1/devices').set(s.auth).send({ token: `ExponentPushToken[${email}]`, platform: 'ios' }).expect(200);
  return { ...s, accountId };
}

test('client approves an estimate online, then pays the deposit', async () => {
  const s = await connectedUser('estimate@example.com');
  const estimate = makeInvoice({
    id: 'est-1',
    type: 'estimate',
    number: 'EST0001',
    status: 'sent',
    items: [{ id: 'i1', description: 'Kitchen remodel', quantity: 1, unitPrice: 8000, taxable: false }],
    taxRate: 0,
    deposit: { kind: 'percent', value: 25 },
  });
  const first = await t.api().post('/v1/sync').set(s.auth).send({ cursor: 0, changes: [change('document', estimate)] }).expect(200);
  const share = await t.api().post('/v1/documents/est-1/share').set(s.auth).expect(200);
  const path = new URL(share.body.url).pathname;

  // Before approval: accept form, no pay button.
  let page = await t.api().get(`${path}?preview=1`).expect(200);
  assert.match(page.text, /Accept estimate/);
  assert.match(page.text, /deposit of \$2,000\.00 is requested/);
  assert.doesNotMatch(page.text, /Pay deposit/);

  // Client signs by name.
  await t.api().post(`${path}/accept`).type('form').send({ name: 'Jane Doe' }).expect(303).expect('location', `${path}?accepted=1`);
  assert.ok(t.pushes.some((p) => p.title === 'Estimate accepted 🎉'));

  page = await t.api().get(`${path}?accepted=1&preview=1`).expect(200);
  assert.match(page.text, /Estimate accepted — thank you! Pay the deposit/);
  assert.match(page.text, /Pay deposit \$2,000\.00/);
  assert.match(page.text, /Accepted by Jane Doe/);
  assert.doesNotMatch(page.text, /name="name"/);

  // Accepting twice is a no-op.
  await t.api().post(`${path}/accept`).type('form').send({ name: 'Someone Else' }).expect(303);

  // Pay the deposit.
  await t.api().post(`${path}/pay`).type('form').send({ amount: 'deposit' }).expect(303);
  const checkout = t.checkouts.at(-1)!;
  assert.equal(checkout.amountMinor, 200000);
  assert.equal(checkout.description, 'Deposit for Estimate EST0001');
  assert.equal(checkout.metadata.kind, 'deposit');
  await hook({ kind: 'checkout_paid', sessionId: 'cs_dep', accountId: s.accountId, amountMinor: 200000, currency: 'usd', metadata: checkout.metadata }).expect(200);
  assert.match(t.pushes.at(-1)!.body, /paid \$2,000\.00 deposit on estimate EST0001/);

  const pull = await t.api().post('/v1/sync').set(s.auth).send({ cursor: first.body.cursor, changes: [] }).expect(200);
  const doc = pull.body.changes.find((c: { id: string }) => c.id === 'est-1').data;
  assert.equal(doc.status, 'accepted');
  assert.equal(doc.approval.name, 'Jane Doe');
  assert.deepEqual(doc.payments.map((p: { amount: number; note: string }) => [p.amount, p.note]), [[2000, 'Deposit paid online']]);

  page = await t.api().get(`${path}?preview=1`).expect(200);
  assert.doesNotMatch(page.text, /Pay deposit/);
});

test('invoices offer deposit or full payment until the deposit is covered', async () => {
  const s = await connectedUser('deposit-invoice@example.com');
  const invoice = makeInvoice({ id: 'inv-dep', deposit: { kind: 'amount', value: 100 } }); // total 550
  await t.api().post('/v1/sync').set(s.auth).send({ cursor: 0, changes: [change('document', invoice)] }).expect(200);
  const share = await t.api().post('/v1/documents/inv-dep/share').set(s.auth).expect(200);
  const path = new URL(share.body.url).pathname;

  const page = await t.api().get(`${path}?preview=1`).expect(200);
  assert.match(page.text, /Pay deposit \$100\.00/);
  assert.match(page.text, /Pay in full \$550\.00/);

  await t.api().post(`${path}/pay`).type('form').send({ amount: 'balance' }).expect(303);
  assert.equal(t.checkouts.at(-1)!.amountMinor, 55000);
  await t.api().post(`${path}/pay`).type('form').send({ amount: 'deposit' }).expect(303);
  assert.equal(t.checkouts.at(-1)!.amountMinor, 10000);
});

test('late fees are added once after the grace period', async () => {
  const s = await t.signIn('latefee@example.com');
  await t.api().post('/v1/devices').set(s.auth).send({ token: 'ExponentPushToken[latefee]', platform: 'ios' }).expect(200);
  const profile = {
    id: 'profile',
    timeZone: 'UTC',
    lateFee: { enabled: true, kind: 'percent', value: 2, graceDays: 5 },
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
  const overdue = makeInvoice({ id: 'late', dueDate: '2026-09-10' }); // 550 due
  const draft = makeInvoice({ id: 'late-draft', status: 'draft', dueDate: '2026-09-10' });
  const first = await t.api()
    .post('/v1/sync')
    .set(s.auth)
    .send({ cursor: 0, changes: [change('profile', profile), change('document', overdue), change('document', draft)] })
    .expect(200);

  t.clock.now = new Date('2026-09-15T12:00:00Z'); // 5 days late: still in grace
  await runLateFees(t.ctx);
  let pull = await t.api().post('/v1/sync').set(s.auth).send({ cursor: first.body.cursor, changes: [] }).expect(200);
  assert.equal(pull.body.changes.length, 0);

  t.clock.now = new Date('2026-09-16T12:00:00Z');
  await runLateFees(t.ctx);
  await runLateFees(t.ctx);
  pull = await t.api().post('/v1/sync').set(s.auth).send({ cursor: first.body.cursor, changes: [] }).expect(200);
  assert.equal(pull.body.changes.length, 1);
  const doc = pull.body.changes[0].data;
  assert.equal(doc.id, 'late');
  const fees = doc.items.filter((i: { id: string }) => i.id === 'late-fee');
  assert.equal(fees.length, 1);
  assert.equal(fees[0].unitPrice, 11);
  assert.ok(doc.lateFeeAppliedAt);
  assert.match(t.pushes.at(-1)!.body, /\$11\.00 added to overdue invoice INV0001/);
});

test('AI endpoints need Pro and pass the saved catalog to the drafter', async () => {
  const free = await t.signIn('ai-free@example.com', { pro: false });
  await t.api().post('/v1/ai/draft-items').set(free.auth).send({ description: 'Fix sink' }).expect(402);

  const s = await t.signIn('ai@example.com');
  await t.api()
    .post('/v1/sync')
    .set(s.auth)
    .send({
      cursor: 0,
      changes: [
        change('catalog', { id: 'c1', description: 'Service call', unitPrice: 95, unit: 'visit', updatedAt: '2026-09-01T00:00:00.000Z' } as never),
        change('profile', { id: 'profile', name: 'Bob’s Plumbing', updatedAt: '2026-09-01T00:00:00.000Z' } as never),
      ],
    })
    .expect(200);

  const draft = await t.api().post('/v1/ai/draft-items').set(s.auth).send({ description: 'Replaced water heater, 4 hours labor', currency: 'USD' }).expect(200);
  assert.equal(draft.body.items[0].unitPrice, 85);
  const ctx = t.aiCalls.drafts.at(-1)!;
  assert.equal(ctx.businessName, 'Bob’s Plumbing');
  assert.deepEqual(ctx.catalog.map((c) => c.description), ['Service call']);

  const receipt = await t.api().post('/v1/ai/receipt').set(s.auth).send({ image: 'A'.repeat(200) }).expect(200);
  assert.equal(receipt.body.vendor, 'Home Depot');
  await t.api().post('/v1/ai/receipt').set(s.auth).send({ image: 'short' }).expect(400);
});

test('expenses sync like other records', async () => {
  const s = await t.signIn('expenses@example.com');
  const expense = { id: 'e1', vendor: 'Shell', amount: 60, category: 'Fuel & travel', date: '2026-09-20', updatedAt: '2026-09-20T00:00:00.000Z' };
  await t.api().post('/v1/sync').set(s.auth).send({ cursor: 0, changes: [change('expense', expense)] }).expect(200);
  const pull = await t.api().post('/v1/sync').set(s.auth).send({ cursor: 0, changes: [] }).expect(200);
  assert.equal(pull.body.changes[0].type, 'expense');
});
