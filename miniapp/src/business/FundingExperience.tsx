import { InfoDisclosureRow } from './InfoDisclosureRow';
import { InfoDisclosure } from './InfoDisclosure';
import { ThemedImage } from './ThemedImage';
import React, { useEffect, useState, type FormEvent } from 'react';
import { ActionButton, BusinessInput } from './MaxControls';
import { Icon } from './Icon';
import { emptyFundingNeed, fundingPurposes, type FundingMatch, type FundingNeed,
  type FundingResponse } from '../../api-server/funding-catalog/types';
import { amountLabel, fundingKindLabels, fundingStatusLabels,
  rateLabel, termLabel } from '../../api-server/funding-catalog/presentation';

import { normalizeFundingPurpose, allFundingPurposes } from '../../api-server/funding-catalog/purposes';
import { displayDate } from './display';


export function FundingOpportunityCard({ match, onOpen, onSave, saved, personalized = true }: { match: FundingMatch; onOpen?: (id: string) => void; onSave?: (id: string) => void; saved?: boolean; personalized?: boolean }) {
  const o = match.opportunity;
  const rate = rateLabel(o), term = termLabel(o);
  const matchLabel = match.status === 'need_more_data' && match.personalEligibility?.confirmed === false && !match.personalEligibility.candidate
    ? 'Недостаточно данных для персонального подбора'
    : match.status === 'need_more_data' && match.personalEligibility?.candidate && !match.personalEligibility.confirmed
      ? 'Нужно уточнить' : fundingStatusLabels[match.status];
  return <article className="widget funding-card">
    <div className="funding-card-heading">
      <div className="funding-card-tags">
      <span className="tag">{fundingKindLabels[o.kind]}</span>
      {o.source.type === 'demo' && <span className="tag">Учебные данные</span>}
      </div>
      {onSave && <button className={`save-program${saved ? ' is-saved' : ''}`} aria-label={`${saved ? 'Убрать из сохранённых' : 'Сохранить'}: ${o.title}`} aria-pressed={Boolean(saved)} onClick={() => onSave(o.id)}><Icon name="bookmark" size={19} /></button>}
    </div>
    <h3>{o.title}</h3>
    <p className="muted">{o.providerName}</p>
    <strong>{amountLabel(o)}</strong>
    <div className="funding-key-facts">{rate && <span>{rate}</span>}{term && <span>Срок: {term}</span>}</div>
    <span className={`funding-status funding-status-${personalized ? match.status : o.status}`}>{personalized ? matchLabel : { active: 'Приём открыт', closed: 'Приём завершён', upcoming: 'Ожидается открытие', unknown: 'Статус уточняется' }[o.status ?? 'unknown']}</span>

    {o.deadline && <p className="widget-footnote">Приём до {displayDate(o.deadline)}</p>}
    {onOpen && <ActionButton className="primary" onClick={() => onOpen(o.id)}>Подробнее</ActionButton>}
  </article>;
}

export function FundingResults({ result, onOpen, onSave, saved = [] }: { result: FundingResponse; onOpen?: (id: string) => void; onSave?: (id: string) => void; saved?: string[] }) {
  const [limit, setLimit] = useState(12);
  useEffect(() => setLimit(12), [result]);
  const groups: { title: string; matches: FundingMatch[] }[] = [
    { title: 'Подходит сейчас', matches: result.matches.filter((m) => m.status === 'eligible').slice(0, 3) },
    { title: 'Почти подходит', matches: result.matches.filter((m) => m.status === 'almost_eligible') },
    { title: 'Нужно уточнить', matches: result.matches.filter((m) => m.status === 'need_more_data') },
    { title: 'Следить за открытием', matches: result.matches.filter((m) => ['expired', 'upcoming'].includes(m.status)) },
  ];
  return <div className="funding-results" aria-live="polite">
    <section className="widget funding-strategy">{result.mode === 'demo' && <span className="tag">Учебные данные</span>}
      <h2>Варианты финансирования</h2><p>{result.strategy.summary}</p>
      <ol>{result.strategy.options.map((option) => <li key={option.opportunityId}>{option.role === 'support' ? 'Сопутствующая поддержка: ' : 'Вариант финансирования: '}{onOpen ? <button className="text-button" onClick={() => onOpen(option.opportunityId)}>{option.text}</button> : option.text}</li>)}</ol>
    </section>
    {!result.matches.length && <p className="muted">Вариантов пока нет. Попробуйте изменить параметры подбора.</p>}
    {groups.filter((group) => group.matches.length).map((group) => <section key={group.title}><h2>{group.title}</h2>
      <div className="funding-grid">{group.matches.slice(0, limit).map((match) => <FundingOpportunityCard key={match.opportunity.id} match={match} onOpen={onOpen} onSave={onSave} saved={saved.includes(match.opportunity.id)} />)}</div>
      {group.matches.length > limit && <ActionButton className="secondary" onClick={() => setLimit((n) => n + 12)}>Показать ещё</ActionButton>}
    </section>)}
    {result.matches.some((m) => m.status === 'not_eligible') && <InfoDisclosure summary={<InfoDisclosureRow as="summary" label="Не подходят по условиям" />}><div className="funding-grid">{result.matches.filter((m) => m.status === 'not_eligible').slice(0, limit).map((match) => <FundingOpportunityCard key={match.opportunity.id} match={match} onOpen={onOpen} />)}</div>{result.matches.filter((m) => m.status === 'not_eligible').length > limit && <ActionButton className="secondary" onClick={() => setLimit((n) => n + 12)}>Показать ещё</ActionButton>}</InfoDisclosure>}
  </div>;
}

// The form edits a draft task; confirmation updates the same catalogue matching used everywhere.
export function FundingExperience({ initialNeed, onApply }: {
  initialNeed?: FundingNeed; onApply: (need: FundingNeed) => void;
}) {
  const [need, setNeed] = useState<FundingNeed>(() => ({ ...(initialNeed ?? emptyFundingNeed), purpose: normalizeFundingPurpose(initialNeed?.purpose ?? '') ?? allFundingPurposes }));
  const [loading, setLoading] = useState(false);
  const pending = React.useRef<AbortController | null>(null);
  const panel = React.useRef<HTMLElement | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault(); pending.current?.abort();
    const controller = new AbortController(); pending.current = controller; setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 400));
    if (!controller.signal.aborted) onApply(need);
  }
  if (loading) return <section ref={panel} className="funding-searching" role="status" aria-live="polite">
    <div className="funding-search-animation" aria-hidden="true"><ThemedImage src="/assets/orb.png" width={100} height={100} alt="" /><span /></div>
    <h2>Подбираем поддержку</h2>
    <ActionButton className="secondary" onClick={() => { pending.current?.abort(); pending.current = null; setLoading(false); }}>Отменить подбор</ActionButton>
  </section>;
  return <section ref={panel} className="funding-experience">
    <form className="widget" onSubmit={submit}>
      <h2>Что нужно вашему бизнесу?</h2>
      <div className="form-grid">
        <label className="field">Цель
          <select aria-label="Цель" value={need.purpose} onChange={(e) => setNeed({ ...need, purpose: e.target.value })}>
            {fundingPurposes.map((purpose) => <option key={purpose} value={purpose}>{purpose}</option>)}
          </select>
        </label>
        <label className="field">Требуемое финансирование, ₽
          <BusinessInput aria-label="Требуемое финансирование, ₽" type="number" min={1} max={1e15} step="1" placeholder="Необязательно"
            value={need.amount ?? ''} onChange={(e) => setNeed({ ...need, amount: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
      </div>
      <InfoDisclosure className="funding-refinements" summary={<InfoDisclosureRow as="summary" label="Уточняющие параметры" />}>
        <div className="form-grid">
          {(['preferredTermMonths', 'ownFunds'] as const).map((field) => <label className="field" key={field}>
            {{ preferredTermMonths: 'Желаемый срок, месяцев', ownFunds: 'Собственные средства, ₽' }[field]}
            <BusinessInput aria-label={field === 'preferredTermMonths' ? 'Желаемый срок, месяцев' : 'Собственные средства, ₽'}
              type="number" min={field === 'ownFunds' ? 0 : 1} max={field === 'preferredTermMonths' ? 600 : 1e15} step="1" placeholder="Необязательно"
              value={need[field] ?? ''} onChange={(e) => setNeed({ ...need, [field]: e.target.value === '' ? null : Number(e.target.value) })} />
          </label>)}
          <label className="field">Нужна помощь с обеспечением / залогом?
            <select aria-label="Нужна помощь с обеспечением / залогом?" value={need.needsCollateralSupport === null ? '' : String(need.needsCollateralSupport)}
              onChange={(e) => setNeed({ ...need, needsCollateralSupport: e.target.value === '' ? null : e.target.value === 'true' })}>
              <option value="">Пока не знаю</option><option value="true">Да</option><option value="false">Нет</option>
            </select>
          </label>
        </div>
      </InfoDisclosure>
      <ActionButton type="submit" className="primary" disabled={loading}>
        {loading ? 'Подбираем варианты…' : 'Найти варианты'}
      </ActionButton>
    </form>
  </section>;
}
