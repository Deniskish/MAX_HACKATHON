import type { Profile, ProfileValues } from './domain';


export function FieldSource({ profile, field }: { profile: Profile; field: keyof ProfileValues }) {
  const origin = profile.provenance?.[field];
  if (!origin || origin.kind === 'manual') return null;
  return <small className="company-field-source">
    {origin.mode === 'demo' ? 'Демо · ' : ''}
    {origin.kind === 'derived' ? 'Рассчитано · ' : ''}
    {origin.source}
  </small>;
}
