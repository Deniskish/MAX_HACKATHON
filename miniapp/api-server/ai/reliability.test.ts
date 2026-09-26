import test from 'node:test';
import assert from 'node:assert/strict';
import { createAIModel } from './transport';
import { runAssistant } from './service';
import { providerFailureCode } from './errors';
import { officialFundingCatalog } from '../funding-catalog/official-catalog';

test('model shares the request deadline with queued transport and cancels stalled OAuth', async () => {
  const controller = new AbortController();
  const model = createAIModel('https://example.test', 'GigaChat', async () => 'token', async (_url, init) => {
    assert.equal(init?.signal, controller.signal, 'queue wait and generation must not receive a premature 30s deadline');
    return Response.json({ choices: [{ message: { content: 'Ответ' } }] });
  });
  await model('answer', { request: { task: 'chat' } }, controller.signal);
  let calls = 0;
  const stalled = createAIModel('https://example.test', 'GigaChat', () => new Promise(() => {}), async () => { calls++; return Response.json({}); });
  const request = stalled('answer', {}, controller.signal);
  const rejection = assert.rejects(request, { name: 'TimeoutError' });
  controller.abort(new DOMException('private diagnostic', 'TimeoutError'));
  await rejection; assert.equal(calls, 0);
});

test('request deadline cancels stalled provider response and body without an automatic retry', async () => {
  for (const body of [false, true]) {
    const controller = new AbortController(); let calls = 0;
    const model = createAIModel('https://example.test', 'GigaChat', async () => 'token', async () => {
      calls++;
      if (!body) return new Promise<Response>(() => {});
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{')); } }));
    });
    const request = model('answer', { request: { task: 'chat' } }, controller.signal);
    const rejection = assert.rejects(request, { name: 'TimeoutError' });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort(new DOMException('private diagnostic', 'TimeoutError'));
    await rejection; assert.equal(calls, 1);
  }
});

test('workspace avoids embeddings and duplicate imported payloads but retains evaluated requirements and financing limits', async () => {
  const selected = officialFundingCatalog[0]; let seen = false, semanticCalls = 0;
  await runAssistant({ task: 'workspace', question: 'Анализ бизнеса', context: { profile: { region: 'Москва' } } }, async (_stage, payload: any) => {
    seen = true;
    const item = payload.assessments.find((m: any) => m.opportunity.id === selected.id);
    assert.ok(item);
    assert.equal(item.opportunity.amountMax, selected.amountMax);
    assert.deepEqual(item.opportunity.regions, selected.regions);
    assert.deepEqual(item.opportunity.manualConditions, selected.manualConditions);
    assert.equal(item.opportunity.imported, undefined);
    assert.equal(item.opportunity.requirements, undefined);
    assert.ok(Array.isArray(item.unknownRequirements));
    assert.ok(payload.evidence.length > 0);
    assert.equal(payload.draftKinds, undefined);
    return { value: {} };
  }, [], AbortSignal.timeout(1000), async () => { semanticCalls++; return []; });
  assert.equal(seen, true); assert.equal(semanticCalls, 0);
});

test('provider diagnostic codes preserve timeout and refusal but never leak arbitrary messages', () => {
  assert.equal(providerFailureCode(new DOMException('secret', 'TimeoutError')), 'PROVIDER_TIMEOUT');
  assert.equal(providerFailureCode(new Error('secret provider data')), 'PROVIDER_UNAVAILABLE');
  assert.equal(providerFailureCode({ code: 'PROVIDER_CONTENT_BLOCKED' }), 'PROVIDER_CONTENT_BLOCKED');
});
