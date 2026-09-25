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
    <span className="adaptive-label"><Icon name="spark" size={13} />{analysis.status === 'ready' ? 'ПО АНАЛИЗУ ВАШЕГО БИЗНЕСА' : analysis.status === 'loading' ? 'AI АНАЛИЗИРУЕТ ВАШ БИЗНЕС' : 'AI-АНАЛИЗ НЕДОСТУПЕН'}</span>
    {insight ? <><h2>{insight.title}</h2><p>{insight.text}</p><button onClick={() => onAction(insight.action)}>{labels[insight.action]} <Icon name="arrow" size={15} /></button>
      {!compact && <details><summary>Основания анализа</summary><p>{analysis.data!.personalization!.summary}</p>{analysis.data?.citations.filter((c) => c.url?.startsWith('https://')).slice(0, 4).map((c) => <a key={c.id} href={c.url} target="_blank" rel="noreferrer">{c.title} ↗</a>)}<button onClick={analysis.refresh}>Обновить анализ</button></details>}</>
      : <><p>{analysis.status === 'loading' ? 'Учитываем деятельность, регион, цели и заявки. Можно продолжать пользоваться приложением.' : 'Пока показан подбор по правилам. Персональные выводы AI появятся после успешного анализа.'}</p>{analysis.status === 'unavailable' && <button onClick={analysis.refresh}>Повторить анализ</button>}</>}
  </section>;
}
