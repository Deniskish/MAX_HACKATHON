import { InfoDisclosure } from './InfoDisclosure';
import { InfoDisclosureRow } from './InfoDisclosureRow';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionButton, BusinessTextarea } from './MaxControls';
import { aiErrorMessage, requestAI, type AIRequest, type AIResult } from './ai-client';
import type { FundingNeed, FundingProfile } from '../../api-server/funding-catalog/types';
import { fundingStatusLabels } from '../../api-server/funding-catalog/presentation';
import { Icon } from './Icon';


type Handlers = {
  onOpen?: (id: string) => void; onPrepare?: (id: string) => void; onFunding?: () => void;
  onNeed?: (need: FundingNeed) => void; onProfile?: (profile: FundingProfile) => void; onQuestion?: (text: string) => void;
  onDraft?: (text: string) => void;
};
const fieldLabels: Record<string, string> = { purpose: 'Цель', amount: 'Нужно, ₽', ownFunds: 'Свои средства, ₽', preferredTermMonths: 'Срок, мес.', needsCollateralSupport: 'Помощь с залогом',
  region: 'Регион', industry: 'Направление', okved: 'ОКВЭД', companyType: 'Форма бизнеса', applicantType: 'Заявитель', ageMonths: 'Возраст, мес.', employees: 'Сотрудники', revenue: 'Оборот, ₽', isSme: 'Статус МСП', stage: 'Стадия' };
const values: Record<string, string> = { legal_entity: 'Компания', individual_entrepreneur: 'ИП', project: 'Проект', team: 'Команда', individual: 'Физическое лицо', idea: 'Идея', prototype: 'Прототип', mvp: 'MVP', revenue: 'Есть выручка', yes: 'Да', no: 'Нет', unknown: 'Неизвестно' };

export function AIIntakeDisclosure({ children }: { children: ReactNode }) {
  return <InfoDisclosure className="ai-entry business-intake-ai"
    summary={<InfoDisclosureRow as="summary" label="Заполнить с помощью AI" icon="spark" />}>{children}</InfoDisclosure>;
}
function Facts({ data }: { data: object }) {
  return <dl className="ai-facts">{Object.entries(data).map(([k, v]) => <div key={k}><dt>{fieldLabels[k] ?? k}</dt><dd>{v == null ? 'Не указано' : typeof v === 'boolean' ? v ? 'Да' : 'Нет' : typeof v === 'number' ? v.toLocaleString('ru-RU') : values[String(v)] ?? String(v)}</dd></div>)}</dl>;
}
export function AIResultView({ result, onOpen, onPrepare, onFunding, onNeed, onProfile, onQuestion, onDraft, showAnswer = true }: Handlers & { result: AIResult; showAnswer?: boolean }) {
  const [applied, setApplied] = useState<string[]>([]);
  useEffect(() => setApplied([]), [result]);
  if (result.providerFailure) return null;
  return <div className="ai-result">
    <span className="tag">{result.mode === 'llm' ? 'AI-анализ' : 'Проверка по правилам'}</span>
    {showAnswer && <p className="ai-answer">{result.answer}</p>}
    {result.draft && <section className="ai-proposal"><h3>Предложенный текст</h3><BusinessTextarea aria-label="Предложенный AI-черновик" rows={10} readOnly value={result.draft} />
      {onDraft && <ActionButton className="secondary" onClick={() => onDraft(result.draft!)}>Использовать этот текст</ActionButton>}</section>}
    {result.findings.map((f, i) => {
      const citation = result.citations.find((s) => s.id === f.evidenceId);
      return <article className="ai-finding" key={i}><b>{f.title}</b><p>{f.detail}</p>{f.quote && <blockquote>{f.quote}</blockquote>}
        <small>{f.severity === 'warning' ? 'Найдено в тексте' : 'Проверьте вручную'}{citation?.page ? ` · стр. ${citation.page}` : ''}</small></article>;
    })}
    {result.proposedNeed && onNeed && <section className="ai-proposal"><h3>Проверьте задачу</h3><Facts data={result.proposedNeed} />
      <ActionButton className="secondary" disabled={applied.includes('need')} onClick={() => { onNeed(result.proposedNeed!); setApplied((v) => [...v, 'need']); }}>{applied.includes('need') ? 'Задача сохранена' : 'Применить к подбору'}</ActionButton></section>}
    {result.proposedProfile && onProfile && <section className="ai-proposal"><h3>Предложенные сведения о бизнесе</h3><Facts data={result.proposedProfile} />
      <ActionButton className="secondary" onClick={() => onProfile(result.proposedProfile!)}>Проверить в профиле</ActionButton></section>}
    {!!result.scenarios.length && <InfoDisclosure summary={<InfoDisclosureRow as="summary" label="Сравнение сценариев" />}>{result.scenarios.map((s, i) => <section className="ai-proposal" key={i}><h3>{s.label}</h3><Facts data={s.need} />
      {s.matches.map((m) => <p key={m.id}>{m.title}: {fundingStatusLabels[m.status as keyof typeof fundingStatusLabels] ?? m.status}</p>)}</section>)}</InfoDisclosure>}
    {!!result.citations.length && <InfoDisclosure className="ai-sources" summary={<InfoDisclosureRow as="summary" label={`Источники и основания · ${result.citations.length}`} />}>{result.citations.map((s) => <div key={s.id}>
      {s.url?.startsWith('https://') ? <a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a> : <b>{s.title}{s.page ? ` · стр. ${s.page}` : ''}</b>}
      {s.checkedAt && <small>Проверен {s.checkedAt}</small>}<p>{s.text}</p></div>)}</InfoDisclosure>}
    <div className="ai-actions">{result.actions.map((a, i) => {
      const run = a.type === 'open_program' && a.programId && onOpen ? () => onOpen(a.programId!)
        : a.type === 'prepare_application' && a.programId && onPrepare ? () => onPrepare(a.programId!)
        : a.type === 'open_funding' ? onFunding : undefined;
      return run ? <ActionButton className="secondary" key={i} onClick={run}>{a.label}</ActionButton> : null;
    })}</div>
    {onQuestion && !!result.followups.length && <div className="ai-followups"><small>Уточним детали</small>{result.followups.map((q) => <button key={q} onClick={() => onQuestion(`${q}\nМой ответ: `)}>{q}</button>)}</div>}
  </div>;
}
export function AIPanel({ title, task, context, initialQuestion = '', button = 'Разобрать с AI', onResult, ...handlers }: Handlers & {
  title: string; task: AIRequest['task']; context: AIRequest['context']; initialQuestion?: string; button?: string; onResult?: (result: AIResult) => void;
}) {
  const [question, setQuestion] = useState(initialQuestion), [result, setResult] = useState<AIResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const applying = useRef(false);
  const fingerprint = JSON.stringify(context);
  useEffect(() => { pending.current?.abort(); pending.current = null; setBusy(false);
    if (!applying.current) setResult(null); applying.current = false;
    setError(''); return () => pending.current?.abort(); }, [fingerprint, task]);
  async function run(text = question) {
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(''); setResult(null);
    try {
      const answer = await requestAI({ task, question: text, context }, controller.signal);
      if (pending.current === controller && !controller.signal.aborted) {
        if (answer.providerFailure || task === 'review' && answer.mode === 'local') setError(aiErrorMessage(answer.providerFailure ?? 'PROVIDER_UNAVAILABLE'));
        else { setResult(answer); if (answer.providerFailure) setError(aiErrorMessage(answer.providerFailure)); onResult?.(answer); }
      }
    } catch (e) { if (pending.current === controller && !controller.signal.aborted) setError(aiErrorMessage(e)); }
    finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  }
  return <section className="widget ai-panel" aria-busy={busy}><div className="widget-heading"><h2>{title}</h2><Icon name="spark" /></div>
    <label className="field">Задача для помощника<BusinessTextarea rows={3} maxLength={2000} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Опишите задачу своими словами" /></label>
    <ActionButton className="primary" disabled={busy || !question.trim()} onClick={() => void run()}>{busy ? 'Анализируем…' : error ? 'Повторить запрос' : button}</ActionButton>
    {busy && <ActionButton className="text-button" onClick={() => { pending.current?.abort(); pending.current = null; setBusy(false); }}>Отменить</ActionButton>}
    {result && <AIResultView result={result} {...handlers} onNeed={handlers.onNeed ? (need) => { applying.current = JSON.stringify(context.need) !== JSON.stringify(need); handlers.onNeed!(need); } : undefined} onQuestion={(q) => { setQuestion(q); }} />}
  </section>;
}
