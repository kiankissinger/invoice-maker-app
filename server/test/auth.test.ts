import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createTestContext } from './helpers';

let t: Awaited<ReturnType<typeof createTestContext>>;
before(async () => {
  t = await createTestContext();
});
after(() => t.close());

test('email code sign-in issues a token that works on /v1/me', async () => {
  const { auth, user } = await t.signIn('Owner@Example.com ');
  assert.equal(user.email, 'owner@example.com');
  const me = await t.api().get('/v1/me').set(auth).expect(200);
  assert.equal(me.body.user.id, user.id);
  assert.equal(me.body.isPro, true);
});

test('signing in again returns the same account', async () => {
  const a = await t.signIn('same@example.com');
  t.clock.now = new Date(t.clock.now.getTime() + 60_000);
  const b = await t.signIn('same@example.com');
  assert.equal(a.user.id, b.user.id);
});

test('rejects wrong, reused and expired codes, and locks after 5 attempts', async () => {
  await t.api().post('/v1/auth/start').send({ email: 'x@example.com' }).expect(200);
  const code = /(\d{6})/.exec(t.emails.at(-1)!.subject)![1];
  const wrong = code === '000000' ? '111111' : '000000';

  const bad = await t.api().post('/v1/auth/verify').send({ email: 'x@example.com', code: wrong }).expect(400);
  assert.equal(bad.body.error, 'invalid_code');

  // Requesting again within 30 seconds is throttled.
  await t.api().post('/v1/auth/start').send({ email: 'x@example.com' }).expect(429);

  await t.api().post('/v1/auth/verify').send({ email: 'x@example.com', code }).expect(200);
  await t.api().post('/v1/auth/verify').send({ email: 'x@example.com', code }).expect(400); // single use

  t.clock.now = new Date(t.clock.now.getTime() + 60_000);
  await t.api().post('/v1/auth/start').send({ email: 'x@example.com' }).expect(200);
  for (let i = 0; i < 5; i++) await t.api().post('/v1/auth/verify').send({ email: 'x@example.com', code: wrong }).expect(400);
  const locked = await t.api().post('/v1/auth/verify').send({ email: 'x@example.com', code: wrong }).expect(429);
  assert.equal(locked.body.error, 'too_many_attempts');

  t.clock.now = new Date(t.clock.now.getTime() + 60_000);
  await t.api().post('/v1/auth/start').send({ email: 'x@example.com' }).expect(200);
  t.clock.now = new Date(t.clock.now.getTime() + 11 * 60_000);
  const expired = await t.api().post('/v1/auth/verify').send({ email: 'x@example.com', code: '123456' }).expect(400);
  assert.equal(expired.body.error, 'code_expired');
});

test('requires a valid token', async () => {
  await t.api().get('/v1/me').expect(401);
  await t.api().get('/v1/me').set({ Authorization: 'Bearer nope' }).expect(401);
});

test('deleting the account revokes the token and removes data', async () => {
  const { auth } = await t.signIn('delete-me@example.com');
  await t.api().delete('/v1/me').set(auth).expect(200);
  await t.api().get('/v1/me').set(auth).expect(401);
  const { rows } = await t.db.query(`SELECT 1 FROM users WHERE email = 'delete-me@example.com'`);
  assert.equal(rows.length, 0);
});

test('pro features return 402 without an entitlement', async () => {
  const { auth } = await t.signIn('free@example.com', { pro: false });
  const res = await t.api().post('/v1/sync').set(auth).send({ cursor: 0, changes: [] }).expect(402);
  assert.equal(res.body.error, 'pro_required');
});

test('rate limits sign-in attempts per IP', async () => {
  const fresh = await createTestContext({ authRateLimit: 20 });
  try {
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await fresh.api().post('/v1/auth/verify').send({ email: `r${i}@example.com`, code: '123456' })).status;
    }
    assert.equal(last, 429);
  } finally {
    await fresh.close();
  }
});
