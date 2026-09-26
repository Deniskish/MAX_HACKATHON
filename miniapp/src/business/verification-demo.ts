// Isolated simulator. None of these values are authentication or authority for the API.
export type DemoReceipt = { id: string; applicationId: string; inn: string; title: string; createdAt: string; mode: 'demo' };
export type VerificationDemo = { enabled: boolean; signedIn: boolean; inn: string | null; role: 'director' | 'representative' | null; failSubmission: boolean; receipts: DemoReceipt[] };
export const demoKey = 'opora.esia-demo.v1';
export const emptyDemo: VerificationDemo = { enabled: false, signedIn: false, inn: null, role: null, failSubmission: false, receipts: [] };
export function readDemo(storage: Pick<Storage, 'getItem'>): VerificationDemo {
  try {
    const state = JSON.parse(storage.getItem(demoKey) || 'null');
    if (!state || state.enabled !== true) return { ...emptyDemo, receipts: [] };
    return { enabled: true, signedIn: state.signedIn === true, inn: typeof state.inn === 'string' ? state.inn : null,
      role: ['director', 'representative'].includes(state.role) ? state.role : null, failSubmission: state.failSubmission === true,
      receipts: Array.isArray(state.receipts) ? state.receipts.filter((r: any) => r?.mode === 'demo' && ['id', 'applicationId', 'inn', 'title', 'createdAt'].every(k => typeof r[k] === 'string')).slice(-50) : [] };
  } catch { return { ...emptyDemo, receipts: [] }; }
}
export function demoConfirmed(state: VerificationDemo, inn?: string) {
  return state.enabled && state.signedIn && !!inn && state.inn === inn && !!state.role;
}
export function demoSubmit(state: VerificationDemo, input: { applicationId: string; inn: string; title: string; ready: boolean }): VerificationDemo {
  if (!demoConfirmed(state, input.inn)) throw new Error('Сначала войдите и подтвердите компанию.');
  if (!input.ready) throw new Error('Подготовьте описание проекта, комплект документов и подтвердите проверку.');
  if (state.receipts.some(r => r.applicationId === input.applicationId && r.inn === input.inn)) return state;
  if (state.failSubmission) throw new Error('Не удалось отправить заявку. Черновик сохранён — можно повторить.');
  const receipt: DemoReceipt = { id: 'OP-' + crypto.randomUUID().slice(0, 8).toUpperCase(), applicationId: input.applicationId,
    inn: input.inn, title: input.title, createdAt: new Date().toISOString(), mode: 'demo' };
  return { ...state, receipts: [...state.receipts.slice(-49), receipt] };
}
