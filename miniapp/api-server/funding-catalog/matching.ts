import type { FundingMatch, FundingNeed, FundingOpportunity, FundingProfile,
  FundingRequirement, FundingStatus, RequirementCheck } from './types';
import { fundingStatusLabels, hasTerm, isLoan, isSupporting, lenderNotice } from './presentation';
import { normalizeRegion } from './source-registry';

const unknown = (value: unknown) => value === undefined || value === null || value === ''
  || value === 'unknown' || (Array.isArray(value) && value.length === 0)
  || (typeof value === 'number' && (!Number.isFinite(value) || value < 0));
const prefixMatches = (value: string, prefix: string) => value === prefix || value.startsWith(`${prefix}.`);

export function evaluateFundingRequirement(profile: FundingProfile, requirement: FundingRequirement): RequirementCheck {
  let value: unknown = profile[requirement.field];
  if (unknown(value)) return { ...requirement, status: 'unknown' };
  const expected = requirement.value;
  if (requirement.field === 'isSme' && typeof expected === 'boolean')
    value = value === 'yes' ? true : value === 'no' ? false : undefined;
  if (unknown(value)) return { ...requirement, status: 'unknown' };
  let pass = false;
  switch (requirement.operator) {
    case 'eq': pass = value === expected; break;
    case 'neq': pass = value !== expected; break;
    case 'gte': pass = typeof value === 'number' && typeof expected === 'number' && value >= expected; break;
    case 'lte': pass = typeof value === 'number' && typeof expected === 'number' && value <= expected; break;
    case 'prefix':
      pass = typeof value === 'string' && (Array.isArray(expected) ? expected : [expected])
        .some((p) => typeof p === 'string' && prefixMatches(value as string, p));
      break;
    case 'includes':
      // goals содержит цель; списки регионов/форм содержат скаляр профиля (OR внутри списка).
      pass = Array.isArray(value)
        ? (Array.isArray(expected) ? expected : [expected]).some((item) => (value as unknown[]).includes(item))
        : Array.isArray(expected) && typeof value === 'string' && (requirement.field === 'region'
          ? expected.some(item => normalizeRegion(String(item)) === normalizeRegion(value as string)) : expected.includes(value));
      break;
  }
  return { ...requirement, status: pass ? 'fulfilled' : 'missing' };
}

function restrictions(o: FundingOpportunity): FundingRequirement[] {
  const checks: FundingRequirement[] = [];
  if (o.regions !== 'all' && o.regions.length)
    checks.push({ field: 'region', operator: 'includes', value: o.regions, required: true,
      label: `Регион: ${o.regions.join(', ')}` });
  if (o.okvedPrefixes.length)
    checks.push({ field: 'okved', operator: 'prefix', value: o.okvedPrefixes, required: true,
      label: `Основной ОКВЭД: ${o.okvedPrefixes.join(' / ')}` });
  if (o.companyTypes.length)
    checks.push({ field: 'companyType', operator: 'includes', value: o.companyTypes, required: true,
      label: `Форма бизнеса: ${o.companyTypes.join(' / ')}` });
  return checks.concat(o.requirements);
}

export function fundingAmountFit(need: FundingNeed, o: FundingOpportunity): FundingMatch['amountFit'] {
  // Поручительство и экономия не покрывают денежную потребность выплатой.
  if (isSupporting(o.kind) || need.amount === null || !Number.isFinite(need.amount) || need.amount <= 0) return 'unknown';
  if (o.amountMin !== null && need.amount < o.amountMin) return 'no';
  if (o.amountMax === null) return 'unknown';
  return need.amount > o.amountMax ? 'partial' : 'full';
}
function fundingTermFit(need: FundingNeed, o: FundingOpportunity): FundingMatch['termFit'] {
  const term = need.preferredTermMonths;
  if (!hasTerm(o.kind) || term === null || !Number.isFinite(term) || term <= 0) return 'unknown';
  if (o.termMonthsMin !== null && term < o.termMonthsMin) return 'no';
  if (o.termMonthsMax === null) return 'unknown';
  return term > o.termMonthsMax ? 'partial' : 'yes';
}
export type MatchOptions = { now?: Date; preparedDocuments?: string[] };
export function matchFundingOpportunity(profile: FundingProfile, need: FundingNeed,
  opportunity: FundingOpportunity, options: MatchOptions = {}): FundingMatch {
  const applicantType = profile.applicantType ?? (profile.companyType === 'ИП' ? 'individual_entrepreneur' : profile.companyType && profile.companyType !== 'КФХ' ? 'legal_entity' : undefined);
  const checks = restrictions(opportunity).map((r) => evaluateFundingRequirement(profile, r));
  if (opportunity.applicantTypes?.length) checks.push(evaluateFundingRequirement({ ...profile, applicantType }, {
    field: 'applicantType', operator: 'includes', value: opportunity.applicantTypes, required: true, label: 'Допустимая категория заявителя',
  }));
  if (profile.companyStatus && profile.companyStatus !== 'active') checks.push({ field: 'companyStatus', operator: 'eq', value: 'active', required: true, label: 'Действующий статус регистрации', status: 'missing' });
  for (const label of opportunity.manualConditions ?? []) checks.push({ field: 'industry', operator: 'eq', value: '', required: true, label, status: 'unknown' });
  if (opportunity.projectBudgetMin != null) {
    const budget = need.amount !== null && need.ownFunds !== null ? need.amount + need.ownFunds : null;
    checks.push({ field: 'revenue', operator: 'gte', value: opportunity.projectBudgetMin, required: true,
      label: `Бюджет проекта от ${opportunity.projectBudgetMin.toLocaleString('ru-RU')} ₽; при нехватке известных средств уточнить другие источники`,
      status: budget !== null && budget >= opportunity.projectBudgetMin ? 'fulfilled' : 'unknown' });
  }
  if (opportunity.cofinancingPercent != null) {
    const share = need.amount !== null && need.ownFunds !== null ? need.ownFunds / (need.amount + need.ownFunds) * 100 : null;
    checks.push({ field: 'revenue', operator: 'gte', value: opportunity.cofinancingPercent, required: true,
      label: `Софинансирование не менее ${opportunity.cofinancingPercent}%: собственные средства, инвесторы или банки`,
      status: share !== null && share >= opportunity.cofinancingPercent ? 'fulfilled' : 'unknown' });
  }
  const fulfilledRequirements = checks.filter((r) => r.status === 'fulfilled');
  const missingRequirements = checks.filter((r) => r.status === 'missing');
  const unknownRequirements = checks.filter((r) => r.status === 'unknown');
  const purposeFit = opportunity.purposes.includes(need.purpose);
  const amountFit = fundingAmountFit(need, opportunity);
  const termFit = fundingTermFit(need, opportunity);
  const missingDocuments = opportunity.requiredDocuments.filter((d) => !options.preparedDocuments?.includes(d));
  const expired = opportunity.status === 'closed' || !!opportunity.imported?.endsAt && Date.parse(opportunity.imported.endsAt) < (options.now ?? new Date()).getTime() || opportunity.deadline !== null
    && new Date(`${opportunity.deadline}T23:59:59+03:00`).getTime() < (options.now ?? new Date()).getTime();
  const status: FundingStatus = expired ? 'expired'
    : opportunity.status === 'upcoming' ? 'upcoming'
    : missingRequirements.some((r) => r.required) || (!!need.purpose && !purposeFit && !opportunity.imported) || amountFit === 'no' || termFit === 'no'
      ? 'not_eligible'
      : opportunity.status === 'unknown' || unknownRequirements.some((r) => r.required) || !need.purpose
        || (need.amount !== null && !isSupporting(opportunity.kind) && amountFit === 'unknown')
        || (need.preferredTermMonths !== null && hasTerm(opportunity.kind) && termFit === 'unknown')
        ? 'need_more_data'
        : amountFit === 'partial' || termFit === 'partial' || missingRequirements.length
          ? 'almost_eligible' : 'eligible';
  const points: number[] = checks.map((c) => c.status === 'fulfilled' ? 1 : 0);
  points.push(purposeFit ? 1 : 0);
  if (need.amount !== null && !isSupporting(opportunity.kind)) points.push(amountFit === 'full' ? 1 : amountFit === 'partial' ? 0.5 : 0);
  if (need.preferredTermMonths !== null && hasTerm(opportunity.kind)) points.push(termFit === 'yes' ? 1 : termFit === 'partial' ? 0.5 : 0);
  const score = Math.round(points.reduce((sum, p) => sum + p, 0) / points.length * 100);
  const explanations = [fundingStatusLabels[status] + '.'];
  if (purposeFit) explanations.push('Цель соответствует назначению инструмента.');
  if (fulfilledRequirements.length) explanations.push(`Выполнено: ${fulfilledRequirements.map((r) => r.label).join('; ')}.`);
  if (missingRequirements.length) explanations.push(`Не выполнено: ${missingRequirements.map((r) => r.label).join('; ')}.`);
  if (unknownRequirements.length) explanations.push(`Неизвестно: ${unknownRequirements.map((r) => r.label).join('; ')}.`);
  if (!purposeFit) explanations.push('Цель не соответствует назначению или не указана.');
  if (amountFit === 'partial') explanations.push('Лимит покрывает только часть запрошенной суммы.');
  if (amountFit === 'full') explanations.push('Запрошенная сумма находится в пределах опубликованного лимита.');
  if (amountFit === 'no') explanations.push('Запрошенная сумма меньше минимальной суммы инструмента.');
  if (amountFit === 'unknown' && !isSupporting(opportunity.kind)) explanations.push('Полнота покрытия суммы не определена.');
  if (termFit === 'partial') explanations.push('Доступный срок короче желаемого.');
  if (termFit === 'no') explanations.push('Желаемый срок меньше минимального.');
  if (termFit === 'unknown' && hasTerm(opportunity.kind)) explanations.push('Соответствие срока не определено.');
  if (missingDocuments.length) explanations.push('Документы ещё не отмечены подготовленными.');
  if (isLoan(opportunity.kind)) explanations.push(lenderNotice);
  if (opportunity.kind === 'guarantee') explanations.push('Поручительство обеспечивает обязательства и не является выдачей денег.');
  if (opportunity.kind === 'lease') explanations.push('Лизинг финансирует оборудование; требуются аванс и последующие платежи.');
  const nextActions = [
    ...unknownRequirements.map((r) => `Уточнить: ${r.label}`),
    ...missingRequirements.map((r) => `Проверить несоответствие: ${r.label}`),
    ...missingDocuments.map((d) => `Подготовить: ${d}`),
  ];
  if (!purposeFit) nextActions.push('Уточнить цель или выбрать другой инструмент.');
  if (amountFit === 'partial') nextActions.push('Уточнить источник покрытия оставшейся потребности и совместимость инструментов.');
  if (amountFit === 'no') nextActions.push('Рассмотреть инструмент с меньшей минимальной суммой.');
  if (amountFit === 'unknown' && !isSupporting(opportunity.kind)) nextActions.push('Уточнить требуемую сумму или лимиты инструмента.');
  if (hasTerm(opportunity.kind) && termFit !== 'yes') nextActions.push('Уточнить приемлемый срок финансирования.');
  if (opportunity.kind === 'guarantee') nextActions.push('Проверить требования кредитора к поручительству.');
  if (expired) nextActions.unshift('Приём завершён; проверить новую версию программы.');
  if (!nextActions.length) nextActions.push('Проверить актуальные условия и порядок рассмотрения.');
  return { opportunity, status, score,
    relevance: score + (opportunity.kind === 'guarantee' && need.needsCollateralSupport === true ? 20 : 0),
    fulfilledRequirements, missingRequirements, unknownRequirements, missingDocuments,
    purposeFit, amountFit, termFit, explanation: explanations.join(' '), nextActions };
}
const order: Record<FundingStatus, number> = { eligible: 0, almost_eligible: 1, need_more_data: 2, not_eligible: 3, expired: 4, upcoming: 4 };
export function rankFundingMatches(matches: FundingMatch[]): FundingMatch[] {
  return [...matches].sort((a, b) => order[a.status] - order[b.status]
    || b.relevance - a.relevance || a.opportunity.id.localeCompare(b.opportunity.id));
}
