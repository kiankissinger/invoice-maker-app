import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { change, createTestContext, makeInvoice } from './helpers';

let t: Awaited<ReturnType<typeof createTestContext>>;
before(async () => {
  t = await createTestContext();
});
after(() => t.close());

test('changes pushed from one device are pulled by another', async () => {
  const { auth } = await t.signIn('sync@example.com');
  const doc = makeInvoice();
  const client = { id: 'client-1', name: 'Acme', createdAt: '2026-09-20T10:00:00.000Z', updatedAt: '2026-09-20T10:00:00.000Z' };

  const push = await t.api().post('/v1/sync').set(auth).send({ cursor: 0, changes: [change('document', doc), change('client', client)] }).expect(200);
  assert.equal(push.body.changes.length, 2);

  const pull = await t.api().post('/v1/sync').set(auth).send({ cursor: 0, changes: [] }).expect(200);
  assert.deepEqual(pull.body.changes.map((c: { id: string }) => c.id).sort(), ['client-1', 'doc-1']);
  assert.equal(pull.body.changes.find((c: { id: string }) => c.id === 'doc-1').data.number, 'INV0001');
  assert.equal(pull.body.hasMore, false);

  // Nothing new after the cursor.
  const again = await t.api().post('/v1/sync').set(auth).send({ cursor: pull.body.cursor, changes: [] }).expect(200);
  assert.equal(again.body.changes.length, 0);
});

test('last write wins; a stale push gets the server copy back', async () => {
  const { auth } = await t.signIn('lww@example.com');
  const v1 = makeInvoice({ notes: 'v1', updatedAt: '2026-09-21T10:00:00.000Z' });
  const first = await t.api().post('/v1/sync').set(auth).send({ cursor: 0, changes: [change('document', v1)] }).expect(200);
  const cursor = first.body.cursor;

  const v2 = { ...v1, notes: 'v2', updatedAt: '2026-09-22T10:00:00.000Z' };
  await t.api().post('/v1/sync').set(auth).send({ cursor, changes: [change('document', v2)] }).expect(200);

  // Device B still has v1 and edits it with an older clock.
  const stale = { ...v1, notes: 'stale', updatedAt: '2026-09-21T12:00:00.000Z' };
  const res = await t.api().post('/v1/sync').set(auth).send({ cursor: 999999, changes: [change('document', stale)] }).expect(200);
  const returned = res.body.changes.find((c: { id: string }) => c.id === 'doc-1');
  assert.equal(returned.data.notes, 'v2');
});

test('deletes propagate as tombstones', async () => {
  const { auth } = await t.signIn('delete@example.com');
  const doc = makeInvoice({ id: 'gone' });
  const first = await t.api().post('/v1/sync').set(auth).send({ cursor: 0, changes: [change('document', doc)] }).expect(200);
  await t.api()
    .post('/v1/sync')
    .set(auth)
    .send({ cursor: first.body.cursor, changes: [{ type: 'document', id: 'gone', updatedAt: '2026-09-25T00:00:00.000Z', deleted: true }] })
    .expect(200);
  const pull = await t.api().post('/v1/sync').set(auth).send({ cursor: 0, changes: [] }).expect(200);
  const tomb = pull.body.changes.find((c: { id: string }) => c.id === 'gone');
  assert.equal(tomb.deleted, true);
  assert.equal(tomb.data, null);
});

test('users never see each other’s records', async () => {
  const a = await t.signIn('a@example.com');
  const b = await t.signIn('b@example.com');
  await t.api().post('/v1/sync').set(a.auth).send({ cursor: 0, changes: [change('document', makeInvoice({ id: 'private' }))] }).expect(200);
  const pull = await t.api().post('/v1/sync').set(b.auth).send({ cursor: 0, changes: [] }).expect(200);
  assert.equal(pull.body.changes.length, 0);
});

test('pages large pulls', async () => {
  const { auth } = await t.signIn('pages@example.com');
  const changes = Array.from({ length: 500 }, (_, i) => change('catalog', { id: `item-${i}`, updatedAt: '2026-09-20T10:00:00.000Z' }));
  await t.api().post('/v1/sync').set(auth).send({ cursor: 0, changes }).expect(200);
  await t.api().post('/v1/sync').set(auth).send({ cursor: 0, changes: [change('catalog', { id: 'extra', updatedAt: '2026-09-20T10:00:00.000Z' })] }).expect(200);

  const page1 = await t.api().post('/v1/sync').set(auth).send({ cursor: 0, changes: [] }).expect(200);
  assert.equal(page1.body.changes.length, 500);
  assert.equal(page1.body.hasMore, true);
  const page2 = await t.api().post('/v1/sync').set(auth).send({ cursor: page1.body.cursor, changes: [] }).expect(200);
  assert.equal(page2.body.changes.length, 1);
  assert.equal(page2.body.hasMore, false);
});

test('validates input', async () => {
  const { auth } = await t.signIn('invalid@example.com');
  await t.api().post('/v1/sync').set(auth).send({ cursor: 0, changes: [{ type: 'hack', id: 'x', updatedAt: 'nope', deleted: false }] }).expect(400);
});
