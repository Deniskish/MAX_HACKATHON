import { demoProfile, programs } from '../../api-server/tests/fixtures/profiles';
// Проверяем ИНН, границы условий и содержание экспортируемого черновика.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validInn,
  evaluate,
  emptyProfile,
  draftText,
  localAnswer,
} from './domain';
const now = new Date('2026-09-16T12:00:00Z');
test('INN validates both lengths and rejects invalid checksums and zeros', () => {
  assert.equal(validInn('7707083893'), true);
  assert.equal(validInn('500100732259'), true);
  for (const value of ['7707083894', '500100732258', '0000000000', '123', 'abcdefghij'])
    assert.equal(validInn(value), false);
});
test('unknown information is never treated as a match', () => {
  const result = evaluate(programs[0], emptyProfile, now);
  assert.equal(result.score, 0);
  assert.equal(result.status, 'Нужно уточнить');
  assert.ok(result.checks.every((c) => c.status === 'unknown'));
});
test('matching profile passes; region, SME and industry mismatches fail', () => {
  assert.equal(evaluate(programs[0], demoProfile, now).score, 100);
  assert.equal(
    evaluate(programs[1], { ...demoProfile, region: 'Казань' }, now).status,
    'Есть несоответствия',
  );
  assert.equal(
    evaluate(programs[0], { ...demoProfile, isSme: 'no' }, now).checks[0].status,
    'fail',
  );
  assert.equal(
    evaluate(programs[0], { ...demoProfile, okved: '63.11' }, now).checks[1].status,
    'fail',
  );
});
test('numerical boundaries are inclusive and zero differs from missing', () => {
  assert.equal(
    evaluate(programs[0], { ...demoProfile, ageMonths: 12 }, now).checks[2].status,
    'pass',
  );
  assert.equal(
    evaluate(programs[0], { ...demoProfile, ageMonths: 11 }, now).checks[2].status,
    'fail',
  );
  assert.equal(
    evaluate(programs[3], { ...demoProfile, employees: 0 }, now).checks[1].status,
    'pass',
  );
  assert.equal(
    evaluate(programs[3], { ...demoProfile, employees: 101 }, now).checks[1].status,
    'fail',
  );
  assert.equal(
    evaluate(programs[3], { ...demoProfile, employees: null }, now).checks[1].status,
    'unknown',
  );
});
test('deadline uses the end of day in Moscow and overrides matching', () => {
  assert.equal(evaluate(programs[0], demoProfile, new Date('2026-11-30T20:59:58Z')).expired, false);
  assert.equal(
    evaluate(programs[0], demoProfile, new Date('2026-11-30T21:00:00Z')).status,
    'Приём завершён',
  );
});
test('draft preserves project and document state and identifies simulation', () => {
  const text = draftText(
    {
      id: 'test',
      programId: programs[0].id,
      createdAt: now.toISOString(),
      project: 'Новый продукт',
      budget: '100000',
      documents: { [programs[0].documents[0]]: 'extract.pdf' },
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
test('assistant asks for missing profile and explains demo evidence', () => {
  assert.match(localAnswer('Помоги', null), /Начните с профиля/);
  assert.match(localAnswer('Какие документы?', demoProfile, 'equipment', [], programs), /документ|актуализация/i);
});
