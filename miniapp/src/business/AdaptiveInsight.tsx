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
      <details><summary>Подробнее</summary><p>{insight.text}</p>{!compact && <><p>{analysis.data!.personalization!.summary}</p>{analysis.data?.citations.filter((c) => c.url?.startsWith('https://')).slice(0, 4).map((c) => <a key={c.id} href={c.url} target="_blank" rel="noreferrer">{c.title} ↗</a>)}</>}{analysis.error && <p role="status">{analysis.error} Сохранён предыдущий анализ для этих же данных.</p>}<button onClick={analysis.refresh} disabled={analysis.refreshing}>{analysis.refreshing ? 'Обновляем анализ…' : 'Обновить анализ'}</button></details></>
      : <><h2>{analysis.status === 'loading' ? 'Анализируем ваш бизнес…' : 'Анализ не завершён'}</h2>{analysis.status === 'unavailable' && <>{analysis.error && <p role="status">{analysis.error}</p>}<button onClick={analysis.refresh}>Повторить анализ</button></>}</>}
  </section>;
}
