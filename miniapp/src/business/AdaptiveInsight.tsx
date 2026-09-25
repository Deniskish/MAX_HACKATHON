import { Icon } from './Icon';
import type { BusinessAnalysis } from './useBusinessAnalysis';
import type { workspaceActions, workspacePages } from '../../api-server/ai/types';
const labels = { programs: 'Посмотреть программы', funding: 'Уточнить потребность', applications: 'К подготовке заявок', profile: 'Уточнить профиль', assistant: 'Обсудить с AI', calendar: 'Посмотреть сроки' };
export function AdaptiveInsight({ analysis, section, onAction, compact = false }: {
  analysis: BusinessAnalysis; section: typeof workspacePages[number]; onAction: (action: typeof workspaceActions[number]) => void; compact?: boolean;
}) {
  if (analysis.status === 'guest') return null;
  const insight = analysis.data?.personalization?.sections[section];
  return <section className={`adaptive-insight${compact ? ' compact' : ''}`} aria-label="Анализ вашего бизнеса" aria-live="polite">
    {insight ? <><h2>{insight.title}</h2><button onClick={() => onAction(insight.action)}>{labels[insight.action]} <Icon name="arrow" size={15} /></button>
      <details><summary>Подробнее</summary><p>{insight.text}</p>{!compact && <><p>{analysis.data!.personalization!.summary}</p>{analysis.data?.citations.filter((c) => c.url?.startsWith('https://')).slice(0, 4).map((c) => <a key={c.id} href={c.url} target="_blank" rel="noreferrer">{c.title} ↗</a>)}</>}<button onClick={analysis.refresh}>Обновить анализ</button></details></>
      : <><h2>{analysis.status === 'loading' ? 'Анализируем ваш бизнес…' : 'AI-анализ пока недоступен'}</h2>{analysis.status === 'unavailable' && <button onClick={analysis.refresh}>Повторить анализ</button>}</>}
  </section>;
}
