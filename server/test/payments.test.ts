import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { change, createTestContext, makeInvoice } from './helpers';

let t: Awaited<ReturnType<typeof createTestContext>>;
before(async () => {
  t = await createTestContext();
});
after(() => t.close());

const profile = {
  id: 'profile',
  name: 'Bright Studio',
  email: 'owner@bright.studio',
  accentColor: '#7C3AED',
  timeZone: 'America/Chicago',
  updatedAt: '2026-09-20T10:00:00.000Z',
};
const client = { id: 'client-1', name: 'Acme Co.', email: 'ap@acme.com', createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-20T10:00:00.000Z' };

async function setup(email: string) {
  const session = await t.signIn(email);
  const doc = makeInvoice();
  const res = await t.api()
    .post('/v1/sync')
    .set(session.auth)
    .send({ cursor: 0, changes: [change('profile', profile), change('client', client), change('document', doc)] })
    .expect(200);
  await t.api().post('/v1/devices').set(session.auth).send({ token: 'ExponentPushToken[abc123456]', platform: 'ios' }).expect(200);
  return { ...session, doc, cursor: res.body.cursor as number };
}

test('full pay-online flow: send, view, pay, webhook, sync', async () => {
  const s = await setup('pay@example.com');

  // Connect Stripe; the account.updated webhook turns on charges.
  const connect = await t.api().post('/v1/stripe/connect').set(s.auth).expect(200);
  assert.match(connect.body.url, /connect\.stripe\.com/);
  await t.api()
    .post('/stripe/webhook')
    .set({ 'stripe-signature': 'valid', 'content-type': 'application/json' })
    .send(JSON.stringify({ kind: 'account_updated', accountId: 'acct_test_1', chargesEnabled: true }))
    .expect(200);

  // Email the invoice to the client.
  const sent = await t.api().post('/v1/documents/doc-1/send').set(s.auth).send({ to: 'ap@acme.com', message: 'Thanks!' }).expect(200);
  const email = t.emails.at(-1)!;
  assert.equal(email.to, 'ap@acme.com');
  assert.equal(email.fromName, 'Bright Studio');
  assert.equal(email.replyTo, 'owner@bright.studio');
  assert.match(email.subject, /Invoice INV0001 from Bright Studio/);
  assert.match(email.text, /View & pay \$550\.00/);
  const url: string = sent.body.url;
  assert.ok(email.text.includes(url));
  assert.equal(sent.body.document.lastSentTo, 'ap@acme.com');
  const path = new URL(url).pathname;

  // The owner's preview doesn't count as a view.
  await t.api().get(`${path}?preview=1`).expect(200);
  assert.equal(t.pushes.length, 0);

  // The client opens the link: page renders with a pay button, owner gets one push.
  const page = await t.api().get(path).expect(200);
  assert.match(page.text, /INV0001/);
  assert.match(page.text, /Pay \$550\.00/);
  assert.match(page.headers['content-security-policy'], /form-action 'self' https:\/\/checkout\.stripe\.com/);
  await t.api().get(path).expect(200);
  assert.equal(t.pushes.length, 1);
  assert.match(t.pushes[0].title, /Acme Co\. viewed invoice INV0001/);

  // Pay: redirected to Stripe Checkout for the balance, with a 1% platform fee.
  const pay = await t.api().post(`${path}/pay`).expect(303);
  assert.match(pay.headers.location, /checkout\.stripe\.com/);
  const checkout = t.checkouts.at(-1)!;
  assert.equal(checkout.amountMinor, 55000);
  assert.equal(checkout.applicationFeeMinor, 550);
  assert.equal(checkout.accountId, 'acct_test_1');
  assert.equal(checkout.customerEmail, 'ap@acme.com');
  assert.deepEqual(checkout.metadata, { userId: s.user.id, docId: 'doc-1', token: path.split('/').pop() });

  // Meanwhile a device edits the invoice offline without the payment...
  const offlineEdit = { ...s.doc, notes: 'edited offline', updatedAt: '2026-09-24T15:30:00.000Z' };

  // ...and Stripe confirms the payment (twice — webhooks can repeat).
  const paid = JSON.stringify({ kind: 'checkout_paid', sessionId: 'cs_1', accountId: 'acct_test_1', amountMinor: 55000, currency: 'usd', metadata: checkout.metadata });
  for (let i = 0; i < 2; i++) {
    await t.api().post('/stripe/webhook').set({ 'stripe-signature': 'valid', 'content-type': 'application/json' }).send(paid).expect(200);
  }
  assert.equal(t.pushes.filter((p) => p.title.startsWith('Payment received')).length, 1);
  assert.match(t.pushes.at(-1)!.body, /Acme Co\. paid \$550\.00 on invoice INV0001/);

  // The stale offline copy syncs later with a newer clock: the payment must survive.
  const synced = await t.api().post('/v1/sync').set(s.auth).send({ cursor: s.cursor, changes: [change('document', offlineEdit)] }).expect(200);
  const doc = synced.body.changes.find((c: { id: string }) => c.id === 'doc-1').data;
  assert.equal(doc.notes, 'edited offline');
  assert.equal(doc.payments.length, 1);
  assert.equal(doc.payments[0].amount, 550);
  assert.equal(doc.payments[0].source, 'stripe');
  assert.equal(doc.payments[0].date, '2026-09-24');
  assert.ok(doc.viewedAt);
  assert.ok(new Date(doc.updatedAt) > new Date(offlineEdit.updatedAt));

  // Paid in full: the page says so and no longer offers to pay.
  const after = await t.api().get(path).expect(200);
  assert.match(after.text, /paid in full/);
  assert.doesNotMatch(after.text, /Pay \$/);
  await t.api().post(`${path}/pay`).expect(303).expect('location', path);
});

test('rejects bad webhook signatures and mismatched accounts', async () => {
  await t.api().post('/stripe/webhook').set({ 'stripe-signature': 'forged', 'content-type': 'application/json' }).send('{}').expect(400);

  const s = await setup('mismatch@example.com');
  const evil = JSON.stringify({
    kind: 'checkout_paid',
    sessionId: 'cs_evil',
    accountId: 'acct_attacker',
    amountMinor: 1,
    currency: 'usd',
    metadata: { userId: s.user.id, docId: 'doc-1' },
  });
  await t.api().post('/stripe/webhook').set({ 'stripe-signature': 'valid', 'content-type': 'application/json' }).send(evil).expect(200);
  const { rows } = await t.db.query(`SELECT 1 FROM online_payments WHERE id = 'cs_evil'`);
  assert.equal(rows.length, 0);
});

test('unknown links 404 and sharing requires a synced document', async () => {
  await t.api().get('/i/does-not-exist').expect(404);
  const s = await t.signIn('noshare@example.com');
  const res = await t.api().post('/v1/documents/nope/share').set(s.auth).expect(404);
  assert.equal(res.body.error, 'not_synced');
});

test('no pay button until Stripe charges are enabled', async () => {
  const s = await setup('nostripe@example.com');
  const share = await t.api().post('/v1/documents/doc-1/share').set(s.auth).expect(200);
  const page = await t.api().get(`${new URL(share.body.url).pathname}?preview=1`).expect(200);
  assert.doesNotMatch(page.text, /Pay \$/);
  assert.match(page.text, /Balance due/);
});
