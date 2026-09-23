import type { Profile, ProfileValues } from './domain';

export function FieldSource({ profile, field }: { profile: Profile; field: keyof ProfileValues }) {
  const origin = profile.provenance?.[field];
  if (!origin) return null;
  return <small className="company-field-source">
    {origin.kind === 'manual' ? 'Ручной ввод' : <>
      {origin.mode === 'demo' ? 'Демо · ' : ''}
      {origin.kind === 'derived' ? 'Рассчитано по данным: ' : 'Из источника: '}
      {origin.source} · {origin.updatedAt.slice(0, 10)}{origin.period ? ` · период ${origin.period}` : ''}
    </>}
  </small>;
}

export function CompanySources({ profile }: { profile: Profile }) {
  const sources = Object.values(profile.provenance ?? {}).filter((origin) => origin.kind !== 'manual');
  const unique = [...new Map(sources.map((source) => [source.sourceId, source])).values()];
  if (!unique.length) return null;
  return <div className="company-sources" role="status">
    {unique.map((source) => <p key={source.sourceId}>
      <strong>{source.mode === 'demo' ? 'ДЕМО · не данные ФНС. ' : 'Официальный источник. '}</strong>
      {source.source}
      {source.sourceUrl && /^https:\/\//.test(source.sourceUrl) && <>
        {' '}<a href={source.sourceUrl} target="_blank" rel="noreferrer">Источник</a>
      </>}
      {' '}Снимок: {source.updatedAt.slice(0, 10)}.
    </p>)}
    <p>Неизвестные поля заполните вручную. Все значения можно редактировать.</p>
  </div>;
}
