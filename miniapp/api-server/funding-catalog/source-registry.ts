export type FundingSource = { id: string; name: string; seeds: string[]; hosts: string[]; paths: string[];
  region?: string; aliases?: string[]; providerType: 'development_institution' | 'fund' | 'regional' };
// Curated official operators only. Adding a region requires verifying its operator
// and public programme pages; a user-supplied URL never enters this registry.
export const fundingSources: FundingSource[] = [
  { id: 'corpmsp', name: 'Корпорация МСП', seeds: ['https://corpmsp.ru/to-business/'], hosts: ['corpmsp.ru', 'www.corpmsp.ru'], paths: ['/to-business/'], providerType: 'development_institution' },
  { id: 'frp', name: 'Фонд развития промышленности', seeds: ['https://frprf.ru/zaymy/'], hosts: ['frprf.ru', 'www.frprf.ru'], paths: ['/zaymy/'], providerType: 'fund' },
  { id: 'fasie', name: 'Фонд содействия инновациям', seeds: ['https://fasie.ru/programs/'], hosts: ['fasie.ru', 'www.fasie.ru'], paths: ['/programs/'], providerType: 'fund' },
  { id: 'chuvashia', name: 'Мой бизнес · Чувашская Республика', seeds: ['https://mb21.ru/'], hosts: ['www.mb21.ru', 'mb21.ru'], paths: ['/services/', '/support/', '/uslugi/'], region: 'Чувашская Республика', aliases: ['Чувашия', 'Чувашская Республика - Чувашия', 'Чувашская'], providerType: 'regional' },
  { id: 'tatarstan', name: 'Фонд поддержки предпринимательства Республики Татарстан', seeds: ['https://fpprt.ru/'], hosts: ['fpprt.ru', 'www.fpprt.ru'], paths: ['/'], region: 'Республика Татарстан', aliases: ['Татарстан'], providerType: 'regional' },
  { id: 'moscow', name: 'Малый бизнес Москвы', seeds: ['https://mbm.mos.ru/'], hosts: ['mbm.mos.ru'], paths: ['/measures/', '/support/', '/subsidies/', '/money/'], region: 'Москва', aliases: ['г. Москва', 'город Москва'], providerType: 'regional' },
];
export const normalizeRegion = (value: string) => {
  const clean = value.toLowerCase().replace(/ё/g, 'е').replace(/^(?:г\.|город)\s*/g, '').replace(/[^а-яa-z0-9]/g, '');
  if (['чувашия','чувашская','чувашскаяреспублика','чувашскаяреспубликачувашия'].includes(clean)) return 'чувашия';
  if (['татарстан','республикататарстан'].includes(clean)) return 'татарстан';
  return clean;
};
export function sourceForRegion(region: string, sources = fundingSources) {
  return sources.filter(s => s.region && [s.region, ...(s.aliases ?? [])].some(v => normalizeRegion(v) === normalizeRegion(region)));
}
export function sourceUrl(raw: string, source: FundingSource): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !source.hosts.includes(u.hostname)) return null;
    u.hash = ''; u.search = ''; u.hostname = u.hostname.replace(/^www\./, '');
    if (/\.(pdf|docx?|xlsx?|zip|png|jpe?g|svg|xml)$/i.test(u.pathname)) return null;
    if (!source.seeds.some(s => new URL(s).pathname === u.pathname) && !source.paths.some(p => u.pathname.startsWith(p))) return null;
    return u.href;
  } catch { return null; }
}
