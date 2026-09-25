import React, { type FormEvent } from 'react';
import type { FundingMatch, ProjectProfile } from '../../api-server/funding-catalog/types';
import { fundingPurposes } from '../../api-server/funding-catalog/types';
import { amountLabel, rateLabel, termLabel, fundingStatusLabels, scoreNotice } from '../../api-server/funding-catalog/presentation';
import { ActionButton, BusinessInput } from './MaxControls';
import { ModalSheet } from './ModalSheet';
export const opportunityStateLabels = { active: 'Приём открыт', closed: 'Приём завершён', upcoming: 'Ожидается открытие', unknown: 'Доступность требует проверки' };
export function OfficialDetails({ match, onAsk }: { match: FundingMatch; onAsk: () => void }) {
  const o = match.opportunity;
  return <section className="official-details">
    <p>{o.providerName}</p>
    <div className="detail-facts"><strong>{amountLabel(o)}</strong>{rateLabel(o) && <span>{rateLabel(o)}</span>}{termLabel(o) && <span>{termLabel(o)}</span>}</div>
    <p>{opportunityStateLabels[o.status ?? 'unknown']} · Срок приёма: {o.deadline ?? 'Не опубликован'}</p>
    <p>Источник: {o.source.name} · проверен {o.source.verifiedAt}</p>
    <a className="official-link" href={o.source.url!} target="_blank" rel="noreferrer">Открыть официальный источник ↗</a>
    <h3>{fundingStatusLabels[match.status]}</h3><p>{scoreNotice}</p>
    <div className="detail-checks">
      {([['Почему подходит', match.fulfilledRequirements], ['Что нужно уточнить', match.unknownRequirements], ['Что не соответствует', match.missingRequirements]] as const).map(([title, checks]) => <section key={title}><h3>{title}</h3>{checks.length ? <ul>{checks.map((c, i) => <li key={i}>{c.label}</li>)}</ul> : <p className="muted">Нет пунктов в этой группе.</p>}</section>)}
    </div>
    <p>{match.explanation}</p>
    <h3>Следующие действия</h3><ul>{match.nextActions.map((action) => <li key={action}>{action}</li>)}</ul>
    <ActionButton className="secondary" onClick={onAsk}>Объяснить с помощью AI</ActionButton>
  </section>;
}
export function ProjectOnboarding({ initial, onSave, onCancel }: { initial: ProjectProfile | null; onSave: (project: ProjectProfile) => void; onCancel: () => void }) {
  const [form, setForm] = React.useState<ProjectProfile>(initial ?? { name: '', region: '', industry: '', stage: 'idea', teamSize: null, fundingNeed: null, fundingPurpose: '', hasLegalEntity: false });
  function submit(e: FormEvent) { e.preventDefault(); onSave({ ...form, name: form.name.trim(), region: form.region.trim(), industry: form.industry.trim() }); }
  return <ModalSheet title="Проект без компании" onClose={onCancel}>
    <h2>У меня пока нет компании</h2><p>Рассмотрим только программы, допускающие проект или физическое лицо. Соответствие остальным условиям проверяется отдельно.</p>
    <form onSubmit={submit}><div className="form-grid">
      {(['name', 'region', 'industry'] as const).map((key) => <label className="field" key={key}>{{ name: 'Название проекта', region: 'Регион', industry: 'Отрасль / направление' }[key]}<BusinessInput required maxLength={120} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>)}
      <label className="field">Стадия<select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as ProjectProfile['stage'] })}><option value="idea">Идея</option><option value="prototype">Прототип</option><option value="mvp">MVP</option><option value="revenue">Есть выручка проекта</option></select></label>
      <label className="field">Команда, человек<BusinessInput type="number" min="1" max="10000" step="1" value={form.teamSize ?? ''} onChange={(e) => setForm({ ...form, teamSize: e.target.value ? Number(e.target.value) : null })} /></label>
      <label className="field">Цель<select value={form.fundingPurpose} onChange={(e) => setForm({ ...form, fundingPurpose: e.target.value })}><option value="">Укажу позже</option>{fundingPurposes.map((p) => <option key={p}>{p}</option>)}</select></label>
      <label className="field">Сумма финансирования, ₽<BusinessInput type="number" min="1" step="1" value={form.fundingNeed ?? ''} onChange={(e) => setForm({ ...form, fundingNeed: e.target.value ? Number(e.target.value) : null })} /></label>
    </div><div className="modal-actions"><ActionButton type="button" className="secondary" onClick={onCancel}>Отмена</ActionButton><ActionButton className="primary" type="submit">Сохранить проект</ActionButton></div></form>
  </ModalSheet>;
}
