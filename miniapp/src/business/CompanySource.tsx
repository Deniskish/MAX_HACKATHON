import type { Profile, ProfileValues } from './domain';
import { ContextHelp } from './ContextHelp';

export function FieldSource({ profile, field }: { profile: Profile; field: keyof ProfileValues }) {
  const origin = profile.provenance?.[field];
  if (!origin || origin.kind === 'manual') return null;
  return <small className="company-field-source">
    {origin.mode === 'demo' ? 'Демо · ' : ''}
    {origin.kind === 'derived' ? 'Рассчитано · ' : ''}
    {origin.source}
  </small>;
}

export function CompanySources({ profile }: { profile: Profile }) {
  const sources = Object.values(profile.provenance ?? {}).filter((origin) => origin.kind !== 'manual');
  const unique = [...new Map(sources.map((source) => [source.sourceId, source])).values()];
  if (!unique.length) return null;
  return <ContextHelp title="Откуда данные компании">
    {unique.map((source) => <p key={source.sourceId}>
      <strong>{source.mode === 'demo' ? 'ДЕМО · не данные ФНС. ' : source.mode === 'aggregator' ? 'Сервис данных. ' : 'Официальный источник. '}</strong>
      {source.source}
      {source.sourceUrl && /^https:\/\//.test(source.sourceUrl) && <>
        {' '}<a href={source.sourceUrl} target="_blank" rel="noreferrer">Источник</a>
      </>}
      {' '}Снимок: {source.updatedAt.slice(0, 10)}.
      {source.period ? ` Период: ${source.period}.` : ''}
    </p>)}
    <p>Неизвестные поля заполните вручную. Все значения можно редактировать.</p>
  </ContextHelp>;
}
