// Общее состояние экранов, профиля и заявок. Условия программ считаются в domain.
import { CompanySources, FieldSource } from './CompanySource';
import { editCompanyProfile, mergeCompanyProfile, requestCompanyData } from './company-data';
import { useBusinessAnalysis } from './useBusinessAnalysis';
import {
  AgentDashboard,
  EligibilityDetail,
  DocumentChecklist,
  DraftComposer,
} from './AgentExperience';
import { CategoryWidget, BusinessCard, DetailSteps, Orb, supportFilters } from './VisualWidgets';
import { Icon } from './Icon';
import { Spinner } from '@maxhub/max-ui';
import { ActionButton, BusinessInput, BusinessTextarea } from './MaxControls';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  type Profile,
  type ProfileValues,
  type Program,
  type Application,
  emptyProfile,
  demoProfile,
  goals,
  programs,
  analyzeOpportunity,
  validInn,
  draftText,
  localAnswer,
} from './domain';

type Page = 'overview' | 'programs' | 'applications' | 'calendar' | 'profile' | 'assistant';
type Message = { role: 'user' | 'assistant'; text: string };
const nav: { id: Page; label: string; icon: string }[] = [
  { id: 'overview', label: 'Главная', icon: 'home' },
  { id: 'programs', label: 'Меры поддержки', icon: 'compass' },
  { id: 'applications', label: 'Мои заявки', icon: 'file' },
  { id: 'calendar', label: 'Календарь', icon: 'calendar' },
  { id: 'profile', label: 'Профиль бизнеса', icon: 'building' },
];

const date = (s: string) =>
  new Date(s + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
// Повреждённый JSON не должен мешать открыть приложение.
function readSaved<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
// Временная ссылка существует только на время скачивания.
function download(text: string, name: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['\ufeff', text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BusinessApp() {
  const [page, setPage] = useState<Page>('overview');
  const [profile, setProfile] = useState<Profile | null>(() => {
    const p = readSaved<Profile | null>('opora.profile.v1', null);
    return p && typeof p.inn === 'string' && Array.isArray(p.goals)
      ? { ...emptyProfile, ...p }
      : null;
  });
  const [apps, setApps] = useState<Application[]>(() => {
    const a = readSaved<Application[]>('opora.apps.v1', []);
    return Array.isArray(a)
      ? a.filter((x) => programs.some((p) => p.id === x.programId) && x.documents)
      : [];
  });
  const [saved, setSaved] = useState<string[]>(() => {
    const ids = readSaved<unknown>('opora.saved.v1', []);
    return Array.isArray(ids)
      ? ids.filter(
          (id): id is string => typeof id === 'string' && programs.some((p) => p.id === id),
        )
      : [];
  });
  const analysis = useBusinessAnalysis(profile, apps);
  const [onlySaved, setOnlySaved] = useState(false);
  const [selected, setSelected] = useState<Program | null>(
    () =>
      programs.find((p) => p.id === new URLSearchParams(window.location.search).get('program')) ||
      null,
  );
  const [chatProgram, setChatProgram] = useState<Program | null>(null);
  const [onboard, setOnboard] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Profile>(emptyProfile);
  const [error, setError] = useState('');
  const [companyLoading, setCompanyLoading] = useState(false);
  const companyRequest = useRef<AbortController | null>(null);
  useEffect(() => () => companyRequest.current?.abort(), []);
  const cancelCompanyRequest = () => {
    companyRequest.current?.abort();
    companyRequest.current = null;
    setCompanyLoading(false);
  };
  const editForm = (next: Profile) => {
    if (next.inn !== form.inn) {
      cancelCompanyRequest();
      setError('');
    }
    setForm((previous) => editCompanyProfile(previous, next));
  };
  async function loadCompany() {
    if (!validInn(form.inn)) {
      setError('Проверьте ИНН: нужны 10 или 12 цифр с верной контрольной суммой.');
      return;
    }
    cancelCompanyRequest();
    const controller = new AbortController();
    companyRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    setCompanyLoading(true);
    setError('');
    try {
      const data = await requestCompanyData(form.inn, controller.signal);
      if (controller.signal.aborted || companyRequest.current !== controller) return;
      setForm((previous) => mergeCompanyProfile(previous, data));
      setStep(1);
    } catch (error) {
      if (companyRequest.current === controller)
        setError(
          controller.signal.aborted
            ? 'Время ожидания истекло. Попробуйте ещё раз или заполните сведения вручную.'
            : error instanceof Error
              ? error.message
              : 'Не удалось получить данные компании.',
        );
    } finally {
      clearTimeout(timeout);
      if (companyRequest.current === controller) {
        companyRequest.current = null;
        setCompanyLoading(false);
      }
    }
  }
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Все меры');
  const [toast, setToast] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'Какая задача сейчас важнее для вашего бизнеса?' },
  ]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [assistantMode, setAssistantMode] = useState('Сценарный помощник');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Параметр запуска открывает публичную карточку, но не подтверждает личность пользователя.
    const openLaunchProgram = () => {
      const p = programs.find((p) => p.id === window.WebApp?.initDataUnsafe?.start_param);
      if (p) setSelected(p);
    };
    openLaunchProgram();
    window.addEventListener('opora:max-ready', openLaunchProgram);
    return () => window.removeEventListener('opora:max-ready', openLaunchProgram);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem('opora.profile.v1', JSON.stringify(profile));
      localStorage.setItem('opora.apps.v1', JSON.stringify(apps));
      localStorage.setItem('opora.saved.v1', JSON.stringify(saved));
    } catch {
      setToast('Не удалось сохранить данные в браузере. Скачайте важные черновики.');
    }
  }, [profile, apps, saved]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (selected || onboard) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [selected, onboard]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);
  const ranked = programs
    .map((p) => ({
      p,
      r: analyzeOpportunity(
        p,
        profile || emptyProfile,
        apps.find((a) => a.programId === p.id),
      ),
    }))
    .sort((a, b) => b.r.score - a.r.score);
  const toggleSaved = (id: string) =>
    setSaved((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  const browse = (type = 'Все меры') => {
    setFilter(type);
    setQuery('');
    setOnlySaved(false);
    setPage('programs');
  };
  const visiblePrograms = ranked.filter(
    ({ p }) =>
      (filter === 'Все меры' || p.type === filter) &&
      (!onlySaved || saved.includes(p.id)) &&
      `${p.title} ${p.description} ${p.type}`.toLowerCase().includes(query.toLowerCase()),
  );
  const activeApp = selected ? apps.find((a) => a.programId === selected.id) : undefined;
  const openProfile = () => {
    cancelCompanyRequest();
    setForm(profile || emptyProfile);
    setStep(profile ? 1 : 0);
    setError('');
    setOnboard(true);
  };
  const close = () => {
    cancelCompanyRequest();
    setSelected(null);
    setOnboard(false);
    setError('');
  };
  const updateApp = (id: string, patch: Partial<Application>) =>
    setApps((old) => old.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  // Для одной программы создаём один черновик, сохраняя уже введённые данные.
  function startApplication(p: Program) {
    if (!profile) {
      setSelected(null);
      openProfile();
      return;
    }
    if (!analyzeOpportunity(p, profile).canPrepare) return;
    if (!apps.some((a) => a.programId === p.id))
      setApps((old) => [
        ...old,
        {
          id: crypto.randomUUID(),
          programId: p.id,
          createdAt: new Date().toISOString(),
          documents: {},
          project: '',
          budget: '',
        },
      ]);
    setPage('applications');
    setToast('Рабочее место заявки создано');
  }
  // Сначала проверяем ИНН, затем остальные сведения для персонального подбора.
  function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (companyLoading) return;
    if (!validInn(form.inn)) {
      setError('Проверьте ИНН: нужны 10 или 12 цифр с верной контрольной суммой.');
      return;
    }
    if (step === 0) {
      setStep(1);
      setError('');
      return;
    }
    if (
      !form.name.trim() ||
      !form.region.trim() ||
      !/^\d{2}(\.\d{1,2}){0,2}$/.test(form.okved) ||
      !form.goals.length
    ) {
      setError('Укажите название, регион, ОКВЭД (например, 62.01) и хотя бы одну цель.');
      return;
    }
    setProfile({
      ...form,
      name: form.name.trim(),
      region: form.region.trim(),
    });
    close();
    setPage('overview');
  }
  // Контекст выбранной программы сохраняется при переходе в чат.
  async function ask(
    text: string,
    program: Program | null = chatProgram,
    task?: 'strategy' | 'documents',
  ) {
    if (!text.trim() || sending) return;
    setPage('assistant');
    setChatProgram(program);
    setQuestion('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setSending(true);
    const fallback = localAnswer(text, profile, program?.id, apps);
    const application = apps.find((a) => a.programId === program?.id);
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          task,
          context: {
            profile,
            programId: program?.id,
            application:
              application && program
                ? {
                    preparedDocuments: program.documents.filter((d) => application.documents[d]),
                    budget: application.budget.trim() ? Number(application.budget) : null,
                  }
                : undefined,
          },
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      setMessages((m) => [...m, { role: 'assistant', text: data.answer || fallback }]);
      setAssistantMode(
        data.mode === 'llm' ? 'GigaChat · строгая защита данных' : 'Сценарный помощник',
      );
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: fallback }]);
      setAssistantMode('Сценарный помощник · локально');
    } finally {
      setSending(false);
    }
  }
  // Экспортируем только сроки программ, по которым пользователь создал заявки.
  function exportCalendar() {
    const ids = new Set(apps.map((a) => a.programId));
    const events = programs
      .filter((p) => ids.has(p.id))
      .map(
        (p) =>
          `BEGIN:VEVENT\r\nUID:${p.id}@opora.demo\r\nDTSTAMP:${new Date()
            .toISOString()
            .replace(/[-:]/g, '')
            .replace(
              /\.\d{3}/,
              '',
            )}\r\nDTSTART;VALUE=DATE:${p.deadline.replace(/-/g, '')}\r\nSUMMARY:Демо — ${p.title}\r\nDESCRIPTION:Учебный дедлайн. Реальная программа не подключена.\r\nEND:VEVENT`,
      );
    download(
      `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Opora//Demo//RU\r\n${events.join('\r\n')}\r\nEND:VCALENDAR`,
      'opora-calendar.ics',
      'text/calendar;charset=utf-8',
    );
  }
  function programCard(p: Program) {
    const r = analyzeOpportunity(
      p,
      profile || emptyProfile,
      apps.find((a) => a.programId === p.id),
    );
    return (
      <article className="program-card" key={p.id}>
        <div className="card-top">
          <span className={'program-icon ' + p.id}>
            <Icon name={p.icon} size={23} />
          </span>
          <span className="tag">{p.type}</span>
          <span className="region">{p.region}</span>
          <button
            className={'save-program ' + (saved.includes(p.id) ? 'is-saved' : '')}
            aria-label={
              saved.includes(p.id) ? 'Убрать из сохранённых: ' + p.title : 'Сохранить: ' + p.title
            }
            aria-pressed={saved.includes(p.id)}
            onClick={() => toggleSaved(p.id)}
          >
            <Icon name="bookmark" size={19} />
          </button>
        </div>
        <h3>{p.title}</h3>
        <div className="program-value">
          <strong className="amount">{r.benefit.label}</strong>
          <span>Учебная программа</span>
        </div>
        <div className="match">
          <span className={r.score === 100 ? 'match-good' : ''}>
            <Icon name={r.score === 100 ? 'check' : 'compass'} size={16} />
            {profile ? r.status : 'Заполните профиль'}
          </span>
          {profile && <b>{r.score}%</b>}
        </div>
        <p className="widget-footnote">
          {r.confirmed} из {r.total} пунктов · сложность: {p.difficulty.toLowerCase()}
        </p>
        <div className="card-bottom">
          <span>
            <Icon name="calendar" size={15} />
            {r.expired ? 'Приём завершён' : `До ${date(p.deadline)}`}
          </span>
          <ActionButton className="text-button" onClick={() => setSelected(p)}>
            Подробнее <Icon name="arrow" size={17} />
          </ActionButton>
        </div>
      </article>
    );
  }

  return (
    <div className={`app-shell page-${page}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage('overview');
          }}
        >
          <span className="brand-mark">
            о<span />
          </span>
          опора<span className="brand-dot">.</span>
        </a>
        <nav aria-label="Основная навигация">
          {nav.map((n) => (
            <button
              key={n.id}
              aria-current={page === n.id ? 'page' : undefined}
              className={'nav-item nav-' + n.id + ' ' + (page === n.id ? 'active' : '')}
              onClick={() => setPage(n.id)}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.id === 'applications' && apps.length > 0 && <small>{apps.length}</small>}
            </button>
          ))}
        </nav>
        <button
          aria-label="AI-помощник"
          aria-current={page === 'assistant' ? 'page' : undefined}
          className={'nav-item assistant-nav ' + (page === 'assistant' ? 'active' : '')}
          onClick={() => setPage('assistant')}
        >
          <Icon name="chat" />
          <span>AI-помощник</span>
          <span className="tiny-badge">AI</span>
        </button>
        <div className="sidebar-bottom">
          <div className="max-card">
            <span className="max-logo">м</span>
            <div>
              <b>Рядом, в MAX</b>
            </div>
          </div>
          <button className="business-switch" onClick={openProfile}>
            <span className="avatar">
              <Icon name="building" />
            </span>
            <span>
              <b>{profile ? profile.name : 'Ваш бизнес'}</b>
              <small>{profile ? `ИНН ${profile.inn}` : 'Добавить компанию'}</small>
            </span>
            <span>⌄</span>
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <button className="mobile-identity" onClick={() => setPage('profile')}>
            <span className="identity-avatar">
              <Icon name="building" />
            </span>
            <span>
              <b>{profile ? profile.name.replace(/ООО|ИП|«|»/g, '').trim() : 'Ваш бизнес'}</b>
            </span>
          </button>
          <span className="breadcrumb">
            Рабочее пространство <span>/</span>{' '}
            <b>{nav.find((n) => n.id === page)?.label || 'AI-помощник'}</b>
          </span>
          <div className="top-actions">
            <button
              className="icon-button"
              aria-label="Открыть календарь"
              onClick={() => setPage('calendar')}
            >
              <Icon name="bell" />
            </button>
            <button
              className="user-avatar"
              aria-label="Профиль бизнеса"
              onClick={() => setPage('profile')}
            >
              {profile
                ? profile.name
                    .replace(/ООО|ИП|«|»/g, '')
                    .trim()
                    .slice(0, 1)
                : 'В'}
            </button>
          </div>
        </header>
        <main>
          {page !== 'overview' && (
            <div className="page-heading">
              <h1>
                {
                  {
                    programs: 'Меры поддержки',
                    applications: 'Мои заявки',
                    calendar: 'Календарь',
                    profile: 'Мой бизнес',
                    assistant: 'AI-агент',
                  }[page]
                }
              </h1>
            </div>
          )}
          {page === 'overview' && (
            <AgentDashboard
              analysis={analysis}
              profile={profile}
              apps={apps}
              onOpen={setSelected}
              onProfile={openProfile}
              onDemo={() => {
                setProfile(demoProfile);
                setToast('Учебный профиль создан. Данные реестра не запрашивались.');
              }}
              onBrowse={() => browse()}
              onAsk={() => {
                setChatProgram(null);
                setPage('assistant');
              }}
            />
          )}
          {page === 'programs' && (
            <>
              <div className="catalog-toolbar">
                <div className="segmented-control" aria-label="Показать программы">
                  <button
                    aria-pressed={!onlySaved}
                    className={!onlySaved ? 'selected' : ''}
                    onClick={() => setOnlySaved(false)}
                  >
                    Все меры
                  </button>
                  <button
                    aria-pressed={onlySaved}
                    className={onlySaved ? 'selected' : ''}
                    onClick={() => setOnlySaved(true)}
                  >
                    Сохранённые <span>{saved.length}</span>
                  </button>
                </div>
                <label className="search-box">
                  <Icon name="search" />
                  <BusinessInput
                    aria-label="Поиск мер поддержки"
                    placeholder="Название или цель"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              <CategoryWidget onChoose={setFilter} active={filter} />
              <div className="catalog-results-header">
                <h2>{filter === 'Все меры' ? 'Все возможности' : filter}</h2>
                <span>{visiblePrograms.length} в демокаталоге</span>
                {filter !== 'Все меры' && (
                  <button onClick={() => setFilter('Все меры')}>
                    Сбросить <Icon name="close" size={13} />
                  </button>
                )}
              </div>
              <div className="filter-chips" aria-label="Виды мер поддержки">
                {supportFilters.map((type) => (
                  <button
                    key={type}
                    aria-pressed={filter === type}
                    className={filter === type ? 'selected' : ''}
                    onClick={() => setFilter(type)}
                  >
                    {type}
                  </button>
                ))}
              </div>
              <div className="program-grid catalog">
                {visiblePrograms.map(({ p }) => programCard(p))}
              </div>
              {!visiblePrograms.length && (
                <div className="empty-state">
                  <span className="empty-symbol">
                    <Icon name={onlySaved ? 'bookmark' : 'search'} size={32} />
                  </span>
                  <h2>
                    {onlySaved && !saved.length
                      ? 'Пока нет сохранённых программ'
                      : 'Здесь пока нет программ'}
                  </h2>
                  <p>
                    {onlySaved && !saved.length
                      ? 'Нажмите на закладку в карточке, чтобы сохранить возможность.'
                      : 'С выбранными фильтрами нет результатов. Попробуйте изменить категорию или запрос.'}
                  </p>
                  <ActionButton
                    className="secondary"
                    onClick={() => {
                      setFilter('Все меры');
                      setQuery('');
                      setOnlySaved(false);
                    }}
                  >
                    Посмотреть все меры
                  </ActionButton>
                </div>
              )}
              <p className="widget-footnote catalogue-disclaimer">
                Суммы и условия модельные. Совпадение правил не подтверждает право на поддержку.
              </p>
            </>
          )}
          {page === 'applications' &&
            (apps.length ? (
              <div className="application-list">
                {apps.map((a) => {
                  const p = programs.find((p) => p.id === a.programId)!;
                  const count = p.documents.filter((d) => a.documents[d]).length;
                  return (
                    <article className="application-row" key={a.id}>
                      <span className="program-icon">
                        <Icon name={p.icon} />
                      </span>
                      <div className="application-info">
                        <span className="tag">Черновик · не отправлен</span>
                        <h3>{p.title}</h3>
                        <p>
                          {count} из {p.documents.length} документов отмечено · срок{' '}
                          {date(p.deadline)}
                        </p>
                        <div className="progress">
                          <i style={{ width: `${(count / p.documents.length) * 100}%` }} />
                        </div>
                      </div>
                      <ActionButton className="secondary" onClick={() => setSelected(p)}>
                        Продолжить <Icon name="arrow" size={17} />
                      </ActionButton>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                <Icon name="file" size={42} />
                <h2>Пока нет заявок</h2>
                <ActionButton className="primary" onClick={() => setPage('programs')}>
                  Выбрать программу <Icon name="arrow" size={17} />
                </ActionButton>
              </div>
            ))}
          {page === 'calendar' && (
            <>
              <div className="section-title">
                <ActionButton
                  className="secondary"
                  disabled={!apps.length}
                  onClick={exportCalendar}
                >
                  <Icon name="download" size={17} />
                  Скачать сроки моих заявок
                </ActionButton>
              </div>
              <div className="timeline">
                {[...programs]
                  .sort((a, b) => a.deadline.localeCompare(b.deadline))
                  .map((p) => (
                    <button className="timeline-row" key={p.id} onClick={() => setSelected(p)}>
                      <span className="date-tile">
                        <b>{new Date(p.deadline).getDate()}</b>
                        <span>
                          {new Date(p.deadline).toLocaleDateString('ru-RU', { month: 'short' })}
                        </span>
                      </span>
                      <span>
                        <small>
                          {p.type} · {new Date(p.deadline).getFullYear()} ·{' '}
                          {analyzeOpportunity(
                            p,
                            profile || emptyProfile,
                            apps.find((a) => a.programId === p.id),
                          ).expired
                            ? 'Приём завершён'
                            : 'Окончание приёма'}
                        </small>
                        <h3>{p.title}</h3>
                        {apps.some((a) => a.programId === p.id) && (
                          <span className="green-text">Есть ваша заявка</span>
                        )}
                      </span>
                      <Icon name="arrow" />
                    </button>
                  ))}
              </div>
              <div className="data-note">
                Экспорт .ics добавляет сроки в ваш календарь. Автоматические уведомления в MAX в
                этой версии ещё не подключены.
              </div>
            </>
          )}
          {page === 'profile' && (
            <div className="profile-wallet-layout">
              <BusinessCard profile={profile} onEdit={openProfile} />
              <section className="widget profile-shortcuts">
                <button className="widget-link-row" onClick={() => browse()}>
                  <span className="soft-round">
                    <Icon name="compass" />
                  </span>
                  <span>
                    <b>Поддержка бизнеса</b>
                  </span>
                  <Icon name="chevron" size={16} />
                </button>
                <button className="widget-link-row" onClick={() => setPage('calendar')}>
                  <span className="soft-round">
                    <Icon name="calendar" />
                  </span>
                  <span>
                    <b>Важные сроки</b>
                  </span>
                  <Icon name="chevron" size={16} />
                </button>
              </section>
            </div>
          )}
          {page === 'profile' &&
            (profile ? (
              <section className="profile-panel">
                <div className="section-title">
                  <div>
                    <span className="tag">Профиль бизнеса · источники и ручной ввод</span>
                    <h2>{profile.name}</h2>
                  </div>
                  <ActionButton className="secondary" onClick={openProfile}>
                    Редактировать
                  </ActionButton>
                </div>
                <CompanySources profile={profile} />
                <FieldSource profile={profile} field="name" />
                <dl className="profile-grid">
                  {[
                    ['ИНН', profile.inn, 'inn'],
                    ['Форма бизнеса', profile.companyType || 'Не указана', 'companyType'],
                    ['Регион', profile.region, 'region'],
                    ['Основной ОКВЭД', profile.okved, 'okved'],
                    [
                      'Возраст компании',
                      profile.ageMonths === null ? 'Не указан' : `${profile.ageMonths} мес.`,
                      'ageMonths',
                    ],
                    ['Сотрудники', profile.employees ?? 'Не указано', 'employees'],
                    [
                      'Годовой оборот',
                      profile.revenue === null
                        ? 'Не указан'
                        : `${profile.revenue.toLocaleString('ru-RU')} ₽`,
                      'revenue',
                    ],
                    ['Налоговый режим', profile.tax || 'Не указан', 'tax'],
                    [
                      'Статус МСП',
                      profile.isSme === 'yes'
                        ? 'Да'
                        : profile.isSme === 'no'
                          ? 'Нет'
                          : 'Неизвестно',
                      'isSme',
                    ],
                  ].map(([k, v, field]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>
                        {v}
                        <FieldSource profile={profile} field={field as keyof ProfileValues} />
                      </dd>
                    </div>
                  ))}
                </dl>
                <h3>Цели развития</h3>
                <div className="goal-chips">
                  {profile.goals.map((g) => (
                    <span className="tag" key={g}>
                      {g}
                    </span>
                  ))}
                </div>
                <div className="data-note">
                  Профиль и заявки хранятся в этом браузере. Автоматическое получение данных ФНС и
                  синхронизация с MAX пока не подключены.
                </div>
              </section>
            ) : (
              <div className="empty-state">
                <Icon name="building" size={42} />
                <h2>Добавьте бизнес</h2>
                <ActionButton className="primary" onClick={openProfile}>
                  Добавить бизнес
                </ActionButton>
              </div>
            ))}
          {page === 'assistant' && (
            <section className="chat-panel">
              <div className="chat-header">
                <Orb small />
                <div>
                  <b>Опора AI</b>
                  <small>{assistantMode} · учебные источники</small>
                </div>
              </div>
              <details className="context-info">
                <summary>Как обрабатываются данные</summary>
                <p>
                  Реквизиты и свободный вопрос заменяются токенами. AI получает параметры бизнеса и
                  тип запроса; детали свободного текста пока не учитываются.
                </p>
              </details>
              {chatProgram && (
                <div className="chat-program-context">
                  <Icon name={chatProgram.icon} size={18} />
                  <span>Обсуждаем: {chatProgram.title}</span>
                  <button
                    aria-label="Перейти к общим вопросам"
                    onClick={() => setChatProgram(null)}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              )}
              <div className="messages" aria-live="polite">
                {messages.map((m, i) => (
                  <div key={i} className={'message ' + m.role}>
                    {m.text}
                  </div>
                ))}
                {sending && (
                  <div className="message assistant message-loading">
                    <Spinner size={20} appearance="themed" />
                    Готовлю ответ…
                  </div>
                )}
                <div ref={chatEnd} />
              </div>
              <div className="suggestions">
                {['Какая программа подходит?', 'Какие нужны документы?', 'Какие сроки?'].map(
                  (q) => (
                    <button key={q} disabled={sending} onClick={() => ask(q)}>
                      {q}
                    </button>
                  ),
                )}
              </div>
              <form
                className="chat-input"
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(question);
                }}
              >
                <BusinessInput
                  aria-label="Сообщение помощнику"
                  maxLength={2000}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Что вы хотите узнать о поддержке бизнеса?"
                />
                <ActionButton
                  type="submit"
                  className="primary"
                  disabled={sending || !question.trim()}
                  aria-label="Отправить сообщение"
                >
                  <Icon name="arrow" />
                </ActionButton>
              </form>
            </section>
          )}
          <footer>
            <span className="footer-logo">опора.</span>
            <span>Учебные программы · 2026</span>
          </footer>
        </main>
      </div>
      <dialog
        aria-label={onboard ? 'Профиль бизнеса' : selected?.title || 'Программа'}
        ref={dialogRef}
        onCancel={close}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="modal">
          <button className="modal-close icon-button" aria-label="Закрыть" onClick={close}>
            <Icon name="close" />
          </button>
          {onboard && (
            <form onSubmit={saveProfile}>
              <span className="eyebrow">ПРОФИЛЬ БИЗНЕСА · ШАГ {step + 1} ИЗ 2</span>
              <h2>{step === 0 ? 'ИНН вашего бизнеса' : 'Данные для AI-анализа'}</h2>
              <p className="muted">Доступен учебный источник «Опора». Реестры ФНС пока не подключены.</p>
              <details className="context-info">
                <summary>ИНН учебных примеров</summary>
                <p>ООО: 9900000017 · ИП: 990000000041 · КФХ: 9900000024 · IT: 9900000031.</p>
                <p>Все сведения вымышлены. Для другого ИНН доступно ручное заполнение.</p>
              </details>
              <CompanySources profile={form} />
              <fieldset className="company-form-fields" disabled={companyLoading}>
                {step === 0 ? (
                  <label className="field">
                    ИНН
                    <FieldSource profile={form} field="inn" />
                    <BusinessInput
                      autoFocus
                      inputMode="numeric"
                      maxLength={12}
                      placeholder="10 или 12 цифр"
                      value={form.inn}
                      onChange={(e) => editForm({ ...form, inn: e.target.value.replace(/\D/g, '') })}
                    />
                  </label>
                ) : (
                  <>
                    <div className="form-grid">
                      <label className="field">
                        Название
                        <FieldSource profile={form} field="name" />
                        <BusinessInput
                          required
                          value={form.name}
                          onChange={(e) => editForm({ ...form, name: e.target.value })}
                          placeholder="ООО «Название»"
                          maxLength={120}
                        />
                      </label>
                      <label className="field">
                        ИНН
                        <FieldSource profile={form} field="inn" />
                        <BusinessInput
                          required
                          inputMode="numeric"
                          maxLength={12}
                          value={form.inn}
                          onChange={(e) => {
                            const inn = e.target.value.replace(/\D/g, '');
                            editForm({ ...form, inn });
                          }}
                        />
                      </label>
                      <label className="field">
                        Форма бизнеса
                        <FieldSource profile={form} field="companyType" />
                        <select
                          value={form.companyType}
                          onChange={(e) =>
                            editForm({ ...form, companyType: e.target.value as Profile['companyType'] })
                          }
                        >
                          {['', 'ООО', 'ИП', 'КФХ', 'другое'].map((value) => (
                            <option key={value} value={value}>{value || 'Не указана'}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Регион
                        <FieldSource profile={form} field="region" />
                        <BusinessInput
                          required
                          list="regions"
                          value={form.region}
                          onChange={(e) => editForm({ ...form, region: e.target.value })}
                        />
                        <datalist id="regions">
                          <option>Москва</option>
                          <option>Санкт-Петербург</option>
                          <option>Республика Татарстан</option>
                          <option>Московская область</option>
                        </datalist>
                      </label>
                      <label className="field">
                        Основной ОКВЭД
                        <FieldSource profile={form} field="okved" />
                        <BusinessInput
                          required
                          placeholder="62.01"
                          value={form.okved}
                          onChange={(e) => editForm({ ...form, okved: e.target.value })}
                        />
                      </label>
                      {(['ageMonths', 'employees', 'revenue'] as const).map((key, i) => (
                        <label className="field" key={key}>
                          {
                            [
                              'Возраст компании, месяцев',
                              'Количество сотрудников',
                              'Годовой оборот, ₽',
                            ][i]
                          }
                          <FieldSource profile={form} field={key} />
                          <BusinessInput
                            type="number"
                            min="0"
                            max={key === 'revenue' ? 1e15 : key === 'employees' ? 1e7 : 3000}
                            step="1"
                            placeholder="Пока неизвестно"
                            value={form[key] ?? ''}
                            onChange={(e) =>
                              editForm({
                                ...form,
                                [key]: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      ))}
                      <label className="field">
                        Статус МСП
                        <FieldSource profile={form} field="isSme" />
                        <select
                          value={form.isSme}
                          onChange={(e) =>
                            editForm({ ...form, isSme: e.target.value as Profile['isSme'] })
                          }
                        >
                          <option value="unknown">Не знаю</option>
                          <option value="yes">Есть в реестре</option>
                          <option value="no">Нет в реестре</option>
                        </select>
                      </label>
                      <label className="field">
                        Налоговый режим
                        <FieldSource profile={form} field="tax" />
                        <select
                          value={form.tax}
                          onChange={(e) => editForm({ ...form, tax: e.target.value })}
                        >
                          {['', 'УСН', 'ОСНО', 'ПСН', 'ЕСХН', 'АУСН'].map((t) => (
                            <option key={t} value={t}>
                              {t || 'Не указан'}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <h3>Что вы планируете?</h3>
                    <div className="goal-chips">
                      {goals.map((g) => (
                        <ActionButton
                          type="button"
                          aria-pressed={form.goals.includes(g)}
                          className={'goal-chip ' + (form.goals.includes(g) ? 'chosen' : '')}
                          key={g}
                          onClick={() =>
                            editForm({
                              ...form,
                              goals: form.goals.includes(g)
                                ? form.goals.filter((x) => x !== g)
                                : [...form.goals, g],
                            })
                          }
                        >
                          {form.goals.includes(g) ? '✓ ' : '+ '}
                          {g}
                        </ActionButton>
                      ))}
                    </div>
                  </>
                )}
                {form.inn && (
                  <ActionButton type="button" className="secondary" onClick={() => void loadCompany()}>
                    {companyLoading ? 'Получаем данные…' : 'Получить данные компании'}
                  </ActionButton>
                )}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <div className="modal-actions">
                  {step === 1 && (
                    <ActionButton type="button" className="secondary" onClick={() => setStep(0)}>
                      Назад
                    </ActionButton>
                  )}
                  <ActionButton className="primary" type="submit">
                    {step === 0 ? 'Продолжить' : 'Запустить AI-анализ'}
                    <Icon name="arrow" size={17} />
                  </ActionButton>
                </div>
              </fieldset>
            </form>
          )}
          {selected && (
            <>
              <button
                className={
                  'detail-bookmark save-program ' + (saved.includes(selected.id) ? 'is-saved' : '')
                }
                aria-label={
                  saved.includes(selected.id) ? 'Убрать из сохранённых' : 'Сохранить программу'
                }
                aria-pressed={saved.includes(selected.id)}
                onClick={() => toggleSaved(selected.id)}
              >
                <Icon name="bookmark" />
              </button>
              <div className={'detail-emblem ' + selected.id}>
                <Icon name={selected.icon} size={38} />
              </div>
              <span className="tag">{selected.type} · демонстрационная программа</span>
              <h2>{selected.title}</h2>
              <p className="muted">{selected.description}</p>
              <EligibilityDetail
                program={selected}
                profile={profile}
                app={activeApp}
                onProfile={() => {
                  setSelected(null);
                  openProfile();
                }}
                onAsk={(task) => {
                  const program = selected;
                  close();
                  void ask(
                    task === 'strategy'
                      ? 'Составь план действий по этой программе'
                      : 'Какие документы нужны по этой программе?',
                    program,
                    task,
                  );
                }}
              />
              {activeApp ? (
                <>
                  <DetailSteps
                    prepared={selected.documents.filter((d) => activeApp.documents[d]).length}
                    total={selected.documents.length}
                    hasProject={!!activeApp.project.trim()}
                    hasBudget={Number(activeApp.budget) > 0}
                  />
                  <h3 id="application-documents">Подготовка документов</h3>
                  <DocumentChecklist
                    key={selected.id}
                    program={selected}
                    app={activeApp}
                    onUpdate={(patch) => updateApp(activeApp.id, patch)}
                  />
                  <label className="field">
                    Описание проекта
                    <BusinessTextarea
                      id="application-project"
                      rows={4}
                      maxLength={10000}
                      placeholder="Что вы планируете сделать, какой результат ожидаете и на что нужны средства?"
                      value={activeApp.project}
                      onChange={(e) => updateApp(activeApp.id, { project: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    Бюджет проекта, ₽
                    <BusinessInput
                      id="application-budget"
                      type="number"
                      min="0"
                      value={activeApp.budget}
                      onChange={(e) => updateApp(activeApp.id, { budget: e.target.value })}
                    />
                  </label>
                  {profile && (
                    <DraftComposer
                      key={selected.id}
                      program={selected}
                      profile={profile}
                      app={activeApp}
                      onUpdate={(patch) => updateApp(activeApp.id, patch)}
                      onDownload={(text) => download(text, `opora-${selected.id}-document.txt`)}
                    />
                  )}
                  <div className="modal-actions">
                    <ActionButton
                      className="primary"
                      onClick={() =>
                        profile &&
                        download(
                          draftText(activeApp, selected, profile),
                          `opora-${selected.id}-draft.txt`,
                        )
                      }
                    >
                      <Icon name="download" size={17} />
                      Скачать черновик
                    </ActionButton>
                  </div>
                </>
              ) : (
                <>
                  <h3>Что нужно подготовить</h3>
                  <ul className="plain-list">
                    {selected.documents.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                  <div className="modal-actions">
                    <ActionButton
                      className="secondary"
                      onClick={() => {
                        setSelected(null);
                        openProfile();
                      }}
                    >
                      Уточнить профиль
                    </ActionButton>
                    <ActionButton
                      className="primary"
                      disabled={
                        !analyzeOpportunity(selected, profile || emptyProfile, activeApp).canPrepare
                      }
                      onClick={() => startApplication(selected)}
                    >
                      {profile ? 'Готовить заявку' : 'Добавить бизнес'}
                      <Icon name="arrow" size={17} />
                    </ActionButton>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </dialog>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
