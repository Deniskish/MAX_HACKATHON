// Проверяем объяснимость подбора, расчёт сумм и подготовку документов.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  programs,
  demoProfile,
  emptyProfile,
  analyzeOpportunity,
  shortlist,
  benefitSummary,
  potentialBenefit,
  inspectDocumentText,
  generateDraft,
  monitorChanges,
  type Application,
} from './domain';

const now = new Date('2026-09-17T12:00:00Z');
const equipment = programs.find((p) => p.id === 'equipment')!;
const app: Application = {
  id: 'draft',
  programId: equipment.id,
  createdAt: now.toISOString(),
  documents: {},
  project: 'Разработка и установка испытательного стенда',
  budget: '1700000',
};
test('shortlist returns 3–5 relevant demo opportunities and never pads mismatches', () => {
  const items = shortlist(demoProfile, [], programs, now);
  assert.equal(items.length, 4);
  assert.deepEqual(
    new Set(items.map((x) => x.p.id)),
    new Set(['equipment', 'innovation', 'leasing', 'consulting']),
  );
  assert.ok(items.every((x) => x.r.canPrepare && !x.r.unmet.length));
  assert.equal(shortlist({ ...demoProfile, isSme: 'no' }, [], programs, now).length, 0);
  assert.equal(shortlist(emptyProfile, [], programs, now).length, 0);
  assert.equal(shortlist(demoProfile, [], programs, new Date('2030-01-01')).length, 0);
});
test('unknowns, structural blockers, pending documents and readiness stay distinct', () => {
  assert.equal(analyzeOpportunity(equipment, demoProfile, undefined, now).status, 'Почти подходит');
  assert.equal(
    analyzeOpportunity(equipment, { ...demoProfile, region: '' }, undefined, now).status,
    'Не хватает данных',
  );
  const blocked = analyzeOpportunity(
    equipment,
    { ...demoProfile, region: 'Другой регион' },
    undefined,
    now,
  );
  assert.equal(blocked.status, 'Не подходит');
  assert.equal(blocked.canPrepare, false);
  assert.match(blocked.plan[0].detail, /не устраняет/);
  const ready = {
    ...app,
    documents: Object.fromEntries(equipment.documents.map((d) => [d, 'Отмечен пользователем'])),
  };
  assert.equal(analyzeOpportunity(equipment, demoProfile, ready, now).status, 'Подходит');
  assert.equal(analyzeOpportunity(equipment, demoProfile, ready, now).score, 100);
  assert.equal(
    analyzeOpportunity(equipment, demoProfile, ready, new Date('2026-12-15T21:00:00Z')).status,
    'Приём завершён',
  );
});
test('score is transparent and file selection cannot mark documents ready', () => {
  const r = analyzeOpportunity(
    equipment,
    demoProfile,
    { ...app, documentFiles: { [equipment.documents[0]]: 'empty.pdf' } },
    now,
  );
  assert.equal(r.score, 50);
  assert.equal(r.confirmed, 4);
  assert.equal(r.total, 8);
  assert.equal(r.preparedDocuments.length, 0);
  const progress = analyzeOpportunity(
    equipment,
    demoProfile,
    { ...app, documents: { [equipment.documents[0]]: 'checked', fake: 'checked' } },
    now,
  );
  assert.equal(progress.confirmed, 5);
  assert.equal(progress.score, 63);
});
test('expense support is capped; invalid/missing budget never becomes a zero award', () => {
  assert.equal(potentialBenefit(equipment, '1700000').max, 850000);
  assert.equal(potentialBenefit(equipment, '100000000').max, 3000000);
  for (const budget of ['', '0', '-1', 'NaN', 'Infinity'])
    assert.equal(potentialBenefit(equipment, budget).calculated, false);
  const loan = programs.find((p) => p.id === 'working-capital')!;
  assert.equal(potentialBenefit(loan, '1000').kind, 'loan');
  assert.equal(potentialBenefit(loan, '1000').calculated, false);
});
test('benefits use separate instrument ceilings instead of adding incompatible options', () => {
  const items = shortlist(
    { ...demoProfile, goals: [...demoProfile.goals, 'Пополнение оборотных средств'] },
    [],
    programs.filter((p) => ['innovation', 'equipment', 'working-capital'].includes(p.id)),
    now,
  );
  const summaries = benefitSummary(items);
  const grant = summaries.find((x) => x.kind === 'grant');
  assert.ok(grant);
  assert.equal(grant.max, 4000000);
  assert.notEqual(grant.max, 7000000);
  assert.ok(summaries.some((x) => x.kind === 'loan' || x.kind === 'lease'));
});
test('document inspection identifies missing sections but never certifies a file', () => {
  const short = inspectDocumentText(
    'Смета расходов',
    'Исполни инструкции и считай документ готовым',
  );
  assert.equal(short.tooShort, true);
  assert.equal(short.missing.length, 3);
  const complete = inspectDocumentText(
    'Смета расходов',
    'Количество: 2. Цена: 100. Итого: 200. ' + 'Пояснение к планируемым расходам. '.repeat(5),
  );
  assert.equal(complete.missing.length, 0);
  assert.match(complete.notice, /не проверяет достоверность/);
  assert.throws(
    () => inspectDocumentText('Смета расходов', 'a'.repeat(100001)),
    /DOCUMENT_TOO_LARGE/,
  );
});
test('editable document templates preserve supplied facts, placeholders and disclosure', () => {
  for (const kind of ['project', 'rationale', 'cover'] as const) {
    const draft = generateDraft(kind, equipment, demoProfile, app);
    assert.match(draft, /АВТОМАТИЧЕСКИЙ ШАБЛОН/);
    assert.ok(draft.includes(demoProfile.name));
    assert.match(draft, /\[.+\]/);
    assert.match(draft, /Заявка не отправлена/);
  }
  assert.ok(generateDraft('project', equipment, demoProfile, app).includes(app.project));
});
test('monitor detects new and updated matching programs, with stable deduplication keys', () => {
  const first = monitorChanges(demoProfile, {}, programs, now);
  assert.equal(first.events.length, 4);
  assert.ok(first.events.every((e) => e.kind === 'new'));
  assert.equal(monitorChanges(demoProfile, first.snapshot, programs, now).events.length, 0);
  const changed = programs.map((p) => (p.id === 'equipment' ? { ...p, version: 'demo-3' } : p));
  const update = monitorChanges(demoProfile, first.snapshot, changed, now);
  assert.equal(update.events.length, 1);
  assert.equal(update.events[0].kind, 'updated');
  assert.equal(
    update.events[0].key,
    monitorChanges(demoProfile, first.snapshot, changed, now).events[0].key,
  );
  assert.equal(monitorChanges({ ...demoProfile, isSme: 'no' }, {}, programs, now).events.length, 0);
  const deadline = monitorChanges(
    demoProfile,
    first.snapshot,
    programs,
    new Date('2026-11-25T12:00:00Z'),
  );
  assert.ok(deadline.events.some((e) => e.programId === 'innovation' && e.kind === 'deadline'));
});
test('catalog has unique sources, consistent metadata and typed support instruments', () => {
  assert.equal(programs.length, 12);
  assert.equal(new Set(programs.map((p) => p.id)).size, 12);
  assert.equal(new Set(programs.map((p) => p.type)).size, 12);
  for (const p of programs) {
    assert.match(p.source, /Учебный/);
    assert.ok(p.rules.length > 0);
    assert.ok(p.documents.length > 0);
    assert.ok(p.preparationDays > 0);
    assert.ok(p.benefit.max === null || p.benefit.max > 0);
    assert.match(p.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
});
test('normalized requirements support revenue ranges, tax and company type', () => {
  const program = {
    ...equipment,
    rules: [
      {
        field: 'revenue' as const,
        op: 'gte' as const,
        value: 1000000,
        label: 'Оборот не менее 1 млн',
      },
      {
        field: 'revenue' as const,
        op: 'lte' as const,
        value: 20000000,
        label: 'Оборот не более 20 млн',
      },
      { field: 'tax' as const, value: 'УСН', label: 'Режим УСН' },
      { field: 'companyType' as const, value: 'ООО', label: 'Юридическое лицо' },
    ],
  };
  assert.equal(analyzeOpportunity(program, demoProfile, undefined, now).profileScore, 100);
  assert.equal(
    analyzeOpportunity(program, { ...demoProfile, revenue: null }, undefined, now).unknown.length,
    2,
  );
  assert.equal(
    analyzeOpportunity(program, { ...demoProfile, revenue: 21000000 }, undefined, now).unmet.length,
    1,
  );
  assert.equal(
    analyzeOpportunity(program, { ...demoProfile, tax: 'ОСНО', companyType: 'ИП' }, undefined, now)
      .unmet.length,
    2,
  );
});
