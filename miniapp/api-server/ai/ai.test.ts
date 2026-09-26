import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareAIContext } from './context';
import { runAssistant, type AIModel } from './service';
import { createAIModel } from './transport';
import { createSemanticSearch, cosine } from './embeddings';
import { SourceStore, trustedSource, extractSource } from './sources';
import { officialFundingCatalog } from '../funding-catalog/official-catalog';
import { createApp } from '../app';
import { workspacePages } from './types';
import { PrivacyError } from '../privacy';
import { emptyFundingNeed } from '../funding-catalog/types';

const id = officialFundingCatalog[0].id;
const input = { task: 'chat', question: 'Хочу купить оборудование за 200 млн рублей, залога нет. А если уменьшить сумму?',
  history: [{ role: 'user', text: 'Срок три года' }], context: { profile: { region: 'Самарская область', applicantType: 'legal_entity' }, project: 'Производство приборов', identifiers: { name: 'ООО Секрет', inn: '7707083893' } } };
const answer = { answer: 'Уточните условия обеспечения.', evidenceIds: [`program:${id}`], followups: ['Сколько собственных средств?'], findings: [] };

test('chat answer only receives programme sources and strategy selected by its plan', async () => {
  let checked = false;
  await runAssistant(input, async (stage, payload: any) => {
    if (stage === 'plan') return { value: { query: 'производство', opportunityIds: [id] } };
    checked = true;
    assert.ok(payload.evidence.some((e: any) => e.opportunityId === id));
    assert.ok(payload.evidence.every((e: any) => !e.opportunityId || e.opportunityId === id));
    assert.ok(payload.assessments.every((m: any) => m.opportunity.id === id));
    assert.ok(payload.strategy.options.every((o: any) => o.opportunityId === id));
    return { value: answer };
  });
  assert.equal(checked, true);
});

test('guest chat accepts questions and history without inventing a company or unrelated programme actions', async () => {
  const stages: string[] = [];
  const result = await runAssistant({ task: 'chat', question: 'Чем грант отличается от кредита?',
    history: [{ role: 'user', text: 'Только изучаю поддержку' }], context: { page: 'assistant' } }, async (stage, payload: any) => {
      stages.push(stage);
      assert.deepEqual(payload.request.context.profile, {});
      assert.equal(payload.request.history[0].text, 'Только изучаю поддержку');
      return { value: stage === 'plan' ? { query: 'грант кредит', opportunityIds: [] }
        : { answer: 'Кредит возвращают с процентами; грант расходуют на цели программы с отчётностью.', evidenceIds: [], followups: [], findings: [] } };
    });
  assert.deepEqual(stages, ['plan', 'answer']);
  assert.equal(result.mode, 'llm'); assert.match(result.answer, /Кредит/);
  assert.deepEqual(result.actions, []); assert.equal(result.proposedProfile, undefined);
});

test('guest chat provider failure does not masquerade as a personal selection', async () => {
  const result = await runAssistant({ task: 'chat', question: 'Что такое грант?', context: {} });
  assert.equal(result.mode, 'local'); assert.match(result.answer, /не смог ответить/);
  assert.deepEqual(result.actions, []); assert.deepEqual(result.matches, []); assert.equal(result.notice, undefined);
});
test('workspace analysis adapts every page, retains actual business facts and drops invented or unavailable programme priorities', async () => {
  const model: AIModel = async (stage, payload: any) => {
    if (stage === 'plan') return { value: { query: 'производство', opportunityIds: [id], profile: { region: 'Выдуманный регион' }, need: { purpose: 'экспорт' } } };
    assert.equal(payload.request.context.profile.region, input.context.profile.region);
    assert.equal(payload.proposedProfile, undefined); assert.equal(payload.proposedNeed, undefined);
    return { value: { ...answer, personalization: { summary: 'Производству нужно уточнить обеспечение.',
      sections: Object.fromEntries(workspacePages.map((p) => [p, { title: `План ${p}`, text: 'Уточните задачу производства.', action: 'funding' }])),
      priorities: [{ programId: id, reason: 'Рассмотреть после уточнения параметров.' }, { programId: 'invented', reason: 'Ошибка' },
        { programId: 'fasie-start-1', reason: 'Приём закрыт' }, { programId: id, reason: 'Дубликат' }] } } };
  };
  const result = await runAssistant({ ...input, task: 'workspace' }, model);
  assert.equal(result.mode, 'llm'); assert.deepEqual(Object.keys(result.personalization!.sections), [...workspacePages]);
  assert.deepEqual(result.personalization!.priorities.map((p) => p.programId), [id]);
  const broken: AIModel = async (stage) => ({ value: stage === 'plan' ? { query: '', opportunityIds: [] } : { ...answer, personalization: { sections: { home: { title: 'Ошибка', text: 'Текст', action: 'send_money' } } } } });
  const fallback = await runAssistant({ ...input, task: 'workspace' }, broken);
  assert.equal(fallback.mode, 'local'); assert.equal(fallback.personalization, undefined);
});
test('automatic workspace context only carries allowed application facts, with private text minimized', () => {
  const prepared = prepareAIContext({ ...input, task: 'workspace', context: { ...input.context,
    workspace: { savedIds: [id, id], applications: [{ programId: id, project: 'ООО Секрет покупает станки', budget: 100,
      preparedDocuments: ['fake-document'], hasDraft: 'true', reviewConfirmed: true, secret: 'never-forward' }] } } });
  assert.deepEqual(prepared.request.context.workspace?.savedIds, [id]);
  assert.equal(prepared.request.context.workspace?.applications[0].hasDraft, false);
  assert.doesNotMatch(JSON.stringify(prepared.request), /ООО Секрет|never-forward|fake-document/);
  assert.throws(() => prepareAIContext({ ...input, context: { workspace: { savedIds: ['invented'], applications: [] } } }));
});

test('unreviewed crawls only enter change analysis, never routine business advice or semantic retrieval', async () => {
  const crawled = [{ id: 'source:crawl:0', title: 'Страница сайта', text: 'UNREVIEWED_PAGE_TEXT', opportunityId: id }];
  for (const task of ['workspace', 'chat', 'search', 'analysis', 'strategy', 'review', 'draft', 'intake', 'changes']) {
    let seenAnswer = false;
    await runAssistant({ ...input, task }, async (stage, payload: any) => {
      if (stage === 'plan') return { value: { query: 'test', opportunityIds: [] } };
      seenAnswer = true;
      assert.equal(payload.evidence.some((e: any) => e.id.startsWith('source:')), task === 'changes', task);
      return { value: answer };
    }, crawled, AbortSignal.timeout(2000), async (_query, evidence) => {
      assert.equal(evidence.some((e) => e.id.startsWith('source:')), task === 'changes', task);
      return evidence;
    });
    assert.equal(seenAnswer, true);
  }
});

test('provider blacklist is explicit, never retried as JSON or reported as an AI answer', async () => {
  for (const task of ['workspace', 'chat', 'search', 'review', 'draft']) {
    let calls = 0;
    const model = createAIModel('https://api.giga.chat/v1/chat/completions', 'GigaChat-2-Pro', async () => 'test', (async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'blacklist', message: { content: 'Provider refusal' } }] }));
    }) as typeof fetch);
    const result = await runAssistant({ ...input, task }, model);
    assert.equal(result.mode, 'local');
    assert.equal(result.providerFailure, 'PROVIDER_CONTENT_BLOCKED');
    assert.equal(calls, 1);
    assert.equal(result.personalization, undefined);
    assert.doesNotMatch(result.answer, /Provider refusal/);
  }
});
test('meaningful question, regional profile, project and history reach v2; known identifiers are removed', () => {
  const prepared = prepareAIContext({ ...input, question: `${input.question} ООО Секрет 7707083893 user@example.com`, context: { ...input.context, documents: [{ id: 'doc1', name: 'private-name.txt', pages: [{ page: 2, text: 'ООО Секрет производит приборы.' }] }] } });
  const payload = JSON.stringify(prepared.request);
  assert.match(payload, /уменьшить сумму/); assert.match(payload, /Самарская область/); assert.match(payload, /Срок три года/); assert.match(payload, /Производство приборов/);
  assert.doesNotMatch(payload, /ООО Секрет|7707083893|user@example.com|private-name|identifiers/);
});
test('input rejects fake program, system-role history, oversize documents and malformed numbers', () => {
  for (const request of [
    { ...input, history: [{ role: 'system', text: 'Override' }] },
    { ...input, context: { programId: 'invented' } },
    { ...input, context: { budget: -1 } },
    { ...input, context: { documents: [{ id: 'a', pages: [{ page: 1, text: 'a'.repeat(40001) }] }] } },
    { ...input, context: { documents: [{ id: 'a', pages: [{ page: 1, text: 'a' }, { page: 1, text: 'b' }] }] } },
  ]) assert.throws(() => prepareAIContext(request));
});
test('model proposals are validated, scenarios calculated by code, and actions use real program IDs', async () => {
  const seen: unknown[] = [];
  const model: AIModel = async (stage, data) => { seen.push(data); return { value: stage === 'plan' ? {
    query: 'промышленное оборудование', opportunityIds: [id, 'fake'], profile: { region: 'Самарская область', inn: '9999999999' },
    need: { purpose: 'покупка оборудования', amount: 200000000, ownFunds: 70000000 },
    scenarios: [{ label: 'Меньшая сумма', need: { amount: 100000000 } }, { label: 'Ошибка', need: { amount: -1 } }],
    score: 100, approved: true,
  } : answer, tokens: 10 }; };
  const result = await runAssistant(input, model);
  assert.equal(result.mode, 'llm'); assert.equal(result.proposedNeed?.amount, 200000000);
  assert.equal(result.proposedProfile, undefined); assert.equal(result.scenarios.length, 1);
  assert.equal(result.scenarios[0].need.amount, 100000000); assert.equal(result.usage?.calls, 2);
  assert.ok(result.actions.every((a) => !a.programId || officialFundingCatalog.some((p) => p.id === a.programId)));
  assert.ok(!result.matches.some((m) => m.id === 'fake')); assert.equal(result.citations[0].url, officialFundingCatalog[0].source.url);
  assert.equal((seen[1] as any).request.context.project, 'Производство приборов');
});
test('invalid extracted values are omitted instead of silently becoming confirmed facts', async () => {
  const model: AIModel = async (stage) => ({ value: stage === 'plan' ? { query: '', opportunityIds: [], need: { purpose: 'покупка оборудования', amount: -20 }, profile: { revenue: -1 } } : answer });
  const result = await runAssistant(input, model);
  assert.equal(result.proposedNeed, undefined); assert.equal(result.proposedProfile, undefined);
});
test('document findings require literal quotations and carry page citations; model cannot inject URLs/actions', async () => {
  const request = { ...input, task: 'review', context: { ...input.context, programId: id, documents: [{ id: 'budget', name: 'budget.txt', pages: [{ page: 3, text: 'Бюджет 100 млн рублей. Срок проекта 2027 год.' }] }] } };
  const model: AIModel = async (stage) => ({ value: stage === 'plan' ? { query: 'бюджет', opportunityIds: [id] } : { ...answer,
    findings: [
      { title: 'Сумма', detail: 'Сверьте с запрошенной суммой.', severity: 'warning', evidenceId: 'document:budget:3', quote: 'Бюджет 100 млн рублей.' },
      { title: 'Выдуманная цитата', detail: 'Ошибка.', severity: 'warning', evidenceId: 'document:budget:3', quote: 'Бюджет 900 млн' },
      { title: 'Проверка', detail: 'Уточните обеспечение.', severity: 'warning' },
    ], evidenceIds: ['https://evil.test'], actions: [{ type: 'send_money' }],
  } });
  const result = await runAssistant(request, model);
  assert.equal(result.findings.length, 2); assert.equal(result.findings[1].severity, 'check');
  assert.ok(result.citations.some((e) => e.id === 'document:budget:3' && e.page === 3));
  assert.ok(!JSON.stringify(result).includes('evil.test')); assert.ok(!JSON.stringify(result.actions).includes('send_money'));
});
test('draft task receives project and current draft, and returns explicit editable output only for draft task', async () => {
  const model: AIModel = async (stage, data) => {
    if (stage === 'answer') assert.equal((data as any).request.context.project, 'Производство приборов');
    return { value: stage === 'plan' ? { opportunityIds: [id], query: 'приборы' } : { ...answer, draft: 'Описание: производство приборов. ООО Секрет. Бюджет [заполните].' } };
  };
  const drafted = await runAssistant({ ...input, task: 'draft' }, model);
  assert.match(drafted.draft!, /производство приборов/); assert.doesNotMatch(drafted.draft!, /ООО Секрет/);
  assert.equal((await runAssistant(input, model)).draft, undefined);
});
test('provider failure is explicitly local; no invented document review or generated draft', async () => {
  const broken: AIModel = async () => { throw new Error('PRIVATE_PROVIDER_SECRET'); };
  for (const task of ['chat', 'review', 'draft']) {
    const result = await runAssistant({ ...input, task }, broken);
    assert.equal(result.mode, 'local');
    if (task !== 'review') assert.ok(result.notice, 'catalogue fallback must explain its source');
    assert.equal(result.draft, undefined);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_PROVIDER_SECRET/);
    if (task === 'review') assert.match(result.answer, /не сформирован/);
  }
});
test('a failed second generation cannot pretend to have reviewed documents; aborted requests do not call the provider', async () => {
  const model: AIModel = async (stage) => { if (stage === 'answer') throw new Error('PROVIDER_FAILURE'); return { value: { query: 'оборудование', opportunityIds: [id] } }; };
  const result = await runAssistant({ ...input, task: 'review' }, model);
  assert.equal(result.mode, 'local'); assert.match(result.answer, /не сформирован/); assert.equal(result.findings.length, 0);
  let calls = 0; const controller = new AbortController(); controller.abort();
  await assert.rejects(() => runAssistant(input, async () => { calls++; return { value: {} }; }, [], controller.signal));
  assert.equal(calls, 0);
});
test('forced GigaChat functions are bounded, use abort signals and reject wrong/truncated calls', async () => {
  let body: any;
  const transport = (async (_url, init) => { body = JSON.parse(String(init?.body)); assert.ok(init?.signal); return new Response(JSON.stringify({ choices: [{ message: { function_call: { name: 'plan_support', arguments: { query: 'test', opportunityIds: [] } } } }], usage: { total_tokens: 32 } })); }) as typeof fetch;
  const model = createAIModel('https://api.giga.chat/v1/chat/completions', 'GigaChat-2-Pro', async () => 'test', transport);
  assert.equal((await model('plan', {}, AbortSignal.timeout(1000))).tokens, 32);
  assert.deepEqual(body.function_call, { name: 'plan_support' }); assert.equal(body.functions.length, 1);
  const workspaceTransport = (async (_url: unknown, init: any) => {
    const wire = JSON.parse(String(init.body)); assert.equal(wire.function_call.name, 'adapt_workspace');
    assert.equal(wire.functions[0].parameters.properties.sections.type, 'object');
    return new Response(JSON.stringify({ choices: [{ message: { function_call: { name: 'adapt_workspace', arguments: {
      summary: 'План бизнеса', evidenceIds: [], priorities: [], sections: workspacePages.map((page) => ({ page, title: page, text: 'Уточните цель', action: 'funding' })),
    } } } }] }));
  }) as typeof fetch;
  const workspaceModel = createAIModel('https://api.giga.chat/v1/chat/completions', 'GigaChat-2-Pro', async () => 'test', workspaceTransport);
  const adapted = await workspaceModel('answer', { request: { task: 'workspace' } }, AbortSignal.timeout(1000));
  assert.equal((adapted.value as any).personalization.sections.home.title, 'home');
  const malformed = createAIModel('https://api.giga.chat/v1/chat/completions', 'GigaChat-2-Pro', async () => 'test', (async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'unfinished' } }] }))) as typeof fetch);
  await assert.rejects(() => malformed('answer', {}, AbortSignal.timeout(1000)));
});
test('workspace accepts equivalent envelopes but never invents missing sections or actions', async () => {
  const sections = Object.fromEntries(workspacePages.map((page) => [page, { title: page, text: 'Уточните задачу бизнеса.', action: 'funding' }]));
  const valid = { summary: 'Нужно уточнить цель бизнеса.', evidenceIds: [], priorities: [], sections };
  for (const variant of ['object', 'envelope', 'array', 'missing', 'invalid_action', 'duplicate', 'no_evidence']) {
    let calls = 0;
    let value: any = structuredClone(valid);
    if (variant === 'envelope') value = { personalization: { summary: valid.summary, sections, priorities: [] }, evidenceIds: [] };
    if (variant === 'array' || variant === 'duplicate') value.sections = workspacePages.map((page) => ({ page, ...sections[page] }));
    if (variant === 'duplicate') value.sections.push(value.sections[0]);
    if (variant === 'missing') delete value.sections.calendar;
    if (variant === 'invalid_action') value.sections.home.action = 'approve_loan';
    if (variant === 'no_evidence') delete value.evidenceIds;
    const model = createAIModel('https://api.giga.chat/v1/chat/completions', 'GigaChat-2-Pro', async () => 'test', (async (_url, init) => {
      calls++; const wire = JSON.parse(String(init?.body));
      if (calls === 1) assert.deepEqual(wire.functions[0].parameters.properties.sections.required, [...workspacePages]);
      return new Response(JSON.stringify({ choices: [{ message: calls === 1
        ? { function_call: { name: 'adapt_workspace', arguments: value } }
        : { content: JSON.stringify(value) } }] }));
    }) as typeof fetch);
    const result = await runAssistant({ ...input, task: 'workspace' }, model);
    const accepted = ['object', 'envelope', 'array'].includes(variant);
    assert.equal(result.mode, accepted ? 'llm' : 'local', variant);
    assert.equal(calls, accepted ? 1 : 2, variant);
    if (accepted) assert.deepEqual(Object.keys(result.personalization!.sections), [...workspacePages]);
    else { assert.equal(result.personalization, undefined); assert.equal(result.providerFailure, 'INVALID_RESPONSE'); }
  }
});

test('chat accepts actual model text without a function call, while reviews still require structured output', async () => {
  let wire: any;
  const model = createAIModel('https://api.giga.chat/v1/chat/completions', 'GigaChat-2-Pro', async () => 'test', (async (_url, init) => {
    wire = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Поручительство помогает с обеспечением кредита.' } }], usage: { total_tokens: 12 } }));
  }) as typeof fetch);
  const result = await model('answer', { request: { task: 'chat' } }, AbortSignal.timeout(1000));
  assert.match((result.value as any).answer, /обеспечением/);
  assert.equal(wire.functions, undefined); assert.equal(result.tokens, 12);
  await assert.rejects(() => model('answer', { request: { task: 'review' } }, AbortSignal.timeout(1000)), (e: any) => e.code === 'INVALID_RESPONSE');
});

test('document review skips planning, keeps the selected source and validates quoted findings', async () => {
  const result = await runAssistant({ ...input, task: 'review', context: { ...input.context, programId: id,
    documents: [{ id: 'budget', name: 'budget.txt', pages: [{ page: 2, text: 'Бюджет проекта 400000 рублей.' }] }] } }, async (stage, payload: any) => {
    assert.equal(stage, 'answer');
    assert.ok(payload.evidence.every((e: any) => !e.opportunityId || e.opportunityId === id));
    assert.equal(payload.proposedNeed, undefined);
    return { value: { ...answer, findings: [{ title: 'Бюджет', detail: 'Сверьте сумму с условиями.', severity: 'warning', evidenceId: 'document:budget:2', quote: 'Бюджет проекта 400000 рублей.' }] } };
  });
  assert.equal(result.mode, 'llm'); assert.equal(result.usage?.calls, 1);
  assert.equal(result.findings[0].severity, 'warning'); assert.ok(result.citations.some((e) => e.page === 2));
  const failed = await runAssistant({ ...input, task: 'review' });
  assert.deepEqual(failed.citations, []); assert.deepEqual(failed.actions, []); assert.equal(failed.notice, undefined);
});

test('review accepts strict JSON content and retries prose only once without weakening its schema', async () => {
  for (const mode of ['json', 'retry', 'broken', 'truncated', 'http', 'abort']) {
    const controller = new AbortController(); let calls = 0;
    const model = createAIModel('https://api.giga.chat/v1/chat/completions', 'GigaChat-2-Pro', async () => 'test', (async (_url, init) => {
      calls++; const wire = JSON.parse(String(init?.body));
      if (calls === 1) assert.equal(wire.function_call.name, 'review_application');
      else { assert.equal(wire.functions, undefined); assert.match(wire.messages[0].content, /JSON/); }
      if (mode === 'http') return new Response('', { status: 503 });
      if (mode === 'abort') controller.abort();
      const content = mode === 'json' || mode === 'retry' && calls === 2 ? JSON.stringify(answer) : 'Ответ без структурированных замечаний';
      return new Response(JSON.stringify({ choices: [{ finish_reason: mode === 'truncated' ? 'length' : 'stop', message: { content } }], usage: { total_tokens: 10 } }));
    }) as typeof fetch);
    if (['json', 'retry'].includes(mode)) {
      const result = await model('answer', { request: { task: 'review' } }, controller.signal);
      assert.deepEqual(result.value, answer); assert.equal(result.tokens, mode === 'json' ? 10 : 20);
    } else await assert.rejects(() => model('answer', { request: { task: 'review' } }, controller.signal));
    assert.equal(calls, ['retry', 'broken'].includes(mode) ? 2 : 1);
  }
});

test('chat recovers from an unstructured plan without inventing changes to the business', async () => {
  const result = await runAssistant(input, async (stage) => {
    if (stage === 'plan') throw new PrivacyError('NO_FUNCTION_CALL');
    return { value: answer };
  });
  assert.equal(result.mode, 'llm'); assert.equal(result.providerFailure, undefined);
  assert.equal(result.proposedNeed, undefined); assert.equal(result.proposedProfile, undefined);
});

test('all conversational tasks use text without imposing document schemas', async () => {
  for (const task of ['chat','intake','search','analysis','strategy','changes']) {
    const model = createAIModel('https://api.giga.chat/v1/chat/completions','GigaChat-2-Pro',async()=>'test',(async(_url,init)=>{
      const wire=JSON.parse(String(init?.body));assert.equal(wire.functions,undefined);
      return new Response(JSON.stringify({choices:[{message:{content:'Уточните цель бизнеса.'}}]}));
    }) as typeof fetch);
    assert.equal((await model('answer',{request:{task}},AbortSignal.timeout(1000))).value && true,true);
  }
});

test('draft and workspace accept validated JSON when the provider omits the function call', async () => {
  for (const task of ['draft','workspace']) {
    const value=task==='draft'?{answer:'Черновик готов.',draft:'Описание проекта [заполните].',evidenceIds:[]}
      :{summary:'План',evidenceIds:[],priorities:[],sections:workspacePages.map(page=>({page,title:'План',text:'Уточните цель',action:'funding'}))};
    const model=createAIModel('https://api.giga.chat/v1/chat/completions','GigaChat-2-Pro',async()=>'test',(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}))) as typeof fetch);
    const result=await model('answer',{request:{task}},AbortSignal.timeout(1000));
    if(task==='draft')assert.equal((result.value as any).draft,value.draft);
    else assert.equal(Object.keys((result.value as any).personalization.sections).length,5);
  }
});

test('unchanged needs are not offered again, and unavailable programmes are not recommendation buttons', async () => {
  const need = { ...emptyFundingNeed, purpose: 'запуск производства', amount: 400000, preferredTermMonths: 3 };
  const result = await runAssistant({ ...input, context: { ...input.context, need } }, async (stage) => ({ value: stage === 'plan'
    ? { query: '', opportunityIds: [], need, profile: { region: input.context.profile.region } } : answer }));
  assert.equal(result.proposedNeed, undefined); assert.equal(result.proposedProfile, undefined);
  assert.ok(!result.actions.some((a) => a.type === 'open_funding'));
  for (const action of result.actions) if (action.programId) assert.ok(result.matches.some((m) => m.id === action.programId && !['not_eligible', 'expired', 'upcoming'].includes(m.status)));
  const fallback = await runAssistant({ ...input, context: { ...input.context, need } });
  assert.equal(fallback.mode, 'local'); assert.ok(fallback.answer.length < 1100);
  assert.doesNotMatch(fallback.answer, /Выполнено:|Неизвестно:/);
});

test('semantic retrieval caches public vectors but not private queries; invalid dimensions do not score', async () => {
  assert.equal(cosine([1, 0], [1, 0]), 1); assert.equal(cosine([1], [1, 2]), 0);
  const inputs: string[][] = [];
  const search = createSemanticSearch(async () => 'test', (async (_url, init) => {
    const request = JSON.parse(String(init?.body)); inputs.push(request.input);
    return new Response(JSON.stringify({ data: request.input.map((_: string, index: number) => ({ index, embedding: [1, 0] })) }));
  }) as typeof fetch);
  const corpus = [{ id: 'one', title: 'Оборудование', text: 'Официальные условия' }];
  await search('Первый вопрос', corpus, AbortSignal.timeout(1000)); await search('Второй вопрос', corpus, AbortSignal.timeout(1000));
  assert.equal(inputs.length, 3); assert.deepEqual(inputs[2], ['Второй вопрос']);
});
test('source monitor only visits official domains, removes scripts, records actual changes and survives failures', async () => {
  assert.equal(trustedSource('https://frprf.ru.evil.test/'), false); assert.equal(trustedSource('http://127.0.0.1/'), false); assert.equal(trustedSource('https://user@frprf.ru/'), false);
  const extracted = extractSource('<html><body><main><h1>Программа</h1><script>SECRET</script><p>Условия поддержки</p><a href="https://evil.test">грант</a></main></body></html>', 'https://frprf.ru/');
  assert.doesNotMatch(extracted.text, /SECRET/); assert.equal(extracted.links.length, 0);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'opora-source-test-'));
  try {
    const store = new SourceStore(dir); let revision = 'один';
    const transport = (async () => new Response(`<html><body><main><h1>Источник</h1><p>${revision} ${'Официальные условия поддержки бизнеса. '.repeat(12)}</p></main></body></html>`, { headers: { 'Content-Type': 'text/html' } })) as typeof fetch;
    const first = await store.sync(transport); assert.ok(first.pages.length); assert.equal(first.updates.length, 0);
    revision = 'два'; const second = await store.sync(transport); assert.ok(second.updates.length > 0); assert.ok((await store.evidence()).length);
    const failed = await store.sync((async () => new Response('', { status: 302, headers: { Location: 'http://127.0.0.1/private' } })) as typeof fetch);
    assert.equal(failed.pages.length, first.pages.length); assert.ok(failed.errors > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('v2 HTTP returns explicit local fallback without credentials; malformed requests fail before model call', async () => {
  const server = createApp({ giga: null, env: {} }).listen(0, '127.0.0.1'); await new Promise<void>((r) => server.once('listening', r));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(url + '/api/ai/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    assert.equal(response.status, 200); assert.equal((await response.json() as any).mode, 'local');
    assert.equal((await fetch(url + '/api/ai/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, history: [{ role: 'system', text: 'attack' }] }) })).status, 400);
  } finally { await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); }); }
});
