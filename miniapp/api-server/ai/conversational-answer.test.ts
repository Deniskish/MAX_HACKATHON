import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationalAnswer, conversationalTasks } from './conversational-answer';
import { runAssistant, assistantSystem } from './service';

test('conversational answers remove presentation markers and start every paragraph with one emoji', () => {
  const raw = '**Важно**: условия __не подтверждены__.\n\n## Следующий шаг\n- Проверьте *документы*.\n\n✅ ✅ Подтверждено.\n\n<b>Бюджет</b> 100 ₽.';
  for (const task of conversationalTasks) {
    const result = conversationalAnswer(task, raw);
    assert.doesNotMatch(result, /\*|__|##|<\/?b>|^- /m);
    assert.match(result, /Важно: условия не подтверждены/);
    assert.match(result, /Следующий шаг/);
    for (const p of result.split('\n\n')) assert.match(p, /^\p{Extended_Pictographic}\uFE0F? [^\p{Extended_Pictographic}]/u);
    assert.ok(result.split('\n\n').length <= 5);
  }
  assert.match(assistantSystem, /2–5/); assert.match(assistantSystem, /plain text/);
});
test('sanitizer preserves textual content, URL, identifiers and all overflow paragraphs', () => {
  const raw = 'Название foo_bar.\n```text\nСодержимое.\n```\n[Источник](https://example.test/a_b)\nЧетыре\nПять\nШесть';
  const result = conversationalAnswer('chat', raw);
  for (const text of ['foo_bar', 'Содержимое.', 'https://example.test/a_b', 'Четыре', 'Пять', 'Шесть']) assert.ok(result.includes(text));
  assert.doesNotMatch(result, /```/);
});
test('GigaChat result is normalized at the service boundary, drafts and document content are untouched', async () => {
  const raw = '**Важно**\n\n## Следующий шаг';
  const document = '**Раздел**\n## Заголовок\n- foo_bar = 2 * 3\n```text\nзначение\n```';
  for (const task of ['chat', 'intake', 'search', 'analysis', 'strategy', 'changes', 'draft'] as const) {
    const result = await runAssistant({ task, question: 'Подготовить ответ', context: { documents: [{ id: 'doc', name: 'Проект', pages: [{ page: 1, text: document }] }] } }, async (stage, payload: any) => {
      if (stage === 'plan') return { value: { query: 'поддержка', opportunityIds: [] } };
      if (task === 'draft') assert.equal(payload.request.context.documents[0].pages[0].text, document);
      return { value: { answer: raw, draft: document, evidenceIds: [], followups: [], findings: [] } };
    });
    assert.equal(result.mode, 'llm');
    if (task === 'draft') { assert.equal(result.draft, document); assert.equal(result.answer, raw); }
    else { assert.doesNotMatch(result.answer, /\*\*|##/); assert.match(result.answer, /^\p{Extended_Pictographic}/u); }
  }
  for (const task of ['draft', 'review', 'workspace'] as const) assert.equal(conversationalAnswer(task, document), document);
});
