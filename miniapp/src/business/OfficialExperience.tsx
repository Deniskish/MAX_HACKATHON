import React, { type FormEvent } from 'react';
import type { FundingMatch, ProjectProfile } from '../../api-server/funding-catalog/types';
import { fundingPurposes } from '../../api-server/funding-catalog/types';
import { amountLabel, rateLabel, termLabel, fundingStatusLabels } from '../../api-server/funding-catalog/presentation';
import { ActionButton, BusinessInput } from './MaxControls';
import { ModalSheet } from './ModalSheet';

export const opportunityStateLabels = { active: 'Приём открыт', closed: 'Приём завершён', upcoming: 'Ожидается открытие', unknown: 'Доступность требует проверки' };
export function OfficialDetails({ match, onAsk, personalized = true }: { match: FundingMatch; onAsk: () => void; personalized?: boolean }) {
  const o = match.opportunity;
  return <section className="official-details">
    <p>{o.providerName}</p>
    <div className="detail-facts"><strong>{amountLabel(o)}</strong>{rateLabel(o) && <span>{rateLabel(o)}</span>}{termLabel(o) && <span>{termLabel(o)}</span>}</div>
    <p>{opportunityStateLabels[o.status ?? 'unknown']}{o.deadline ? ` · до ${o.deadline}` : ''}</p>
    <a className="official-link" href={o.source.url!} target="_blank" rel="noreferrer">Открыть официальный источник ↗</a>
    <p className="widget-footnote">{o.source.name}{o.source.verifiedAt ? ` · ${o.source.verifiedAt}` : ''}</p>
    {personalized ? <><h3>{fundingStatusLabels[match.status]}</h3>
    <div className="detail-checks">
      {([['Почему подходит', match.fulfilledRequirements], ['Что нужно уточнить', match.unknownRequirements], ['Что не соответствует', match.missingRequirements]] as const).filter(([, checks]) => checks.length).map(([title, checks]) => <section key={title}><h3>{title}</h3><ul>{checks.map((c, i) => <li key={i}>{c.label}</li>)}</ul></section>)}
    </div>
    <h3>Следующие действия</h3><ul>{match.nextActions.map((action) => <li key={action}>{action}</li>)}</ul>
    <ActionButton className="secondary" onClick={onAsk}>Объяснить с AI</ActionButton></> : <p className="data-note">Это общие условия. Добавьте бизнес для проверки соответствия.</p>}
  </section>;
}
export function ProjectOnboarding({ initial, onSave, onCancel }: { initial: ProjectProfile | null; onSave: (project: ProjectProfile) => void; onCancel: () => void }) {
  const [form, setForm] = React.useState<ProjectProfile>(initial ?? { name: '', region: '', industry: '', stage: 'idea', teamSize: null, fundingNeed: null, fundingPurpose: '', hasLegalEntity: false });
  const [error, setError] = React.useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.region.trim() || !form.industry.trim()) {
      setError('Укажите название проекта, регион и направление. Поля не могут состоять из пробелов.');
      return;
    }
    onSave({ ...form, name: form.name.trim(), region: form.region.trim(), industry: form.industry.trim() });
  }
  return <ModalSheet title="Проект без компании" onClose={onCancel}>
    <h2>Расскажите о проекте</h2>
    <form onSubmit={submit}><div className="form-grid">
      {(['name', 'region', 'industry'] as const).map((key) => <label className="field" key={key}>{{ name: 'Название проекта', region: 'Регион', industry: 'Отрасль / направление' }[key]}<BusinessInput required maxLength={120} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>)}
      <label className="field">Стадия<select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as ProjectProfile['stage'] })}><option value="idea">Идея</option><option value="prototype">Прототип</option><option value="mvp">MVP</option><option value="revenue">Есть выручка проекта</option></select></label>
      <label className="field">Команда, человек<BusinessInput type="number" min="1" max="10000" step="1" value={form.teamSize ?? ''} onChange={(e) => setForm({ ...form, teamSize: e.target.value ? Number(e.target.value) : null })} /></label>
      <label className="field">Цель<select value={form.fundingPurpose} onChange={(e) => setForm({ ...form, fundingPurpose: e.target.value })}><option value="">Укажу позже</option>{fundingPurposes.map((p) => <option key={p}>{p}</option>)}</select></label>
      <label className="field">Сумма финансирования, ₽<BusinessInput type="number" min="1" step="1" value={form.fundingNeed ?? ''} onChange={(e) => setForm({ ...form, fundingNeed: e.target.value ? Number(e.target.value) : null })} /></label>
    </div>{error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><ActionButton type="button" className="secondary" onClick={onCancel}>Отмена</ActionButton><ActionButton className="primary" type="submit">Сохранить проект</ActionButton></div></form>
  </ModalSheet>;
}
