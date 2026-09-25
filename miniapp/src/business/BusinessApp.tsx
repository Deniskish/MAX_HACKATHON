// Общее состояние экранов, профиля и заявок. Условия программ считаются в domain.
import { CompanySources, FieldSource } from './CompanySource';
import { editCompanyProfile, mergeCompanyProfile, requestCompanyData } from './company-data';
import { FundingExperience, FundingOpportunityCard } from './FundingExperience';
import { OfficialDetails, ProjectOnboarding } from './OfficialExperience';
import { officialFundingCatalog } from '../../api-server/funding-catalog/official-catalog';
import { matchFundingOpportunity, rankFundingMatches } from '../../api-server/funding-catalog/matching';
import { toFundingProfile } from '../../api-server/funding-catalog/input';
import { fundingKindLabels } from '../../api-server/funding-catalog/presentation';
import type { FundingProfile, ProjectProfile } from '../../api-server/funding-catalog/types';
import { loadWorkspace, saveWorkspace, projectAsProfile, applicationStatus, applicationLabels, calendarICS, fundingEvents } from './workspace';
import {
  DocumentChecklist,
  DraftComposer,
} from './AgentExperience';
import { BusinessCard, DetailSteps, Orb } from './VisualWidgets';
import { Icon } from './Icon';
import { ModalSheet } from './ModalSheet';
import { Spinner } from '@maxhub/max-ui';
import { ActionButton, BusinessInput, BusinessTextarea } from './MaxControls';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  type Profile,
  type ProfileValues,
  type Program,
  type Application,
  emptyProfile,
  goals,
  programs,
  analyzeOpportunity,
  validInn,
  draftText,
} from './domain';

type Page = 'overview' | 'programs' | 'applications' | 'calendar' | 'profile' | 'assistant';
type Message = { role: 'user' | 'assistant'; text: string; opportunityIds?: string[] };
const nav: { id: Page; label: string; icon: string }[] = [
  { id: 'overview', label: 'Главная', icon: 'home' },
  { id: 'programs', label: 'Меры поддержки', icon: 'compass' },
  { id: 'applications', label: 'Мои заявки', icon: 'file' },
  { id: 'calendar', label: 'Календарь', icon: 'calendar' },
  { id: 'profile', label: 'Профиль бизнеса', icon: 'building' },
];

const date = (s: string) =>
  !s ? 'не опубликован' : new Date(s + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
// Повреждённый JSON не должен мешать открыть приложение.
function readSaved<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
// Временная ссылка существует только на время скачивания.
function browserDownload(text: string, name: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['\ufeff', text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BusinessApp() {
  const [exportText, setExportText] = useState('');
  function download(text: string, name: string, type = 'text/plain;charset=utf-8') {
    if (window.WebApp?.initData) {
      if (type.startsWith('text/calendar') && window.WebApp.downloadFile && location.protocol === 'https:') {
        try {
          Promise.resolve(window.WebApp.downloadFile(new URL('/api/funding/calendar.ics', location.origin).href, name))
            .catch(() => setToast('MAX не смог скачать календарь. Повторите попытку или откройте приложение в браузере.'));
        } catch { setToast('MAX не смог скачать календарь. Откройте приложение в браузере.'); }
      } else { setSelected(null); setExportText(text); }
    } else browserDownload(text, name, type);
  }
  const [page, setPage] = useState<Page>('overview');
  const [initial] = useState(() => loadWorkspace(localStorage, programs.map((p) => p.id)));
  const [companyProfile, setProfile] = useState<Profile | null>(initial.profile);
  const [projectProfile, setProjectProfile] = useState<ProjectProfile | null>(initial.projectProfile);
  const [projectOnboard, setProjectOnboard] = useState(false);
  const [need, setNeed] = useState(initial.fundingNeed);
  const profile = companyProfile ?? (projectProfile ? projectAsProfile(projectProfile) : null);
  const fundingProfile: FundingProfile = projectProfile && !companyProfile
    ? { region: projectProfile.region, applicantType: 'project', stage: projectProfile.stage, industry: projectProfile.industry }
    : toFundingProfile(profile ?? emptyProfile);
  const [apps, setApps] = useState<Application[]>(initial.applications);
  const [saved, setSaved] = useState<string[]>(initial.saved);
  const [availability, setAvailability] = useState('');
  const [showEvents, setShowEvents] = useState(false);
  const [previousSnapshot] = useState<Record<string, string>>(() => readSaved('opora.snapshot.v2', {}));
  const matches = rankFundingMatches(officialFundingCatalog.map((o) => matchFundingOpportunity(fundingProfile, need, o, {
    preparedDocuments: Object.keys(apps.find((a) => a.programId === o.id)?.documents ?? {}).filter((d) => apps.find((a) => a.programId === o.id)?.documents[d]),
  })));
  const events = fundingEvents(officialFundingCatalog, saved, previousSnapshot, matches);
  useEffect(() => { try { localStorage.setItem('opora.snapshot.v2', JSON.stringify(Object.fromEntries(officialFundingCatalog.map((o) => [o.id, o.version])))); } catch { /* Workspace storage warning handles unavailable storage. */ } }, []);
  const openFunding = (id: string) => { const p = programs.find((p) => p.id === id); if (p) setSelected(p); };
  const [onlySaved, setOnlySaved] = useState(false);
  const [selected, setSelected] = useState<Program | null>(
    () =>
      programs.find((p) => p.id === (new URLSearchParams(window.location.search).get('program') || new URLSearchParams(window.location.search).get('WebAppStartParam'))) ||
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
  const [assistantMode, setAssistantMode] = useState('Проверяем доступность GigaChat');
  useEffect(() => { const controller = new AbortController(); fetch('/api/ai/status', { signal: controller.signal }).then((r) => r.json()).then((data) => setAssistantMode(data.status === 'ready' ? 'GigaChat подключён' : data.configured ? 'GigaChat настроен · соединение ещё не подтверждено' : 'GigaChat не настроен')).catch(() => { if (!controller.signal.aborted) setAssistantMode('Статус AI недоступен'); }); return () => controller.abort(); }, []);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [page]);
  useEffect(() => { dialogRef.current?.querySelector('.modal')?.scrollTo({ top: 0 }); }, [selected?.id, onboard, step]);
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
      saveWorkspace(localStorage, { profile: companyProfile, projectProfile, fundingNeed: need, saved, applications: apps });
    } catch {
      setToast('Не удалось сохранить данные в браузере. Скачайте важные черновики.');
    }
  }, [companyProfile, projectProfile, need, apps, saved]);
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
      (!availability || officialFundingCatalog.find((o) => o.id === p.id)?.status === availability) &&
      `${p.title} ${p.description} ${p.type}`.toLowerCase().includes(query.toLowerCase()),
  );
  const activeApp = selected ? apps.find((a) => a.programId === selected.id) : undefined;
  const openProfile = () => {
    if (projectProfile && !companyProfile) { setProjectOnboard(true); return; }
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
    if (['expired', 'upcoming', 'not_eligible'].includes(matches.find((m) => m.opportunity.id === p.id)!.status)) { setToast('Приём закрыт. Сохраните программу и проверяйте новые отборы.'); return; }
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
          status: 'draft',
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
      !/^\d{2}(\.\d{1,2}){0,2}$/.test(form.okved)
    ) {
      setError('Укажите название, регион и ОКВЭД (например, 62.01).');
      return;
    }
    setProjectProfile(null);
    setProfile({
      ...form,
      name: form.name.trim(),
      region: form.region.trim(),
      applicantType: form.inn.length === 12 ? 'individual_entrepreneur' : 'legal_entity',
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
    const chosen = program ? matches.find((m) => m.opportunity.id === program.id) : matches.find((m) => m.status !== 'not_eligible' && m.status !== 'expired');
    const fallback = chosen ? `${chosen.opportunity.title}: ${chosen.explanation}` : 'Укажите цель в разделе «Главная» и выполните подбор.';
    const application = apps.find((a) => a.programId === program?.id);
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: text,
          task,
          context: {
            profile: fundingProfile,
            need: need.purpose ? need : undefined,
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
      if (!response.ok) {
        const problem = await response.json().catch(() => null);
        throw new Error(typeof problem?.error === 'string' ? problem.error : 'GigaChat временно недоступен.');
      }
      const data = await response.json();
      const opportunityIds: string[] = Array.isArray(data.opportunityIds)
        ? data.opportunityIds.filter((id: unknown) => programs.some((p) => p.id === id)) : [];
      setMessages((m) => [...m, { role: 'assistant', text: data.answer || fallback, opportunityIds }]);
      setAssistantMode(
        data.mode === 'llm' ? 'GigaChat · строгая защита данных' : 'Сценарный помощник',
      );
    } catch (error) {
      setMessages((m) => [...m, { role: 'assistant', text: `${error instanceof Error && error.name === 'TimeoutError' ? 'Время ожидания GigaChat истекло.' : error instanceof Error ? error.message : 'AI недоступен.'}\n\nРасчёт по правилам:\n${fallback}`, opportunityIds: chosen ? [chosen.opportunity.id] : [] }]);
      setAssistantMode('Ответ по правилам · GigaChat недоступен');
    } finally {
      setSending(false);
    }
  }
  // Экспортируем только опубликованные в каталоге сроки, в том числе архивные.
  function exportCalendar() { download(calendarICS(officialFundingCatalog), 'opora-calendar.ics', 'text/calendar;charset=utf-8'); }
  function programCard(p: Program) {
    const match = matches.find((m) => m.opportunity.id === p.id)!;
    return <FundingOpportunityCard key={p.id} match={match} onOpen={openFunding} onSave={toggleSaved} saved={saved.includes(p.id)} />;
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
              {n.id === 'overview'
                ? <img className="nav-logo" src="/brand/opora-logo.svg" width={20} height={20} alt="" aria-hidden="true" />
                : <Icon name={n.icon} />}
              <span className="desktop-nav-label">{n.label}</span>
              <span className="mobile-nav-label">{n.id === 'programs' ? 'Поддержка' : n.id === 'applications' ? 'Заявки' : n.label}</span>
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
              aria-label="События по сохранённым программам"
              aria-expanded={showEvents}
              onClick={() => setShowEvents(!showEvents)}
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
        <main ref={mainRef}>
          {showEvents && <section className="widget events-panel"><h2>События</h2><p className="muted">Вычислены при открытии приложения. Фонового мониторинга нет.</p>{events.length ? events.map((event) => <button className="widget-link-row" key={event.id} onClick={() => { openFunding(event.opportunityId); setShowEvents(false); }}>{event.text}</button>) : <p>Новых событий нет. Сохраните интересующие программы.</p>}<ActionButton className="secondary" onClick={() => { setPage('calendar'); setShowEvents(false); }}>Открыть календарь</ActionButton></section>}
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
          {page === 'overview' && (profile ? <>
            <section className="widget business-summary"><span className="tag">{companyProfile ? 'Ваш бизнес' : 'Проект без юридического лица'}</span><h1>{profile.name}</h1><p>{profile.region} · {companyProfile ? `ОКВЭД ${profile.okved || 'не указан'} · МСП: ${profile.isSme === 'yes' ? 'да' : profile.isSme === 'no' ? 'нет' : 'неизвестно'}` : projectProfile?.industry}</p><ActionButton className="secondary" onClick={openProfile}>Редактировать профиль</ActionButton></section>
            <FundingExperience key={companyProfile?.inn ?? 'project'} profile={fundingProfile} initialNeed={need} onNeed={setNeed} onOpen={openFunding} onSave={toggleSaved} saved={saved} />
          </> : <section className="widget agent-welcome"><Orb /><h1>Найдём поддержку и финансирование для вашего бизнеса</h1><p>Расскажите о бизнесе и его потребности. Условия берём из официальных источников, соответствие рассчитываем по правилам.</p><div className="modal-actions"><ActionButton className="primary" onClick={openProfile}>Добавить бизнес</ActionButton><ActionButton className="secondary" onClick={() => setProjectOnboard(true)}>У меня пока нет компании</ActionButton></div></section>)}
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
              <label className="field catalog-state">Статус<select value={availability} onChange={(e) => setAvailability(e.target.value)}><option value="">Все статусы</option><option value="active">Приём открыт</option><option value="closed">Приём завершён</option><option value="upcoming">Ожидается открытие</option><option value="unknown">Требует проверки</option></select></label>
              <div className="catalog-results-header">
                <h2>{filter === 'Все меры' ? 'Все возможности' : filter}</h2>
                <span>{visiblePrograms.length} в официальном каталоге</span>
                {filter !== 'Все меры' && (
                  <button onClick={() => setFilter('Все меры')}>
                    Сбросить <Icon name="close" size={13} />
                  </button>
                )}
              </div>
              <div className="filter-chips" aria-label="Виды мер поддержки">
                {['Все меры', ...new Set(officialFundingCatalog.map((o) => fundingKindLabels[o.kind]))].map((type) => (
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
                Условия проверены по официальным страницам; перед подачей сверяйте актуальную редакцию. Совпадение правил не подтверждает право на поддержку.
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
                        <span className="tag">{applicationLabels[applicationStatus(a, officialFundingCatalog.find((o) => o.id === a.programId)!)]} · не отправлено</span>
                        <h3>{p.title}</h3>
                        <p>
                          {count} из {p.documents.length} документов отмечено · срок{' '}
                          {date(p.deadline)}
                        </p>
                        <div className="progress">
                          <i style={{ width: `${(p.documents.length ? count / p.documents.length : 0) * 100}%` }} />
                        </div>
                      </div>
                      <ActionButton className="secondary" onClick={() => setSelected(p)}>
                        Продолжить <Icon name="arrow" size={17} />
                      </ActionButton>
                      <ActionButton className="text-button" onClick={() => { if (window.confirm('Удалить локальный черновик и отметки документов?')) setApps((old) => old.filter((item) => item.id !== a.id)); }}>Удалить черновик</ActionButton>
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
                  disabled={!officialFundingCatalog.some((o) => o.deadline)}
                  onClick={exportCalendar}
                >
                  <Icon name="download" size={17} />
                  Скачать сроки
                </ActionButton>
              </div>
              <div className="timeline">
                {programs.filter((p) => p.deadline)
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
                  Профиль и черновики хранятся в этом браузере. Данные ФНС доступны после импорта официальной выгрузки на сервере. Синхронизации с MAX пока нет.
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
                  <small>{assistantMode} · официальные источники</small>
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
                  <button className="text-button" onClick={() => setSelected(chatProgram)}>Открыть: {chatProgram.title}</button>
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
                    {!!m.opportunityIds?.length && <div className="message-links">{m.opportunityIds.map((id) => <ActionButton className="secondary" key={id} onClick={() => openFunding(id)}>Открыть: {programs.find((p) => p.id === id)!.title}</ActionButton>)}</div>}
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
                {['Что мне подходит?', 'Почему подходит?', 'Почему не подходит?', 'Какой следующий шаг?', 'Какие документы?', 'Какие сроки?', 'Можно подать сейчас?', 'Чем отличаются грант, кредит и поручительство?'].map(
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
          {page === 'overview' && <footer>
            <span className="footer-logo">опора.</span>
          </footer>}
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
        <div className="modal-toolbar">
          <button className="modal-close icon-button" aria-label="Закрыть" onClick={close}>
            <Icon name="close" />
          </button>
          <span>{onboard ? 'Профиль бизнеса' : activeApp ? 'Подготовка заявки' : 'Мера поддержки'}</span>
          {selected && <button
            className={'save-program ' + (saved.includes(selected.id) ? 'is-saved' : '')}
            aria-label={saved.includes(selected.id) ? 'Убрать из сохранённых' : 'Сохранить программу'}
            aria-pressed={saved.includes(selected.id)}
            onClick={() => toggleSaved(selected.id)}
          ><Icon name="bookmark" /></button>}
        </div>
        <div className="modal">
          {onboard && (
            <form onSubmit={saveProfile}>
              <span className="eyebrow">ПРОФИЛЬ БИЗНЕСА · ШАГ {step + 1} ИЗ 2</span>
              <h2>{step === 0 ? 'ИНН вашего бизнеса' : 'Данные для подбора'}</h2>
              <p className="muted">Источник: ФНС России. Поиск выполняется в официальном локальном индексе. Если данных нет, дополните профиль вручную.</p>
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
                          {['', 'ООО', 'АО', 'ИП', 'КФХ', 'другое'].map((value) => (
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
                    {step === 0 ? 'Продолжить' : 'Перейти к потребности'}
                    <Icon name="arrow" size={17} />
                  </ActionButton>
                </div>
              </fieldset>
            </form>
          )}
          {selected && (
            <>
              <div className={'detail-emblem ' + selected.id}>
                <Icon name={selected.icon} size={38} />
              </div>
              <span className="tag">{selected.type} · официальный источник</span>
              <h2>{selected.title}</h2>
              <p className="muted">{selected.description}</p>
              <OfficialDetails match={matches.find((m) => m.opportunity.id === selected.id)!} onAsk={() => { const program = selected; close(); void ask('Объясни следующий шаг', program, 'strategy'); }} />
              {activeApp ? (
                <>
                  <DetailSteps
                    prepared={selected.documents.filter((d) => activeApp.documents[d]).length}
                    total={selected.documents.length}
                    hasProject={!!activeApp.project.trim()}
                    hasBudget={Number(activeApp.budget) > 0}
                  />
                  <h3 id="application-documents">Подготовка документов</h3>
                  {!selected.documents.length && <p>Точный перечень документов не подтвержден. Сверьте комплект с официальным оператором.</p>}
                  <DocumentChecklist
                    key={`checklist:${selected.id}`}
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
                      key={`draft:${selected.id}`}
                      program={selected}
                      profile={profile}
                      app={activeApp}
                      onUpdate={(patch) => updateApp(activeApp.id, patch)}
                      onDownload={(text) => download(text, `opora-${selected.id}-document.txt`)}
                    />
                  )}
                  <label className="checklist-title"><input type="checkbox" checked={!!activeApp.reviewConfirmed} onChange={(e) => updateApp(activeApp.id, { reviewConfirmed: e.target.checked })} />Я сверил перечень и комплект с условиями оператора</label>
                  <p role="status">{applicationLabels[applicationStatus(activeApp, officialFundingCatalog.find((o) => o.id === selected.id)!)]}</p>
                  <div className="modal-actions">
                    <ActionButton className="secondary" onClick={() => { close(); setPage('applications'); }}>К моим заявкам</ActionButton>
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
                      Экспортировать черновик
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
                        ['expired', 'upcoming', 'not_eligible'].includes(matches.find((m) => m.opportunity.id === selected.id)!.status)
                      }
                      onClick={() => startApplication(selected)}
                    >
                      {profile ? 'Начать подготовку' : 'Добавить бизнес'}
                      <Icon name="arrow" size={17} />
                    </ActionButton>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </dialog>
      {exportText && <ModalSheet title="Экспорт текста" onClose={() => setExportText('')}><h2>Текст черновика</h2><p>Скопируйте текст в редактор и сохраните как TXT. Документ остаётся на вашем устройстве.</p><BusinessTextarea aria-label="Текст для экспорта" readOnly rows={12} value={exportText} /><div className="modal-actions"><ActionButton className="primary" onClick={() => navigator.clipboard.writeText(exportText).then(() => setToast('Текст скопирован')).catch(() => setToast('Выделите и скопируйте текст вручную.'))}>Копировать текст</ActionButton><ActionButton className="secondary" onClick={() => setExportText('')}>Закрыть</ActionButton></div></ModalSheet>}
      {projectOnboard && <ProjectOnboarding initial={projectProfile} onCancel={() => setProjectOnboard(false)} onSave={(project) => { setProjectProfile(project); setProfile(null); setNeed({ ...need, purpose: project.fundingPurpose, amount: project.fundingNeed }); setProjectOnboard(false); setPage('overview'); }} />}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
