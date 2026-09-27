import { demoProfile, programs } from '../../api-server/tests/fixtures/profiles';
// Проверяем объяснимость подбора, расчёт сумм и подготовку документов.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectDocumentText,
  generateDraft,
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
