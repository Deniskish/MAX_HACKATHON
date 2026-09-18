// Передаём на свой API только нужный контекст, а при сбое честно используем правила.
import { type Profile, type Application, programs, shortlist } from './domain';

export function analysisContext(profile: Profile, apps: Application[]) {
  return {
    profile,
    applications: apps.flatMap((app) => {
      const program = programs.find((p) => p.id === app.programId);
      return program
        ? [
            {
              programId: program.id,
              preparedDocuments: program.documents.filter((d) => !!app.documents[d]),
              budget: app.budget.trim() ? Number(app.budget) : null,
            },
          ]
        : [];
    }),
  };
}
export type BusinessAnalysis = { mode: 'llm' | 'local'; text: string };
export async function requestBusinessAnalysis(
  profile: Profile,
  apps: Application[],
  signal: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<BusinessAnalysis> {
  try {
    const response = await transport('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'matching',
        question:
          'Проанализируй бизнес, объясни приоритетные меры поддержки и выбери следующий шаг.',
        context: analysisContext(profile, apps),
      }),
      signal,
    });
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    if (
      data.mode !== 'llm' ||
      typeof data.answer !== 'string' ||
      !data.answer.trim() ||
      data.answer.length > 24000
    )
      throw new Error('invalid');
    return { mode: 'llm', text: data.answer };
  } catch (error) {
    if (signal.aborted) throw error;
    const best = shortlist(profile, apps)[0];
    return {
      mode: 'local',
      text: best
        ? `Начните с программы «${best.p.title}». ${best.r.unknown.length ? `Для проверки нужно уточнить: ${best.r.unknown.map((c) => c.label).join('; ')}.` : best.r.missingDocuments.length ? `Следующий шаг — ${best.r.missingDocuments[0].toLowerCase()}.` : 'Комплект отмечен готовым. Проверьте его перед подачей.'}`
        : 'Сейчас нет подходящих кандидатов. Уточните параметры и цели бизнеса.',
    };
  }
}
