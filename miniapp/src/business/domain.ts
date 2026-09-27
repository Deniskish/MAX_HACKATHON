// Проверка ИНН, текстовый экспорт и локальные ответы без обращения к модели.
import type { Application, Profile } from '../../api-server/business-model';
import type { FundingMatch, FundingOpportunity } from '../../api-server/funding-catalog/types';
export * from '../../api-server/business-model';
export * from '../../api-server/documents';
export { validInn } from '../../api-server/company-data/inn';
// Выгружаем рабочий черновик с текущими отметками пользователя.
export function draftText(app: Application, program: FundingOpportunity, profile: Profile, match?: FundingMatch) {

  return [
    'ЧЕРНОВИК · НЕ ОТПРАВЛЕН',
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
    ...(match ? [...match.fulfilledRequirements, ...match.unknownRequirements, ...match.missingRequirements].map(c =>
      `${c.status === 'fulfilled' ? '+' : '?'} ${c.label}: ${c.status === 'fulfilled' ? 'по данным пользователя' : c.status === 'missing' ? 'не соответствует' : 'нужно уточнить'}`) : ['Условия не проверены. Сверьте их с официальным источником.']),
    '',
    'Документы (самостоятельная отметка, содержимое не проверялось):',
    ...program.requiredDocuments.map(
      (d) =>
        `${app.documents[d] ? '[x]' : '[ ]'} ${d}${app.documents[d] ? ': ' + app.documents[d] : ''}`,
    ),
    '',
    app.generatedDraft || '',
    ...Object.entries(app.documentTexts ?? {}).map(([name, doc]) => `${name}\n${doc.pages.map(p => `[Страница ${p.page}]\n${p.text}`).join('\n\n')}`),
    program.source.url ?? '',
    'Это рабочий черновик, а не официальная форма. Заявка не отправлена.',
  ].join('\n');
}
