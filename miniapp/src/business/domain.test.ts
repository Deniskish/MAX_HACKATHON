import { demoProfile, programs } from '../../api-server/tests/fixtures/profiles';
// Проверяем ИНН, границы условий и содержание экспортируемого черновика.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validInn,
  draftText,
} from './domain';
const now = new Date('2026-09-16T12:00:00Z');
test('INN validates both lengths and rejects invalid checksums and zeros', () => {
  assert.equal(validInn('7707083893'), true);
  assert.equal(validInn('500100732259'), true);
  for (const value of ['7707083894', '500100732258', '0000000000', '123', 'abcdefghij'])
    assert.equal(validInn(value), false);
});
test('draft preserves project and document state and identifies simulation', () => {
  const text = draftText(
    {
      id: 'test',
      programId: programs[0].id,
      createdAt: now.toISOString(),
      project: 'Новый продукт',
      budget: '100000',
      documents: { [programs[0].requiredDocuments[0]]: 'extract.pdf' },
    },
    programs[0],
    demoProfile,
  );
  assert.match(text, /Новый продукт/);
  assert.match(text, /extract.pdf/);
  assert.match(text, /\[ \]/);
  assert.match(text, /Заявка не отправлена/);
  assert.match(text, /100000/);
});
