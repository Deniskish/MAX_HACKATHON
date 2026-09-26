// Verify every AI entry point even when an earlier task fails. Synthetic input only.
// Logs contain status, timing and codes, never credentials or model answers.
const profile = { companyType: 'АО', applicantType: 'legal_entity', region: 'Чувашская Республика', okved: '10.82.2', industry: 'Производство кондитерских изделий', isSme: 'unknown' };
const need = { purpose: 'запуск производства', amount: 400000, preferredTermMonths: 3, ownFunds: null, needsCollateralSupport: null };
const context = { profile, need, workspace: { savedIds: [], applications: [] } };
const document = { id: 'budget-check', name: 'Бюджет', pages: [{ page: 1, text: 'Стоимость оборудования 400000 рублей. Источник собственных средств не определён. Срок проекта 3 месяца.' }] };
const cases = [
  { task: 'chat', id: 'guest-chat', question: 'Чем грант отличается от кредита?', context: {} },
  { task: 'chat', id: 'company-chat', question: 'Что мне подходит?', context },
  { task: 'intake', question: 'Хочу купить оборудование. Нужно 400 тысяч рублей на 3 месяца. Предложи заполнение потребности.', context: { profile } },
  { task: 'search', question: 'Найди поддержку для покупки оборудования и поясни ограничения.', context },
  { task: 'analysis', question: 'Проанализируй параметры бизнеса и предложи следующий шаг.', context },
  { task: 'strategy', question: 'Сравни доступные способы поддержки, не складывай лимиты разных инструментов.', context },
  ...[false, true].map(withDocuments => ({ task: 'review', id: withDocuments ? 'review-documents' : 'review-empty',
    question: 'Проверь заявку: чего не хватает и что нужно исправить перед подачей?',
    context: { ...context, programId: 'frp-development', project: withDocuments ? 'Покупка производственного оборудования.' : '', budget: withDocuments ? 400000 : null, documents: withDocuments ? [document] : [] } })),
  { task: 'draft', question: 'Подготовь редактируемый черновик описания проекта на основе переданного текста. Неизвестные данные обозначь [заполните].',
    context: { ...context, programId: 'frp-development', project: 'Покупка производственного оборудования.', budget: 400000, documents: [document] } },
  { task: 'changes', question: 'Объясни, что для моего бизнеса означает завершённый приём по программе. Не выдумывай новые даты.', context: { ...context, programId: 'fasie-start-1' } },
  { task: 'workspace', question: 'Проанализируй имеющиеся сведения и адаптируй все пять разделов. Не придумывай параметры бизнеса: если данных мало, предложи уточнения.', context },
];
async function runChecks(base, transport = fetch, log = console.log, paceMs = 4500) {
  const results = [];
  for (const { id, ...request } of cases) {
    const started = Date.now();
    let row;
    try {
      const response = await transport(base + '/api/ai/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(70000) });
      const result = await response.json();
      const checks = {
        http: response.ok, llm: result.mode === 'llm',
        answer: typeof result.answer === 'string' && !!result.answer.trim(),
        actions: Array.isArray(result.actions) && result.actions.every(a => !a.programId || result.matches?.some(m => m.id === a.programId && (request.context.programId || !['not_eligible', 'expired', 'upcoming'].includes(m.status)))),
      };
      if (request.task === 'workspace') checks.sections = ['home', 'programs', 'applications', 'calendar', 'assistant'].every(p => result.personalization?.sections?.[p]?.text);
      if (request.task === 'draft') checks.draft = typeof result.draft === 'string' && result.draft.trim().length > 30;
      if (request.task === 'intake') checks.extraction = result.proposedNeed?.amount === 400000 && result.proposedNeed?.preferredTermMonths === 3;
      if (id === 'review-documents') checks.citation = result.citations?.some(e => e.documentId === document.id && e.page === 1);
      checks.quotes = Array.isArray(result.findings) && result.findings.every(f => !f.quote || result.citations?.some(e => e.id === f.evidenceId && e.text.includes(f.quote)));
      const failed = Object.entries(checks).filter(([, valid]) => !valid).map(([name]) => name);
      row = { task: id || request.task, ok: !failed.length, http: response.status, mode: result.mode, code: result.providerFailure || result.code, failed };
    } catch (error) { row = { task: id || request.task, ok: false, error: error.name === 'TimeoutError' ? 'TIMEOUT' : 'REQUEST_FAILED' }; }
    row.durationMs = Date.now() - started;
    results.push(row); log('AI check: ' + JSON.stringify(row));
    if (paceMs) await new Promise(resolve => setTimeout(resolve, Math.max(0, paceMs - row.durationMs)));
  }
  log('AI total: ' + JSON.stringify({ total: results.length, passed: results.filter(r => r.ok).length }));
  return results;
}
module.exports = { runChecks, cases };
if (require.main === module) runChecks(process.env.OPORA_CHECK_URL || 'http://localhost:3002')
  .then(results => { if (results.some(r => !r.ok)) process.exitCode = 1; })
  .catch(() => { console.error('AI_CHECK_FAILED'); process.exitCode = 1; });
