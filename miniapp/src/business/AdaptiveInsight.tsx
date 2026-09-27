import { Icon } from './Icon';
import type { BusinessAnalysis } from './useBusinessAnalysis';
import type { workspaceActions, workspacePages } from '../../api-server/ai/types';
const labels = { programs: 'Посмотреть программы', funding: 'Уточнить задачу', applications: 'К подготовке заявок', profile: 'Уточнить профиль', assistant: 'Обсудить с AI', calendar: 'Посмотреть сроки' };
export function AdaptiveInsight({ analysis, section, onAction, compact = false }: {
  analysis: BusinessAnalysis; section: typeof workspacePages[number]; onAction: (action: typeof workspaceActions[number]) => void; compact?: boolean;
}) {
  if (analysis.status === 'guest') return null;
  const insight = analysis.data?.personalization?.sections[section];
  return <section className={`adaptive-insight${compact ? ' compact' : ''}`} aria-label="Анализ вашего бизнеса" aria-live="polite">
    {insight ? <><h2>{insight.title}</h2>{!(section === 'applications' && insight.action === 'applications') && <button onClick={() => onAction(insight.action)}>{labels[insight.action]} <Icon name="arrow" size={15} /></button>}
      <button onClick={analysis.refresh} disabled={analysis.refreshing}>{analysis.refreshing ? 'Обновляем анализ…' : 'Обновить анализ'}</button></>
      : <><h2>{analysis.status === 'loading' ? 'Анализируем ваш бизнес…' : 'Анализ бизнеса'}</h2>{analysis.status === 'unavailable' && <button onClick={analysis.refresh}>Повторить анализ</button>}</>}
  </section>;
}
