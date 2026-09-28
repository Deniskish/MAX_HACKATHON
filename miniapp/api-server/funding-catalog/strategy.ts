import type { FundingMatch, FundingNeed, FundingProfile, FundingStrategy } from './types';
import { normalizeFundingPurpose, allFundingPurposes } from './purposes';
import { rankFundingMatches } from './matching';
import { amountLabel, compatibilityNotice, fundingKindLabels, fundingStatusLabels,
  isSupporting, rateLabel, termLabel } from './presentation';

export function buildFundingStrategy(_profile: FundingProfile, need: FundingNeed,
  matches: FundingMatch[]): FundingStrategy {
  const candidates = rankFundingMatches(matches)
    .filter((m) => (m.personalEligibility?.candidate ?? m.personalEligibility?.confirmed) && m.status !== 'not_eligible' && m.status !== 'expired' && m.status !== 'upcoming' && m.opportunity.status !== 'unknown');
  const financing = candidates.filter((m) => !isSupporting(m.opportunity.kind)).slice(0, 4);
  const support = candidates.filter((m) => isSupporting(m.opportunity.kind))
    .sort((a, b) => Number(need.needsCollateralSupport === true && b.opportunity.kind === 'guarantee')
      - Number(need.needsCollateralSupport === true && a.opportunity.kind === 'guarantee')).slice(0, 3);
  const selected = [...financing, ...support];
  return {
    summary: `Потребность: ${normalizeFundingPurpose(need.purpose) ?? allFundingPurposes}${need.amount !== null ? ` — ${need.amount.toLocaleString('ru-RU')} ₽` : '; сумма не указана'}${need.preferredTermMonths !== null ? `, желаемый срок ${need.preferredTermMonths} мес.` : ''}.`,
    options: selected.map((m) => ({ opportunityId: m.opportunity.id,
      role: isSupporting(m.opportunity.kind) ? 'support' : 'financing',
      text: [fundingKindLabels[m.opportunity.kind], m.opportunity.title, amountLabel(m.opportunity),
        rateLabel(m.opportunity), termLabel(m.opportunity), fundingStatusLabels[m.status],
        m.amountFit === 'partial' ? 'Покрывает потребность лишь частично' : null,
        m.termFit === 'partial' ? 'Доступный срок короче желаемого' : null].filter(Boolean).join(' · '),
    })),
    notices: [compatibilityNotice,
      'Лимиты отдельных вариантов не складываются. Это варианты для рассмотрения, а не гарантированное финансирование.',
      'Поручительство, налоговая экономия, имущество и услуги не являются самостоятельной выдачей денег.',
      ...(need.ownFunds !== null ? [`Собственные средства: ${need.ownFunds.toLocaleString('ru-RU')} ₽. Они не вычитаются автоматически из запрошенной суммы финансирования; условия софинансирования требуют проверки.`] : []),
      ...(!financing.length ? ['Денежные варианты без явных препятствий не найдены. Уточните профиль и потребность.'] : []),
    ],
    nextActions: [...new Set(selected.flatMap((m) => m.nextActions))].slice(0, 6),
  };
}
