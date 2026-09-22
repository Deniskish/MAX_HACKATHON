// Проверка ИНН, текстовый экспорт и локальные ответы без обращения к модели.
import {
  type Application,
  type Program,
  type Profile,
  programs,
  evaluate,
  analyzeOpportunity,
  shortlist,
} from '../../api-server/support-model';
export * from '../../api-server/support-model';
export { validInn } from '../../api-server/company-data/inn';
// Выгружаем рабочий черновик с текущими отметками пользователя.
export function draftText(app: Application, program: Program, profile: Profile) {
  const result = evaluate(program, profile);
  return [
    'ЧЕРНОВИК · ДЕМОНСТРАЦИОННАЯ ПРОГРАММА',
    program.title,
    '',
    `Заявитель: ${profile.name}`,
    `ИНН: ${profile.inn}`,
    `Регион: ${profile.region}`,
    `ОКВЭД: ${profile.okved}`,
    `Цели: ${profile.goals.join(', ')}`,
    '',
    'Описание проекта:',
    app.project || '[Заполните описание проекта]',
    '',
    `Бюджет: ${app.budget || '[Укажите бюджет]'} руб.`,
    '',
    'Проверка условий:',
    ...result.checks.map(
      (c) =>
        `${c.status === 'pass' ? '+' : '?'} ${c.label}: ${c.status === 'pass' ? 'по данным пользователя' : c.status === 'fail' ? 'не соответствует' : 'нет данных'}`,
    ),
    '',
    'Документы (самостоятельная отметка, содержимое не проверялось):',
    ...program.documents.map(
      (d) =>
        `${app.documents[d] ? '[x]' : '[ ]'} ${d}${app.documents[d] ? ': ' + app.documents[d] : ''}`,
    ),
    '',
    program.source,
    'Это рабочий черновик, а не официальная форма. Заявка не отправлена.',
  ].join('\n');
}
// Запасной ответ строится из тех же правил, что и карточки программ.
export function localAnswer(
  question: string,
  profile: Profile | null,
  programId?: string,
  apps: Application[] = [],
): string {
  if (!profile)
    return 'Начните с профиля бизнеса: укажите ИНН, регион и цели. Тогда я смогу объяснить, какие условия демонстрационных программ совпадают с вашими данными.';
  const ranked = shortlist(profile, apps);
  const selected = programs.find((p) => p.id === programId);
  const best = selected
    ? {
        p: selected,
        r: analyzeOpportunity(
          selected,
          profile,
          apps.find((a) => a.programId === selected.id),
        ),
      }
    : ranked[0];
  if (!best)
    return 'В учебном наборе пока нет программ без препятствующих критериев. Уточните профиль и цели. Я не буду добавлять неподходящие программы ради количества.';
  if (/документ|заявк|подготов/i.test(question))
    return `Для «${best.p.title}» учебный список документов: ${best.p.documents.join('; ')}. Откройте программу и нажмите «Готовить заявку»: там можно отметить документы и скачать черновик. Содержимое файлов автоматически не проверяется.`;
  if (/срок|дедлайн/i.test(question))
    return `«${best.p.title}»: до ${best.p.deadline}, осталось ${best.r.daysLeft} дн. Ориентир подготовки — ${best.p.preparationDays} дн. Это учебная дата.`;
  if (/план|действ|шаг/i.test(question))
    return `План для «${best.p.title}»:\n${best.r.plan.map((s, i) => `${i + 1}. ${s.title}. ${s.detail}`).join('\n')}\n${best.p.source}`;
  return `«${best.p.title}»: ${best.r.status}. Выполнено ${best.r.confirmed} из ${best.r.total} пунктов (${best.r.score}%). Условия профиля: ${best.r.fulfilled.length} из ${best.r.checks.length}; документы: ${best.r.preparedDocuments.length} из ${best.p.documents.length}.\n${best.r.unmet.length ? 'Есть препятствия: ' + best.r.unmet.map((c) => c.label).join('; ') : best.r.unknown.length ? 'Уточните: ' + best.r.unknown.map((c) => c.label).join('; ') : 'Основные условия совпадают по вашим данным.'}\n${best.r.missingDocuments.length ? 'Подготовьте: ' + best.r.missingDocuments.join('; ') : 'Документы отмечены вами; содержимое не проверено.'}\nЭто доля выполненных пунктов, не вероятность одобрения. ${best.p.source}`;
}
