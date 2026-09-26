// Manual live audit. Only synthetic cases; never reads or prints credentials.
const fs = require('node:fs');
const tasks = ['chat', 'intake', 'search', 'analysis', 'strategy', 'review', 'draft', 'changes', 'workspace'];
const profiles = {
  incomplete: {},
  company: { applicantType: 'legal_entity', companyType: 'ООО', region: 'Москва', okved: '28.1', ageMonths: 36, employees: 40, revenue: 200000000, isSme: 'yes' },
  project: { applicantType: 'project', region: 'Москва', industry: 'разработка программного обеспечения', stage: 'prototype' },
};
const questions = {
  chat: 'Что мне подходит и что нужно уточнить?',
  intake: 'Хочу купить оборудование. Нужно 200 миллионов рублей, своих средств 70 миллионов, срок 36 месяцев. Предложи заполнение потребности.',
  search: 'Найди поддержку для покупки оборудования и поясни ограничения.',
  analysis: 'Проанализируй параметры бизнеса и предложи следующий шаг.',
  strategy: 'Сравни доступные способы поддержки, не складывай лимиты разных инструментов.',
  review: 'Проверь заявку: чего не хватает и что нужно исправить перед подачей? Приведи цитаты из переданного текста.',
  draft: 'Подготовь редактируемый черновик описания проекта на основе переданного текста. Неизвестные данные обозначь [заполните].',
  changes: 'Объясни, что для моего бизнеса означает завершённый приём по программе. Не выдумывай новые даты.',
  workspace: 'Адаптируй все пять разделов приложения по параметрам бизнеса. Не меняй факты профиля.',
};
function makeContext(profile, task) {
  const context = { profile, workspace: { savedIds: ['frp-development'], applications: [] } };
  if (task !== 'intake') context.need = { purpose: 'покупка оборудования', amount: 200000000, ownFunds: 70000000, preferredTermMonths: 36, needsCollateralSupport: null };
  if (['review', 'draft', 'strategy'].includes(task)) Object.assign(context, {
    programId: 'frp-development', project: 'Покупка оборудования для производства приборов. План выпуска 1000 единиц в год.', budget: 270000000,
    documents: [{ id: 'audit-budget', name: 'План проекта', pages: [{ page: 1, text: 'Бюджет проекта 270 миллионов рублей. Требуется финансирование 200 миллионов рублей. Собственные средства 70 миллионов рублей. Срок проекта 36 месяцев.' }] }],
  });
  if (task === 'changes') context.programId = 'fasie-start-1';
  return context;
}
(async () => {
  const base = process.env.OPORA_CHECK_URL || 'http://localhost:3002';
  const file = process.argv[2] || 'scenario-audit.json';
  const report = { startedAt: new Date().toISOString(), revision: process.env.AUDIT_REVISION || '', kind: 'live-gigachat', cases: [] };
  const cases = Object.entries(profiles).flatMap(([profile, facts]) => tasks.map(task => ({ id: `LIVE-${profile}-${task}`, task, profile, question: questions[task], context: makeContext(facts, task) })));
  cases.push({ id: 'LIVE-empty-review', task: 'review', question: questions.review, context: { profile: profiles.company, programId: 'frp-development', documents: [] } });
  cases.push({ id: 'LIVE-history', task: 'chat', question: 'А если уменьшить сумму до 100 миллионов?', history: [{ role: 'user', text: 'Нужно 200 миллионов рублей на оборудование.' }, { role: 'assistant', text: 'Нужно уточнить обеспечение.' }], context: makeContext(profiles.company, 'chat') });
  cases.push({ id: 'LIVE-invalid-program', task: 'chat', question: 'Что подходит?', context: { programId: 'nonexistent-program' }, expectedHTTP: 400 });
  cases.push({ id: 'LIVE-invalid-budget', task: 'review', question: questions.review, context: { budget: -1 }, expectedHTTP: 400 });
  for (const item of cases) {
    const start = Date.now(), { id, profile, expectedHTTP, ...request } = item;
    let result;
    try {
      const response = await fetch(base + '/api/ai/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(70000) });
      const body = await response.json();
      const checks = [];
      if (expectedHTTP) checks.push(['validation', response.status === expectedHTTP]);
      else {
        checks.push(['http', response.ok], ['live-model', body.mode === 'llm'], ['answer', typeof body.answer === 'string' && body.answer.trim().length > 0]);
        checks.push(['safe-actions', Array.isArray(body.actions) && body.actions.every(a => !a.programId || body.matches?.some(m => m.id === a.programId && (request.context.programId || !['expired', 'upcoming', 'not_eligible'].includes(m.status))))]);
        if (request.task === 'workspace') checks.push(['all-pages', ['home','programs','applications','calendar','assistant'].every(p => body.personalization?.sections?.[p]?.text)]);
        if (request.task === 'draft') checks.push(['draft', typeof body.draft === 'string' && body.draft.trim().length > 30]);
        if (request.task === 'intake') checks.push(['extracted-need', body.proposedNeed?.amount === 200000000 && body.proposedNeed?.ownFunds === 70000000]);
        if (request.task === 'review' && request.context.documents?.length) checks.push(['document-source', body.citations?.some(e => e.documentId === 'audit-budget' && e.page === 1)]);
        checks.push(['literal-quotes', (body.findings || []).every(f => !f.quote || body.citations?.some(e => e.id === f.evidenceId && e.text.includes(f.quote)))]);
      }
      result = { id, task: request.task, profile: profile || null, status: checks.every(c => c[1]) ? 'pass' : 'fail', http: response.status, mode: body.mode,
        failedChecks: checks.filter(c => !c[1]).map(c => c[0]), durationMs: Date.now()-start, providerFailure: body.providerFailure,
        usage: body.usage, answer: body.answer, draft: body.draft, findings: body.findings, citations: body.citations?.map(e => ({ id:e.id, page:e.page, documentId:e.documentId })), proposedNeed:body.proposedNeed, proposedProfile:body.proposedProfile };
    } catch (error) { result = { id, task:request.task, profile, status:'fail', durationMs:Date.now()-start, error:error.name }; }
    report.cases.push(result); report.updatedAt=new Date().toISOString(); fs.writeFileSync(file, JSON.stringify(report,null,2));
    console.log(JSON.stringify({ id:result.id, status:result.status, mode:result.mode, failedChecks:result.failedChecks, durationMs:result.durationMs, providerFailure:result.providerFailure }));
    // Stay below the application's 15 AI requests per minute, even with fast validation responses.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(process.env.AUDIT_PACE_MS || 20000)-(Date.now()-start))));
  }
  const passed = report.cases.filter(c=>c.status==='pass').length;
  console.log('AUDIT_TOTAL', JSON.stringify({ total:report.cases.length, passed }));
  if (passed !== report.cases.length) process.exitCode = 1;
})().catch(error=>{console.error(error.name);process.exitCode=1;});
