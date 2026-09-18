// Персональный сценарий: анализ, подходящие программы, документы и следующий шаг.
import type { useBusinessAnalysis } from './useBusinessAnalysis';
import { useState } from 'react';
import { ActionButton, BusinessTextarea } from './MaxControls';
import { Icon } from './Icon';
import { Orb } from './VisualWidgets';
import {
  type Profile,
  type Program,
  type Application,
  type DraftKind,
  type CatalogSnapshot,
  programs,
  shortlist,
  analyzeOpportunity,
  benefitSummary,
  rubles,
  documentGuide,
  inspectDocumentText,
  generateDraft,
  draftKinds,
  monitorChanges,
  emptyProfile,
} from './domain';

type Open = (program: Program) => void;
// Главная показывает несколько приоритетных возможностей вместо полного каталога.
export function AgentDashboard({
  analysis,
  profile,
  apps,
  onOpen,
  onProfile,
  onDemo,
  onBrowse,
  onAsk,
}: {
  analysis: ReturnType<typeof useBusinessAnalysis>;
  profile: Profile | null;
  apps: Application[];
  onOpen: Open;
  onProfile: () => void;
  onDemo: () => void;
  onBrowse: () => void;
  onAsk: () => void;
}) {
  const recommendations = profile ? shortlist(profile, apps) : [];
  const benefits = benefitSummary(recommendations);
  const actionable = recommendations.filter((x) => x.r.status === 'Почти подходит');
  const nearest = recommendations.length
    ? Math.min(...recommendations.map((x) => x.r.daysLeft))
    : null;
  if (!profile)
    return (
      <div className="agent-dashboard">
        <section className="widget agent-welcome">
          <Orb />
          <h2>AI-агент вашего бизнеса</h2>
          <ActionButton className="primary" onClick={onProfile}>
            Начать с ИНН <Icon name="arrow" />
          </ActionButton>
          <button className="demo-link" onClick={onDemo}>
            Открыть учебный профиль
          </button>
        </section>
      </div>
    );
  return (
    <div className="agent-dashboard">
      <section className="widget ai-business-panel" aria-busy={analysis.loading}>
        <div className="ai-panel-heading">
          <Orb />
          <h2>AI-анализ бизнеса</h2>
          {!analysis.loading && analysis.result && (
            <span className="ai-mode">
              {analysis.result.mode === 'llm'
                ? 'GigaChat'
                : 'Подбор по правилам · GigaChat недоступен'}
            </span>
          )}
        </div>
        {analysis.stale ? (
          <p className="ai-analysis-answer" role="status">
            Данные заявки изменились. Обновите анализ.
          </p>
        ) : (
          analysis.result && (
            <div className="ai-analysis-answer" aria-live="polite">
              {analysis.result.text}
            </div>
          )
        )}

        <div className="ai-panel-actions">
          <ActionButton className="primary" disabled={analysis.loading} onClick={analysis.refresh}>
            <Icon name="spark" size={18} />
            {analysis.loading ? 'Анализирую бизнес' : 'Обновить AI-анализ'}
          </ActionButton>
          <ActionButton className="secondary" onClick={onAsk}>
            <Icon name="chat" size={18} />
            Задать вопрос
          </ActionButton>
        </div>
      </section>
      <section className="widget company-summary">
        <span className="soft-round">
          <Icon name="building" />
        </span>
        <div>
          <h2>{profile.name}</h2>
          <p>
            {profile.region || 'Регион не указан'} · ОКВЭД {profile.okved || 'не указан'} ·{' '}
            {profile.employees ?? '—'} сотрудников
          </p>
        </div>
        <button className="widget-chevron" onClick={onProfile} aria-label="Уточнить профиль">
          <Icon name="chevron" />
        </button>
      </section>
      <section className="agent-metrics">
        <div>
          <span>Приоритетные возможности</span>
          <strong>{recommendations.length}</strong>
          <small>
            {recommendations.filter((x) => x.r.status === 'Подходит').length} готовы по вашим
            отметкам
          </small>
        </div>
        <div>
          <span>Требуют подготовки</span>
          <strong>{actionable.length}</strong>
          <small>
            {nearest === null ? 'Уточните профиль' : `Ближайший срок — через ${nearest} дн.`}
          </small>
        </div>
      </section>
      {!!benefits.length && (
        <section className="widget benefit-widget">
          <h2>Что может получить бизнес</h2>
          <div className="benefit-options">
            {benefits.map((b) => (
              <div key={b.kind}>
                <span>{b.label}</span>
                <strong>{b.max !== null ? `до ${rubles(b.max)}` : 'Без денежной оценки'}</strong>
                <small>{b.count} вариантов</small>
              </div>
            ))}
          </div>
          <details className="context-info">
            <summary>Как рассчитаны суммы</summary>
            <p>
              Показан наибольший отдельный лимит каждого вида. Суммы не складываются: программы
              могут быть несовместимы. Условия учебные.
            </p>
          </details>
        </section>
      )}
      <section>
        <div className="section-title">
          <div>
            <h2>Подобрано для вас</h2>
          </div>
          <button className="widget-chevron" onClick={onBrowse} aria-label="Открыть полный каталог">
            <Icon name="chevron" />
          </button>
        </div>
        <div className="priority-grid">
          {recommendations.map(({ p, r }, index) => (
            <article className="widget priority-card" key={p.id}>
              <div className="priority-top">
                <span className={'program-icon ' + p.id}>
                  <Icon name={p.icon} />
                </span>
                <span>
                  {p.type}
                  <small>ПРИОРИТЕТ {index + 1}</small>
                </span>
                <span className="score-disc" aria-label={`${r.score}% пунктов выполнено`}>
                  {r.score}
                  <small>%</small>
                </span>
              </div>
              <span
                className={
                  'eligibility-status status-' +
                  (r.status === 'Подходит'
                    ? 'ready'
                    : r.status === 'Не хватает данных'
                      ? 'unknown'
                      : 'almost')
                }
              >
                {r.status}
              </span>
              <h3>{p.title}</h3>
              <strong className="priority-amount">{r.benefit.label}</strong>
              <p>
                {r.confirmed} из {r.total} пунктов выполнено по вашим данным
              </p>
              <div className="priority-facts">
                <span>
                  <Icon name="calendar" size={15} />
                  {r.daysLeft} дн. до срока
                </span>
                <span>Сложность: {p.difficulty.toLowerCase()}</span>
              </div>
              <div className="next-action">
                <Icon name="file" size={19} />
                <span>
                  {r.unknown.length
                    ? `Уточните: ${r.unknown[0].label}`
                    : r.missingDocuments.length
                      ? `Следующий шаг: ${r.missingDocuments[0]}`
                      : 'Проверьте комплект и официальную форму'}
                </span>
              </div>
              <ActionButton className="primary" onClick={() => onOpen(p)}>
                Условия и план <Icon name="arrow" size={17} />
              </ActionButton>
            </article>
          ))}
        </div>
        {!recommendations.length && (
          <div className="empty-state">
            <Icon name="compass" size={36} />
            <h3>Не хватает подходящих вариантов</h3>
            <ActionButton className="primary" onClick={onProfile}>
              Уточнить профиль
            </ActionButton>
          </div>
        )}
      </section>
      <MonitoringWidget profile={profile} onOpen={onOpen} />
    </div>
  );
}

// Показываем причины результата и действия, которые пользователь может выполнить.
export function EligibilityDetail({
  program,
  profile,
  app,
  onAsk,
  onProfile,
}: {
  program: Program;
  profile: Profile | null;
  app?: Application;
  onAsk: (task: 'strategy' | 'documents') => void;
  onProfile: () => void;
}) {
  const r = analyzeOpportunity(program, profile || emptyProfile, app);
  return (
    <section className="eligibility-detail">
      <div className="widget assessment-head">
        <span className="score-disc large">
          {r.score}
          <small>%</small>
        </span>
        <div>
          <h3>{r.status}</h3>
          <p>
            {r.confirmed} из {r.total} пунктов выполнено
          </p>
        </div>
      </div>
      <details className="context-info">
        <summary>Как рассчитано соответствие</summary>
        <p>
          Профиль: {r.fulfilled.length}/{r.checks.length}. Документы: {r.preparedDocuments.length}/
          {program.documents.length}. Пункты имеют равный вес. Процент не означает вероятность
          одобрения; отметка документа не подтверждает его достоверность.
        </p>
      </details>
      <div className="detail-facts">
        <div>
          <span>Потенциальная поддержка</span>
          <strong>{r.benefit.label}</strong>
          <small>{r.benefit.explanation}</small>
        </div>
        <div>
          <span>Сложность подачи</span>
          <strong>{program.difficulty}</strong>
          <small>Ориентир: {program.preparationDays} дн. подготовки</small>
        </div>
        <div>
          <span>Дедлайн</span>
          <strong>{program.deadline}</strong>
          <small>{r.expired ? 'Приём завершён' : `${r.daysLeft} дн. до конца`}</small>
        </div>
      </div>
      {[
        { title: 'Что уже выполнено', items: r.fulfilled, tone: 'pass' },
        { title: 'Что препятствует участию', items: r.unmet, tone: 'fail' },
        { title: 'Каких данных не хватает', items: r.unknown, tone: 'unknown' },
      ]
        .filter((g) => g.items.length)
        .map((g) => (
          <div className="criteria-group" key={g.title}>
            <h3>{g.title}</h3>
            <div className="requirements">
              {g.items.map((c, i) => (
                <div className={'requirement ' + g.tone} key={i}>
                  <span>{g.tone === 'pass' ? '✓' : g.tone === 'fail' ? '!' : '?'}</span>
                  <div>
                    <b>{c.label}</b>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      {!!r.unknown.length && (
        <ActionButton className="secondary" onClick={onProfile}>
          Уточнить данные бизнеса
        </ActionButton>
      )}
      <section className="widget action-plan">
        <div className="widget-heading">
          <h2>План подготовки</h2>
          <Icon name="compass" />
        </div>
        <ol>
          {r.plan.map((s, i) => (
            <li className={s.kind} key={s.title}>
              <span>{i + 1}</span>
              <div>
                <b>{s.title}</b>
                <p>{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <ActionButton className="secondary" onClick={() => onAsk('strategy')}>
          <Icon name="chat" size={18} />
          Обсудить эту программу
        </ActionButton>
      </section>
      <div className="source-note">
        {program.source} Версия {program.version}, обновлена {program.updatedAt}.
      </div>
    </section>
  );
}

// Выбор файла и отметка готовности независимы; содержимое не загружаем на сервер.
export function DocumentChecklist({
  program,
  app,
  onUpdate,
}: {
  program: Program;
  app: Application;
  onUpdate: (patch: Partial<Application>) => void;
}) {
  const [reviews, setReviews] = useState<Record<string, ReturnType<typeof inspectDocumentText>>>(
    {},
  );
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function fileSelected(name: string, file: File) {
    if (file.size > 2 * 1024 * 1024) {
      setErrors((old) => ({ ...old, [name]: 'Для локальной проверки выберите файл до 2 МБ.' }));
      return;
    }
    onUpdate({ documentFiles: { ...app.documentFiles, [name]: file.name } });
    setErrors((old) => ({ ...old, [name]: '' }));
    setReviews((old) => {
      const copy = { ...old };
      delete copy[name];
      return copy;
    });
    if (file.name.toLowerCase().endsWith('.txt'))
      try {
        const text = await file.text();
        setReviews((old) => ({ ...old, [name]: inspectDocumentText(name, text) }));
      } catch {
        setErrors((old) => ({
          ...old,
          [name]: 'Не удалось прочитать текст. Скопируйте нужные разделы в поле ниже.',
        }));
      }
    else
      setErrors((old) => ({
        ...old,
        [name]:
          'Название сохранено. PDF, DOCX и изображения здесь не распознаются; вставьте текст ниже для локальной проверки.',
      }));
  }
  return (
    <div className="personal-checklist">
      {program.documents.map((name) => {
        const guide = documentGuide(name);
        return (
          <section className="widget checklist-item" key={name}>
            <label className="checklist-title">
              <input
                type="checkbox"
                checked={!!app.documents[name]}
                onChange={(e) =>
                  onUpdate({
                    documents: {
                      ...app.documents,
                      [name]: e.target.checked ? 'Готовность отмечена пользователем' : '',
                    },
                  })
                }
              />
              <span>
                <b>{name}</b>
                <small>
                  {app.documents[name] ? 'Готовность отмечена вами' : 'Нужно подготовить'}
                  {app.documentFiles?.[name] ? ` · ${app.documentFiles[name]}` : ''}
                </small>
              </span>
            </label>
            <details>
              <summary>Зачем нужен и как подготовить</summary>
              <dl>
                <dt>Зачем</dt>
                <dd>{guide.why}</dd>
                <dt>Где получить</dt>
                <dd>{guide.where}</dd>
                <dt>Что должно быть внутри</dt>
                <dd>{guide.contents}</dd>
              </dl>
              <label className="attach">
                Выбрать документ
                <input
                  type="file"
                  accept=".txt,.pdf,.docx,.png,.jpg,.jpeg"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void fileSelected(name, f);
                  }}
                />
              </label>
              <p className="widget-footnote">
                Файл не отправляется на сервер. TXT проверяется локально; содержимое не сохраняется.
                Готовность отметьте отдельно после проверки.
              </p>
              <label className="field">
                Текст для предварительной проверки
                <BusinessTextarea
                  rows={3}
                  maxLength={100000}
                  value={texts[name] || ''}
                  onChange={(e) => {
                    setTexts((old) => ({ ...old, [name]: e.target.value }));
                    setReviews((old) => {
                      const next = { ...old };
                      delete next[name];
                      return next;
                    });
                  }}
                  placeholder="Вставьте текст документа; он останется в этой вкладке"
                />
              </label>
              <ActionButton
                className="secondary"
                disabled={!texts[name]?.trim()}
                onClick={() =>
                  setReviews((old) => ({ ...old, [name]: inspectDocumentText(name, texts[name]) }))
                }
              >
                Проверить разделы локально
              </ActionButton>
              {errors[name] && (
                <p className="widget-footnote" role="status">
                  {errors[name]}
                </p>
              )}
              {reviews[name] && (
                <div className="document-review" role="status">
                  <b>{reviews[name].status}</b>
                  {reviews[name].tooShort && (
                    <p>Текста слишком мало для содержательной проверки.</p>
                  )}
                  {!!reviews[name].missing.length && (
                    <p>Не найдены упоминания: {reviews[name].missing.join(', ')}.</p>
                  )}
                  <small>{reviews[name].notice}</small>
                </div>
              )}
            </details>
          </section>
        );
      })}
    </div>
  );
}

// Результат модели и локальный шаблон помечаем по-разному; оба можно редактировать.
export function DraftComposer({
  program,
  profile,
  app,
  onUpdate,
  onDownload,
}: {
  program: Program;
  profile: Profile;
  app: Application;
  onUpdate: (patch: Partial<Application>) => void;
  onDownload: (text: string) => void;
}) {
  const [kind, setKind] = useState<DraftKind>('project');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  async function create() {
    setBusy(true);
    setNotice('');
    let text = generateDraft(kind, program, profile, app),
      origin = 'Локальный автоматический шаблон';
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'draft',
          draftKind: kind,
          question: 'Подготовь черновик по выбранной программе',
          context: {
            profile,
            programId: program.id,
            application: {
              preparedDocuments: program.documents.filter((d) => app.documents[d]),
              budget: app.budget.trim() ? Number(app.budget) : null,
            },
          },
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (data.mode !== 'llm' || typeof data.answer !== 'string' || !data.answer.trim())
        throw new Error('invalid');
      text =
        'АВТОМАТИЧЕСКИЙ ЧЕРНОВИК GIGACHAT — ПРОВЕРЬТЕ И ОТРЕДАКТИРУЙТЕ\n\n' +
        data.answer +
        '\n\nУчебная программа. Проверьте факты, заполните пропуски и сверяйте текст с формой оператора. Заявка не отправлена.';
      origin = 'GigaChat · обезличенные параметры';
    } catch {
      setNotice('GigaChat недоступен. Подготовлен локальный шаблон с вашими данными.');
    }
    onUpdate({ generatedDraft: text, draftOrigin: origin });
    setBusy(false);
  }
  return (
    <section className="widget draft-composer">
      <div className="widget-heading">
        <h2>Подготовим документ</h2>
        <Icon name="spark" />
      </div>
      {!app.generatedDraft && (
        <>
          <label className="field">
            Тип документа
            <select value={kind} onChange={(e) => setKind(e.target.value as DraftKind)}>
              {Object.entries(draftKinds).map(([id, label]) => (
                <option value={id} key={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <ActionButton className="primary" disabled={busy} onClick={() => void create()}>
            {busy ? 'Готовим черновик…' : 'Сформировать черновик'}
            <Icon name="spark" size={17} />
          </ActionButton>
        </>
      )}
      {notice && (
        <p role="status" className="widget-footnote">
          {notice}
        </p>
      )}
      {app.generatedDraft !== undefined && (
        <>
          <span className="tag">{app.draftOrigin || 'Черновик пользователя'}</span>
          <label className="field">
            Редактор документа
            <BusinessTextarea
              rows={14}
              maxLength={30000}
              value={app.generatedDraft}
              onChange={(e) => onUpdate({ generatedDraft: e.target.value })}
            />
          </label>
          <ActionButton
            className="secondary"
            disabled={!app.generatedDraft.trim()}
            onClick={() => onDownload(app.generatedDraft!)}
          >
            <Icon name="download" size={18} />
            Скачать этот документ
          </ActionButton>
        </>
      )}
      <p className="widget-footnote">
        Черновик сохраняется в этом браузере. Модель получает только разрешённые параметры и учебные
        условия; ваш исходный текст проекта ей не отправляется.
      </p>
    </section>
  );
}

// Это проверка по кнопке и предпросмотр, а не фоновая отправка сообщений.
function MonitoringWidget({ profile, onOpen }: { profile: Profile; onOpen: Open }) {
  const [notifications, setNotifications] = useState<ReturnType<typeof monitorChanges>['events']>(
    [],
  );
  const [status, setStatus] = useState('');
  function check(demo = false) {
    const key = `opora.monitor.v1.${profile.inn}`;
    let previous: CatalogSnapshot = {};
    try {
      const stored = JSON.parse(localStorage.getItem(key) || 'null');
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) previous = stored;
    } catch {
      /* A corrupt cache behaves as a first observation. */
    }
    if (demo) {
      previous = Object.fromEntries(programs.map((p) => [p.id, `${p.version}:${p.deadline}`]));
      const candidates = shortlist(profile);
      const first = candidates.find((x) => x.p.id === 'equipment') || candidates[0];
      if (first) delete previous[first.p.id];
    }
    const result = monitorChanges(profile, previous);
    if (!demo)
      try {
        localStorage.setItem(key, JSON.stringify(result.snapshot));
      } catch {
        setStatus('Не удалось сохранить историю проверки в браузере.');
        return;
      }
    const seenKey = key + '.seen';
    let seen: string[] = [];
    try {
      const value = JSON.parse(localStorage.getItem(seenKey) || '[]');
      if (Array.isArray(value)) seen = value.filter((x) => typeof x === 'string');
    } catch {
      /* empty history */
    }
    const events = result.events.filter((e) => demo || !seen.includes(e.key));
    if (events.length && !demo)
      try {
        localStorage.setItem(
          seenKey,
          JSON.stringify([...seen, ...events.map((e) => e.key)].slice(-100)),
        );
      } catch {
        /* presentation remains available */
      }
    setNotifications(events);
    setStatus(
      events.length
        ? demo
          ? 'Демонстрация нового совпадения'
          : `Найдено изменений: ${events.length}`
        : 'Новых подходящих изменений нет.',
    );
  }
  return (
    <section className="widget monitoring-widget">
      <div className="widget-heading">
        <h2>Поддержка находит вас</h2>
        <Icon name="bell" />
      </div>
      <div className="monitor-actions">
        <ActionButton className="secondary" onClick={() => check()}>
          Проверить обновления
        </ActionButton>
        <button className="demo-link" onClick={() => check(true)}>
          Показать демоуведомление
        </button>
      </div>
      {status && (
        <p role="status" className="widget-footnote">
          {status}
        </p>
      )}
      {notifications.map((notification) => (
        <article className="notification-preview" key={notification.key}>
          <span className="max-notification-label">MAX · ПРЕДПРОСМОТР</span>
          <h3>{notification.title}</h3>
          <p>{notification.text}</p>
          <ActionButton
            className="primary"
            onClick={() => {
              const p = programs.find((p) => p.id === notification.programId);
              if (p) onOpen(p);
            }}
          >
            Посмотреть условия
          </ActionButton>
        </article>
      ))}
      <details className="context-info">
        <summary>Об уведомлениях</summary>
        <p>
          Проверка запускается кнопкой. Предпросмотр не отправляет сообщение в MAX; в подключённом
          боте доступна команда /demo. Фоновый мониторинг пока не подключён.
        </p>
      </details>
    </section>
  );
}
