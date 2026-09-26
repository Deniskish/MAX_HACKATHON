import test from 'node:test';
import assert from 'node:assert/strict';
import { demoConfirmed, demoSubmit, emptyDemo, readDemo } from './verification-demo';

const input = { applicationId: 'draft-1', inn: '7707083893', title: 'Поддержка бизнеса', ready: true };
const verified = { ...emptyDemo, enabled: true, signedIn: true, inn: input.inn, role: 'director' as const };
test('simulated submission requires login, authority for this company and complete draft', () => {
  for (const state of [emptyDemo, { ...verified, enabled: false }, { ...verified, signedIn: false }, { ...verified, inn: '2126000147' }, { ...verified, role: null }]) {
    assert.equal(demoConfirmed(state, input.inn), false);
    assert.throws(() => demoSubmit(state, input), /подтвердите компанию/);
  }
  assert.throws(() => demoSubmit(verified, { ...input, ready: false }), /комплект документов/);
  assert.equal(demoConfirmed({ ...verified, role: 'representative' }, input.inn), true);
});
test('simulated receipt is local, idempotent and survives reload; failure preserves draft', () => {
  assert.throws(() => demoSubmit({ ...verified, failSubmission: true }, input), /Черновик сохранён/);
  assert.equal(verified.receipts.length, 0);
  const sent = demoSubmit(verified, input);
  assert.equal(sent.receipts.length, 1); assert.equal(sent.receipts[0].mode, 'demo');
  assert.equal(sent.receipts[0].inn, input.inn);
  assert.strictEqual(demoSubmit(sent, input), sent);
  assert.deepEqual(readDemo({ getItem: () => JSON.stringify(sent) }), sent);
  assert.deepEqual(readDemo({ getItem: () => '{broken' }), emptyDemo);
  assert.equal(readDemo({ getItem: () => JSON.stringify({ enabled: true, receipts: [{ mode: 'real' }] }) }).receipts.length, 0);
});
