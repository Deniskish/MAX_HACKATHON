import type { FundingKind, FundingOpportunity, FundingStatus } from './types';

export const fundingKindLabels: Record<FundingKind, string> = {
  grant: 'Грант', subsidy: 'Субсидия', preferential_loan: 'Льготный кредит',
  commercial_loan: 'Банковский кредит', loan: 'Кредит / заем', guarantee: 'Поручительство', lease: 'Лизинг',
  tax: 'Налоговая льгота', property: 'Имущественная поддержка', service: 'Нефинансовая поддержка',
  investment: 'Инвестиции', unknown: 'Вид поддержки не уточнён',
};
export const fundingStatusLabels: Record<FundingStatus, string> = {
  eligible: 'Подходит для рассмотрения', almost_eligible: 'Требует подготовки / частичное покрытие',
  need_more_data: 'Не хватает данных', not_eligible: 'Есть несоответствия', expired: 'Приём завершён', upcoming: 'Ожидается открытие',
};
export const lenderNotice = 'Окончательное решение принимает кредитор.';
export const compatibilityNotice = 'Совместимость инструментов необходимо проверить по условиям конкретных программ';
export const scoreNotice = 'Техническая оценка соответствия профиля и потребности, не вероятность одобрения. Документы учитываются отдельно.';
export const isLoan = (kind: FundingKind) => kind === 'preferential_loan' || kind === 'commercial_loan' || kind === 'loan';
export const hasTerm = (kind: FundingKind) => isLoan(kind) || kind === 'lease' || kind === 'guarantee';
export const isSupporting = (kind: FundingKind) => ['guarantee', 'tax', 'property', 'service'].includes(kind);
const rubles = (value: number) => `${value.toLocaleString('ru-RU')} ₽`;
export function amountLabel(o: FundingOpportunity): string {
  if (o.kind === 'tax') return 'Экономия зависит от налоговой базы; денежная выплата не предусмотрена';
  if (o.kind === 'property') return 'Предоставление имущества; денежная выплата не предусмотрена';
  if (o.kind === 'service') return 'Услуга без денежной выплаты';
  const range = o.amountMin !== null && o.amountMax !== null
    ? `${rubles(o.amountMin)} — ${rubles(o.amountMax)}`
    : o.amountMax !== null ? `до ${rubles(o.amountMax)}`
      : o.amountMin !== null ? `от ${rubles(o.amountMin)}; верхний лимит неизвестен` : 'Сумма не указана';
  return o.kind === 'guarantee' ? `Лимит обеспечения: ${range}. Это не выдача денег.`
    : o.kind === 'lease' ? `Стоимость оборудования: ${range}. Требуются аванс и платежи.` : range;
}
export function rateLabel(o: FundingOpportunity): string | null {
  if (!isLoan(o.kind) && o.kind !== 'lease' && o.kind !== 'guarantee') return null;
  const rate = o.rateMin !== null && o.rateMax !== null ? `${o.rateMin}–${o.rateMax}%`
    : o.rateMin !== null ? `от ${o.rateMin}%` : o.rateMax !== null ? `до ${o.rateMax}%` : 'не указана';
  const label = o.kind === 'guarantee' ? 'Комиссия' : o.kind === 'lease' ? 'Удорожание' : 'Ставка';
  return `${label}: ${rate}${rate === 'не указана' ? '' : ' годовых'}`;
}
export function termLabel(o: FundingOpportunity): string | null {
  if (!hasTerm(o.kind)) return null;
  if (o.termMonthsMin !== null && o.termMonthsMax !== null) return `${o.termMonthsMin}–${o.termMonthsMax} мес.`;
  if (o.termMonthsMax !== null) return `до ${o.termMonthsMax} мес.`;
  if (o.termMonthsMin !== null) return `от ${o.termMonthsMin} мес.; верхний срок неизвестен`;
  return 'Срок не указан';
}
export const fundingSourceLabel = (o: FundingOpportunity) =>
  `${o.source.type === 'demo' ? 'Учебные данные' : 'Официальный источник'} · ${o.source.name}`;
