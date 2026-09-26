/** Local test profile for catalogue presentation only. Never a company, API role or credential. */
export type CatalogDemoState = { mode: 'demo'; profile: 'admin' } | null;
export const catalogDemoKey = 'opora.catalog-demo.v1';

export function isCatalogDemo(state: CatalogDemoState) {
  return state?.mode === 'demo' && state.profile === 'admin';
}

/** The URL is a one-time entry trigger. Subsequent renders/reloads use explicit session state. */
export function loadCatalogDemo(storage: Pick<Storage, 'getItem'>, search = ''): CatalogDemoState {
  if (new URLSearchParams(search).get('catalogDemo') === 'admin') return { mode: 'demo', profile: 'admin' };
  try {
    const state = JSON.parse(storage.getItem(catalogDemoKey) ?? 'null');
    return state?.mode === 'demo' && state.profile === 'admin' ? { mode: 'demo', profile: 'admin' } : null;
  } catch { return null; }
}

export function saveCatalogDemo(storage: Pick<Storage, 'setItem' | 'removeItem'>, state: CatalogDemoState) {
  if (isCatalogDemo(state)) storage.setItem(catalogDemoKey, JSON.stringify(state));
  else storage.removeItem(catalogDemoKey);
}
