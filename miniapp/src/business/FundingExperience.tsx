import { ThemedImage } from './ThemedImage';
import React, { useEffect, useState, type FormEvent } from 'react';
import { ActionButton, BusinessInput } from './MaxControls';
import { Icon } from './Icon';
import type { FundingProfile } from '../../api-server/funding-catalog/types';
import { emptyFundingNeed, fundingPurposes, type FundingMatch, type FundingNeed,
  type FundingResponse } from '../../api-server/funding-catalog/types';
import { amountLabel, fundingKindLabels, fundingSourceLabel, fundingStatusLabels,
  rateLabel, scoreNotice, termLabel } from '../../api-server/funding-catalog/presentation';
import { fundingFingerprint, requestFunding, restoreFundingNeed } from './funding';
import { AIPanel } from './AIExperience';
import { ContextHelp, GuideLink } from './ContextHelp';

export function FundingOpportunityCard({ match, onOpen, onSave, saved, personalized = true, aiReason }: { match: FundingMatch; onOpen?: (id: string) => void; onSave?: (id: string) => void; saved?: boolean; personalized?: boolean; aiReason?: string }) {
  const o = match.opportunity;
  const rate = rateLabel(o), term = termLabel(o);
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
    {aiReason && <details className="ai-program-reason"><summary>Почему рекомендовано</summary><p>{aiReason}</p></details>}
    <strong>{amountLabel(o)}</strong>
    <div className="funding-key-facts">{rate && <span>{rate}</span>}{term && <span>Срок: {term}</span>}</div>
    <span className={`funding-status funding-status-${personalized ? match.status : o.status}`}>{personalized ? fundingStatusLabels[match.status] : { active: 'Приём открыт', closed: 'Приём завершён', upcoming: 'Ожидается открытие', unknown: 'Статус уточняется' }[o.status ?? 'unknown']}</span>

    <details>
      <summary>{personalized ? 'Условия и соответствие' : 'Условия программы'}</summary>
      <p>{o.description}</p>
      <p>Регион: {o.regions === "all" ? "Вся Россия" : o.regions.join(", ") || 'Смотрите территорию в объявлении'}</p>
      {personalized && <><p>Соответствие: {match.score}% · {scoreNotice}</p>
      <p>{match.explanation}</p>
      {match.missingRequirements.length > 0 && <p>Не выполнено: {match.missingRequirements.map((r) => r.label).join('; ')}.</p>}
      {match.unknownRequirements.length > 0 && <p>Нужно уточнить: {match.unknownRequirements.map((r) => r.label).join('; ')}.</p>}
      {match.missingDocuments.length > 0 && <p>Документы: {match.missingDocuments.join('; ')}.</p>}
      <ul>{match.nextActions.map((action) => <li key={action}>{action}</li>)}</ul></>}
      <p>Подготовка: {o.preparationDays === null ? 'не указана' : `${o.preparationDays} дн.`}.
        {' '}Сложность: {{ low: 'низкая', medium: 'средняя', high: 'высокая' }[o.difficulty]}.</p>
      <p className="widget-footnote">{fundingSourceLabel(o)} · версия {o.version} · {o.source.verifiedAt ?? o.source.updatedAt}.</p>
    </details>
    {o.deadline && <p className="widget-footnote">Приём до {o.deadline}</p>}
    {o.source.url && /^https:\/\//.test(o.source.url) &&
      <a href={o.source.url} target="_blank" rel="noreferrer">Источник условий</a>}
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
    <GuideLink topic="funding" />
    <section className="widget funding-strategy">{result.mode === 'demo' && <span className="tag">Учебные данные</span>}
      <h2>Варианты финансирования</h2><p>{result.strategy.summary}</p>
      <ol>{result.strategy.options.map((option) => <li key={option.opportunityId}>{option.role === 'support' ? 'Сопутствующая поддержка: ' : 'Вариант финансирования: '}{onOpen ? <button className="text-button" onClick={() => onOpen(option.opportunityId)}>{option.text}</button> : option.text}</li>)}</ol>
      {!!result.strategy.notices.length && <ContextHelp title="Что учесть при выборе">{result.strategy.notices.map((notice) => <p key={notice}>{notice}</p>)}</ContextHelp>}
    </section>
    {!result.matches.length && <p className="muted">Вариантов пока нет. Попробуйте изменить параметры подбора.</p>}
    {groups.filter((group) => group.matches.length).map((group) => <section key={group.title}><h2>{group.title}</h2>
      <div className="funding-grid">{group.matches.slice(0, limit).map((match) => <FundingOpportunityCard key={match.opportunity.id} match={match} onOpen={onOpen} onSave={onSave} saved={saved.includes(match.opportunity.id)} />)}</div>
      {group.matches.length > limit && <ActionButton className="secondary" onClick={() => setLimit((n) => n + 12)}>Показать ещё</ActionButton>}
    </section>)}
    {result.matches.some((m) => m.status === 'not_eligible') && <details className="widget"><summary>Не подходят по условиям</summary><div className="funding-grid">{result.matches.filter((m) => m.status === 'not_eligible').slice(0, limit).map((match) => <FundingOpportunityCard key={match.opportunity.id} match={match} onOpen={onOpen} />)}</div>{result.matches.filter((m) => m.status === 'not_eligible').length > limit && <ActionButton className="secondary" onClick={() => setLimit((n) => n + 12)}>Показать ещё</ActionButton>}</details>}
  </div>;
}

// key по ИНН задаётся в родителе только для локального хранения; matching ИНН не получает.
export function FundingExperience({ profile, initialNeed, onNeed, onOpen, onResult, storageId = '' }: {
  profile: FundingProfile; initialNeed?: FundingNeed; onNeed?: (need: FundingNeed) => void;
  onOpen?: (id: string) => void; onResult: (result: FundingResponse, fingerprint: string) => void; storageId?: string;
}) {
  const storageKey = `opora.funding-need.v1.${storageId}`;
  const [need, setNeed] = useState<FundingNeed>(() => {
    if (initialNeed) return initialNeed;
    try { return restoreFundingNeed(localStorage.getItem(storageKey)); }
    catch { return { ...emptyFundingNeed }; }
  });
  const [error, setError] = useState('');
  const [storageNotice, setStorageNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const pending = React.useRef<AbortController | null>(null);
  const panel = React.useRef<HTMLElement | null>(null);
  useEffect(() => {
    panel.current?.closest('.project-dialog')?.scrollTo({ top: 0 });
    panel.current?.closest('dialog')?.scrollTo({ top: 0 });
  }, [loading]);
  const fingerprint = fundingFingerprint(profile, need);
  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setLoading(false);
    setError('');
    return () => { pending.current?.abort(); pending.current = null; };
  }, [fingerprint]);
  useEffect(() => {
    onNeed?.(need);
    try { if (!onNeed) localStorage.setItem(storageKey, JSON.stringify(need)); setStorageNotice(''); }
    catch { setStorageNotice('Не удалось сохранить потребность в браузере.'); }
  }, [need, storageKey]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setLoading(true);
    setError('');
    try {
      const [data] = await Promise.all([requestFunding(profile, need, controller.signal), new Promise<void>((resolve) => setTimeout(resolve, 650))]);
      if (!controller.signal.aborted && pending.current === controller) onResult(data, fingerprint);
    } catch (err) {
      if (pending.current === controller) setError(controller.signal.aborted
        ? 'Время ожидания истекло. Повторите подбор.'
        : err instanceof Error ? err.message : 'Не удалось выполнить подбор.');
    } finally {
      clearTimeout(timeout);
      if (pending.current === controller) { pending.current = null; setLoading(false); }
    }
  }
  if (loading) return <section ref={panel} className="funding-searching" role="status" aria-live="polite">
    <div className="funding-search-animation" aria-hidden="true"><ThemedImage src="/assets/orb.png" width={100} height={100} alt="" /><span /></div>
    <h2>Подбираем поддержку</h2>
    <ActionButton className="secondary" onClick={() => { pending.current?.abort(); pending.current = null; setLoading(false); }}>Отменить подбор</ActionButton>
  </section>;
  return <section ref={panel} className="funding-experience">
    <details className="ai-entry"><summary>Описать потребность своими словами</summary><AIPanel title="Умный подбор" task="intake" context={{ profile, need: need.purpose ? need : undefined, page: 'funding' }} onNeed={setNeed} onOpen={onOpen} /></details>
    <form className="widget" onSubmit={submit}>
      <h2>Что нужно вашему бизнесу?</h2>
      <div className="form-grid">
        <label className="field">Цель
          <select required value={need.purpose} onChange={(e) => setNeed({ ...need, purpose: e.target.value })}>
            <option value="">Выберите цель</option>
            {fundingPurposes.map((purpose) => <option key={purpose} value={purpose}>{purpose}</option>)}
          </select>
        </label>
        {(['amount', 'preferredTermMonths', 'ownFunds'] as const).map((field) => <label className="field" key={field}>
          {{ amount: 'Требуемое финансирование, ₽', preferredTermMonths: 'Желаемый срок, месяцев', ownFunds: 'Собственные средства, ₽' }[field]}
          <BusinessInput type="number" min={field === 'ownFunds' ? 0 : 1}
            max={field === 'preferredTermMonths' ? 600 : 1e15} step="1" placeholder="Необязательно"
            value={need[field] ?? ''} onChange={(e) => setNeed({ ...need, [field]: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>)}
        <label className="field">Нужна помощь с обеспечением / залогом?
          <select value={need.needsCollateralSupport === null ? '' : String(need.needsCollateralSupport)}
            onChange={(e) => setNeed({ ...need, needsCollateralSupport: e.target.value === '' ? null : e.target.value === 'true' })}>
            <option value="">Пока не знаю</option><option value="true">Да</option><option value="false">Нет</option>
          </select>
        </label>
      </div>
      <GuideLink topic="funding" />
      <ActionButton type="submit" className="primary" disabled={loading}>
        {loading ? 'Подбираем варианты…' : 'Найти варианты'}
      </ActionButton>
      {error && <p className="error" role="alert">{error}</p>}
      {storageNotice && <p role="status">{storageNotice}</p>}
    </form>
  </section>;
}
