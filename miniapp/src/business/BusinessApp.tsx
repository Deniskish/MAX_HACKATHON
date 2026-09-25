import { AssistantPage } from './AssistantPage';
import { GlassArt } from './GlassArt';
// Общее состояние экранов, профиля и заявок. Условия программ считаются в domain.
import { CompanySources, FieldSource } from './CompanySource';
import { editCompanyProfile, mergeCompanyProfile, requestCompanyData } from './company-data';
import { FundingExperience, FundingOpportunityCard, FundingResults } from './FundingExperience';
import { fundingFingerprint } from './funding';
import { OfficialDetails, ProjectOnboarding } from './OfficialExperience';
import { officialFundingCatalog } from '../../api-server/funding-catalog/official-catalog';
import { matchFundingOpportunity, rankFundingMatches } from '../../api-server/funding-catalog/matching';
import { toFundingProfile } from '../../api-server/funding-catalog/input';
import { fundingKindLabels } from '../../api-server/funding-catalog/presentation';
import type { FundingProfile, ProjectProfile, FundingResponse } from '../../api-server/funding-catalog/types';
import { loadWorkspace, saveWorkspace, projectAsProfile, applicationStatus, applicationLabels, calendarICS, fundingEvents, personalFunding, trackedFunding } from './workspace';
import {
  DocumentChecklist,
  DraftComposer,
} from './AgentExperience';
import { DetailSteps } from './VisualWidgets';
import { BusinessHub } from './BusinessHub';
import { useBusinessAnalysis } from './useBusinessAnalysis';
import { AdaptiveInsight } from './AdaptiveInsight';
import type { WorkspaceInsight } from '../../api-server/ai/types';
import { Icon } from './Icon';
import { ModalSheet } from './ModalSheet';
import { HomePage } from './HomePage';
import { AppHeader, AppNavigation, type AppPage as Page } from './AppChrome';
import { AIPanel, AIResultView } from './AIExperience';
import { requestAI, readAIHistory, saveAIHistory, type AIResult, type AIDocument } from './ai-client';
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

type Message = { role: 'user' | 'assistant'; text: string; opportunityIds?: string[]; result?: AIResult };


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
          const calendarUrl = new URL('/api/funding/calendar.ics', location.origin);
          if (!allCalendar) calendarUrl.searchParams.set('ids', calendarCatalog.map((o) => o.id).join(','));
          Promise.resolve(window.WebApp.downloadFile(calendarUrl.href, name))
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
  const [aiProjectSeed, setAIProjectSeed] = useState<ProjectProfile | null>(null);
  const [need, setNeed] = useState(initial.fundingNeed);
  const [fundingResult, setFundingResult] = useState<{ data: FundingResponse; fingerprint: string } | null>(null);
  const profile = companyProfile ?? (projectProfile ? projectAsProfile(projectProfile) : null);
  const fundingProfile: FundingProfile = projectProfile && !companyProfile
    ? { region: projectProfile.region, applicantType: 'project', stage: projectProfile.stage, industry: projectProfile.industry }
    : toFundingProfile(profile ?? emptyProfile);
  const [apps, setApps] = useState<Application[]>(initial.applications);
  const [deleteDraftId, setDeleteDraftId] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>(initial.saved);
  const [availability, setAvailability] = useState('');
  const [homePanel, setHomePanel] = useState<'business' | 'funding' | 'events' | null>(null);
  const [catalogScope, setCatalogScope] = useState<'personal' | 'all' | 'saved'>('personal');
  const [previousSnapshot] = useState<Record<string, string>>(() => readSaved('opora.snapshot.v2', {}));
  const matches = rankFundingMatches(officialFundingCatalog.map((o) => matchFundingOpportunity(fundingProfile, need, o, {
    preparedDocuments: Object.keys(apps.find((a) => a.programId === o.id)?.documents ?? {}).filter((d) => apps.find((a) => a.programId === o.id)?.documents[d]),
  })));
  const events = fundingEvents(officialFundingCatalog, saved, previousSnapshot, matches);
  const personal = personalFunding(matches, !!profile);
  const tracked = trackedFunding(officialFundingCatalog, saved, apps);
  const [allCalendar, setAllCalendar] = useState(false);
  const calendarCatalog = allCalendar ? officialFundingCatalog : tracked;
  const calendarPrograms = programs.filter((p) => p.deadline && calendarCatalog.some((o) => o.id === p.id));
  function navigate(next: Page) {
    setHomePanel(null);
    if (['assistant', 'calendar'].includes(next) && !profile) { setPage('profile'); return; }
    if (next === 'programs') { setCatalogScope(profile ? 'personal' : 'all'); setOnlySaved(false); setFilter('Все меры'); setQuery(''); setAvailability(''); }
    if (next === 'calendar') setAllCalendar(false);
    setPage(next);
  }
  const [sourceUpdates, setSourceUpdates] = useState<{ id: string; url: string; title: string; detectedAt: string; opportunityId?: string; kind: string }[]>([]);
  const notificationUpdates = sourceUpdates.filter((update) => update.opportunityId && saved.includes(update.opportunityId));
  const hasNotifications = events.length > 0 || notificationUpdates.length > 0;
  const analysisContext = profile ? { profile: fundingProfile, need: need.purpose ? need : undefined,
    identifiers: { name: profile.name, inn: profile.inn }, page: 'workspace',
    workspace: { savedIds: saved, applications: apps.map((a) => ({ programId: a.programId, project: a.project.slice(0, 2000),
      budget: a.budget.trim() && Number.isSafeInteger(Number(a.budget)) && Number(a.budget) >= 0 && Number(a.budget) <= 1e15 ? Number(a.budget) : null,
      preparedDocuments: Object.keys(a.documents).filter((d) => a.documents[d]), hasDraft: !!a.generatedDraft?.trim(), reviewConfirmed: !!a.reviewConfirmed })) } } : null;
  const businessAnalysis = useBusinessAnalysis(analysisContext, officialFundingCatalog.map((o) => `${o.id}:${o.version}`).join('|') + sourceUpdates.map((u) => u.id).join('|'));
  const aiPriorities = businessAnalysis.data?.personalization?.priorities ?? [];
  const priorityRank = (id: string) => { const index = aiPriorities.findIndex((p) => p.programId === id); return index < 0 ? 100 : index; };
  function followInsight(action: WorkspaceInsight['action']) {
    if (action === 'funding') setHomePanel(profile ? 'funding' : 'business');
    else if (action === 'profile') openProfile();
    else navigate(action);
  }
  const [sourcesCheckedAt, setSourcesCheckedAt] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => fetch('/api/funding/updates', { signal: controller.signal }).then((r) => r.ok ? r.json() : null).then((data) => {
      if (data && !controller.signal.aborted) {
        setSourceUpdates(Array.isArray(data.updates) ? data.updates.filter((u: any) => u && typeof u.id === 'string' && typeof u.title === 'string' && typeof u.url === 'string' && u.url.startsWith('https://')).slice(0, 30) : []);
        setSourcesCheckedAt(typeof data.checkedAt === 'string' ? data.checkedAt : null);
      }
    }).catch(() => {});
    void refresh(); const timer = setInterval(() => void refresh(), 5 * 60 * 1000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  useEffect(() => { try { localStorage.setItem('opora.snapshot.v2', JSON.stringify(Object.fromEntries(officialFundingCatalog.map((o) => [o.id, o.version])))); } catch { /* Workspace storage warning handles unavailable storage. */ } }, []);
  const openFunding = (id: string) => { const p = programs.find((p) => p.id === id); if (p) { setHomePanel(null); setSelected(p); } };
  const [onlySaved, setOnlySaved] = useState(false);
  const [selected, setSelected] = useState<Program | null>(
    () =>
      programs.find((p) => p.id === (new URLSearchParams(window.location.search).get('program') || new URLSearchParams(window.location.search).get('WebAppStartParam'))) ||
      null,
  );
  const [chatProgram, setChatProgram] = useState<Program | null>(null);
  const [applicationDocuments, setApplicationDocuments] = useState<Record<string, AIDocument>>({});
  useEffect(() => setApplicationDocuments({}), [selected?.id]);
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
  const [messages, setMessages] = useState<Message[]>(() => readAIHistory());
  const chatRequest = useRef<AbortController | null>(null);
  useEffect(() => { if (!saveAIHistory(messages)) setToast('История чата не сохранилась на устройстве.'); }, [messages]);
  useEffect(() => () => chatRequest.current?.abort(), []);
  useEffect(() => {
    if (chatRequest.current) { chatRequest.current.abort(); chatRequest.current = null; setSending(false); }
  }, [companyProfile, projectProfile, need]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [assistantMode, setAssistantMode] = useState('Проверяем доступность GigaChat');
  useEffect(() => { const controller = new AbortController(); fetch('/api/ai/status', { signal: controller.signal }).then((r) => r.json()).then((data) => setAssistantMode(data.status === 'ready' ? 'GigaChat подключён' : data.configured ? 'GigaChat настроен · соединение ещё не подтверждено' : 'GigaChat не настроен')).catch(() => { if (!controller.signal.aborted) setAssistantMode('Статус AI недоступен'); }); return () => controller.abort(); }, []);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [page]);
  useEffect(() => { dialogRef.current?.querySelector('.modal')?.scrollTo({ top: 0 }); }, [selected?.id, onboard, step]);

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
    setAvailability('');
    setCatalogScope('all');
    setPage('programs');
  };
  const visiblePrograms = (profile ? matches.map((m) => ranked.find(({ p }) => p.id === m.opportunity.id)!) : ranked)
    .sort((a, b) => profile && catalogScope === 'personal' ? priorityRank(a.p.id) - priorityRank(b.p.id) : 0).filter(
    ({ p }) =>
      (filter === 'Все меры' || p.type === filter) &&
      (!onlySaved || saved.includes(p.id)) &&
      (!profile || catalogScope !== 'personal' || personal.candidates.some((m) => m.opportunity.id === p.id)) &&
      (!availability || officialFundingCatalog.find((o) => o.id === p.id)?.status === availability) &&
      `${p.title} ${p.description} ${p.type}`.toLowerCase().includes(query.toLowerCase()),
  );
  const activeApp = selected ? apps.find((a) => a.programId === selected.id) : undefined;
  const openProfile = () => {
    setHomePanel(null);
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
      setHomePanel('business');
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
    setCatalogScope('personal');
  }
  const aiContext = { profile: fundingProfile, need: need.purpose ? need : undefined, page, workspace: analysisContext?.workspace,
    identifiers: profile ? { name: profile.name, inn: profile.inn } : undefined };
  function applyAIProfile(patch: FundingProfile) {
    setHomePanel(null); setSelected(null);
    if ((!companyProfile && projectProfile) || ['project', 'team', 'individual'].includes(patch.applicantType ?? '')) {
      setAIProjectSeed({ name: projectProfile?.name ?? '', region: patch.region ?? projectProfile?.region ?? '',
        industry: patch.industry ?? projectProfile?.industry ?? '', stage: (patch.stage as ProjectProfile['stage']) || projectProfile?.stage || 'idea',
        teamSize: patch.employees ?? projectProfile?.teamSize ?? null, fundingNeed: need.amount, fundingPurpose: need.purpose, hasLegalEntity: false });
      setProjectOnboard(true);
    } else {
      setForm({ ...(companyProfile ?? emptyProfile), ...patch }); setStep(companyProfile?.inn ? 1 : 0); setOnboard(true);
    }
  }
  const aiHandlers = { onOpen: openFunding, onNeed: setNeed, onProfile: applyAIProfile,
    onFunding: () => setHomePanel(profile ? 'funding' : 'business'),
    onPrepare: (id: string) => { const p = programs.find((x) => x.id === id); if (p) { setHomePanel(null); setSelected(p); startApplication(p); } } };
  // Контекст программы, проекта и последних сообщений передаётся общему AI-сервису.
  async function ask(
    text: string,
    program: Program | null = chatProgram,
    task?: 'strategy' | 'documents',
  ) {
    if (!profile) { navigate('profile'); return; }
    if (!text.trim() || sending) return;
    setPage('assistant');
    setChatProgram(program);
    setQuestion('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setSending(true);
    const controller = new AbortController(); chatRequest.current = controller;
    const application = apps.find((a) => a.programId === program?.id);
    try {
      const data = await requestAI({ task: task === 'strategy' ? 'strategy' : 'chat', question: text,
        history: messages.slice(-8).map(({ role, text }) => ({ role, text })),
        context: { ...aiContext, programId: program?.id, project: application?.project, draft: application?.generatedDraft,
          preparedDocuments: application && program ? program.documents.filter((d) => application.documents[d]) : [],
          budget: application?.budget.trim() ? Number(application.budget) : null } },
        AbortSignal.any([controller.signal, AbortSignal.timeout(70000)]));
      if (controller.signal.aborted || chatRequest.current !== controller) return;
      setMessages((m) => [...m.slice(-29), { role: 'assistant', text: data.answer, result: data }]);
      setAssistantMode(data.mode === 'llm' ? 'GigaChat · контекстный помощник' : 'Ответ по правилам');
    } catch (error) {
      if (controller.signal.aborted || chatRequest.current !== controller) return;
      setMessages((m) => [...m, { role: 'assistant', text: `${error instanceof Error && error.name === 'TimeoutError' ? 'Помощник не успел ответить.' : 'Не удалось получить ответ помощника.'} Попробуйте отправить вопрос ещё раз. Подбор по условиям программ доступен в разделе поддержки.` }]);
      setAssistantMode('GigaChat временно недоступен');
    } finally {
      if (chatRequest.current === controller) { chatRequest.current = null; setSending(false); }
    }
  }
  // Экспортируем только опубликованные в каталоге сроки, в том числе архивные.
  function exportCalendar() { download(calendarICS(calendarCatalog), 'opora-calendar.ics', 'text/calendar;charset=utf-8'); }
  function programCard(p: Program) {
    const match = matches.find((m) => m.opportunity.id === p.id)!;
    return <FundingOpportunityCard key={p.id} match={match} onOpen={openFunding} onSave={toggleSaved} saved={saved.includes(p.id)} personalized={!!profile}
      aiReason={profile ? aiPriorities.find((item) => item.programId === p.id)?.reason : undefined} />;
  }

  return (
    <div className={`app-shell page-${page}`}>
      {page !== 'overview' && page !== 'assistant' && <AppHeader
        title={{ programs: 'Меры поддержки', applications: 'Мои заявки', calendar: 'Календарь', profile: 'Мой бизнес', 'funding-results': 'Варианты поддержки' }[page]}
        backLabel={page === 'funding-results' ? 'К параметрам подбора' : page === 'calendar' ? 'В мой бизнес' : 'На главную'} onBack={() => page === 'funding-results' ? setHomePanel('funding') : navigate(page === 'calendar' ? 'profile' : 'overview')} onNotifications={() => setHomePanel('events')} hasNotifications={hasNotifications}
      />}
      <main ref={mainRef} className="app-content">
          {page === 'funding-results' && profile && <section className="funding-results-page">
            {fundingResult?.fingerprint === fundingFingerprint(fundingProfile, need) ? <>
              <div className="funding-result-intro"><div className="funding-result-mark"><GlassArt shape="ring" size={80} /></div><h2>{need.purpose}</h2>
                <p>{profile.name}{need.amount ? ` · ${need.amount.toLocaleString('ru-RU')} ₽` : ''}{need.preferredTermMonths ? ` · ${need.preferredTermMonths} мес.` : ''}</p>
                <ActionButton className="secondary" onClick={() => setHomePanel('funding')}>Изменить параметры</ActionButton>
              </div>
              <FundingResults result={fundingResult.data} onOpen={openFunding} onSave={toggleSaved} saved={saved} />
              <ActionButton className="secondary" onClick={() => void ask('Кратко сравни найденные варианты для моей цели, суммы и срока. Что стоит рассмотреть и что нужно уточнить?', null, 'strategy')}>Обсудить варианты с AI</ActionButton>
            </> : <section className="empty-state"><h2>Обновите подбор</h2><p>Параметры бизнеса или задачи изменились. Выполните подбор заново, чтобы увидеть актуальные варианты.</p><ActionButton className="primary" onClick={() => setHomePanel('funding')}>Подобрать заново</ActionButton></section>}
          </section>}
          {page === 'overview' && <HomePage
            onFindSupport={() => navigate('programs')}
            onAddBusiness={() => profile ? navigate('profile') : setHomePanel('business')}
            onOpportunities={() => profile ? setHomePanel('funding') : browse()}
            onNotifications={() => setHomePanel('events')}
            onApplications={() => setPage('applications')}
            onBusiness={() => navigate('profile')} personalized={!!profile}
            analysis={businessAnalysis} onAIAction={followInsight}
            hasNotifications={hasNotifications}
          />}
          {page === 'programs' && (
            <>
              {profile ? <><AdaptiveInsight analysis={businessAnalysis} section="programs" onAction={followInsight} /><div className="catalog-glass-context"><details className="catalog-personal-context"><summary>{profile.name}</summary><p>{profile.region} · {need.purpose || 'Укажите цель для более точного подбора'}</p><button onClick={() => setHomePanel('funding')}>Изменить цель и параметры подбора <Icon name="arrow" size={14} /></button></details><GlassArt shape="ring" size={88} /></div></>
                : <section className="catalog-guest-context"><div><button onClick={() => navigate('profile')}>Подобрать поддержку для моего бизнеса <Icon name="arrow" size={14} /></button></div><GlassArt shape="ring" size={104} /></section>}
              {profile && <div className="catalog-scopes" aria-label="Область подбора">{([['personal', 'Для вас'], ['all', 'Все меры'], ['saved', `Сохранённые · ${saved.length}`]] as const).map(([scope, title]) => <button key={scope} aria-pressed={catalogScope === scope} onClick={() => { setCatalogScope(scope); setOnlySaved(scope === 'saved'); }}>{title}</button>)}</div>}
              <div className="catalog-toolbar">
                {!profile && <div className="segmented-control" aria-label="Показать программы">
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
                </div>}
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
              {profile && <details className="ai-entry"><summary>Найти поддержку по описанию задачи</summary><AIPanel title="Умный поиск" task="search" context={aiContext} initialQuestion={query} {...aiHandlers} /></details>}
              <div className="catalog-results-header">
                <h2>{filter === 'Все меры' ? profile && catalogScope === 'personal' ? 'Для вашего бизнеса' : 'Все возможности' : filter}</h2>
                <span>{visiblePrograms.length} программ</span>
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
                    {type === 'Все меры' ? 'Все виды' : type}
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
                      setOnlySaved(false); setCatalogScope('all');
                      setAvailability('');
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
          {page === 'applications' && !profile && <section className="empty-state guest-applications"><GlassArt shape="tiles" size={120} /><h2>Заявки вашего бизнеса</h2><p>Добавьте бизнес, чтобы подготовить заявку.</p><ActionButton className="primary" onClick={() => setHomePanel('business')}>Добавить бизнес</ActionButton><ActionButton className="secondary" onClick={() => browse()}>Посмотреть программы</ActionButton></section>}
          {page === 'applications' && profile &&
            <AdaptiveInsight analysis={businessAnalysis} section="applications" onAction={followInsight} />}
          {page === 'applications' && profile &&
            (apps.length ? (
              <div className="application-list">
                {[...apps].sort((a, b) => priorityRank(a.programId) - priorityRank(b.programId)).map((a) => {
                  const p = programs.find((p) => p.id === a.programId)!;
                  const count = p.documents.filter((d) => a.documents[d]).length;
                  return (
                    <article className="application-row" key={a.id}>
                      <GlassArt shape="tiles" size={54} className="application-art" />
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
                      <ActionButton className="text-button" onClick={() => setDeleteDraftId(a.id)}>Удалить черновик</ActionButton>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state">
                <GlassArt shape="tiles" size={120} />
                <h2>Пока нет заявок</h2>
                <ActionButton className="primary" onClick={() => navigate('programs')}>
                  Выбрать программу <Icon name="arrow" size={17} />
                </ActionButton>
              </div>
            ))}
          {page === 'calendar' && profile && (
            <>
              <AdaptiveInsight analysis={businessAnalysis} section="calendar" onAction={followInsight} />
              <p className="calendar-context">{profile.name}</p>
              <div className="catalog-scopes"><button aria-pressed={!allCalendar} onClick={() => setAllCalendar(false)}>Мои сроки</button><button aria-pressed={allCalendar} onClick={() => setAllCalendar(true)}>Весь каталог</button></div>
              {!calendarPrograms.length && <section className="empty-state"><GlassArt shape="ring" size={104} /><h2>Опубликованных сроков нет</h2><p>{tracked.length ? 'У выбранных программ нет точных дат в каталоге. Сверяйте сроки на сайте оператора.' : 'Сохраните программу или начните подготовку заявки — её опубликованный срок появится здесь.'}</p><ActionButton className="secondary" onClick={() => navigate('programs')}>Найти поддержку</ActionButton></section>}
              <div className="section-title">
                <ActionButton
                  className="secondary"
                  disabled={!calendarPrograms.length}
                  onClick={exportCalendar}
                >
                  <Icon name="download" size={17} />
                  Скачать сроки
                </ActionButton>
              </div>
              <div className="timeline">
                {calendarPrograms
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
          {page === 'profile' && <BusinessHub profile={profile} project={!!projectProfile && !companyProfile}
            insight={businessAnalysis.data?.personalization?.sections.home} onInsight={followInsight}
            confirmed={personal.confirmed.length} pending={personal.pending.length} applications={apps.length} saved={saved.length} purpose={need.purpose}
            onAdd={() => setHomePanel('business')} onEdit={openProfile} onSupport={() => navigate('programs')}
            onNeed={() => setHomePanel('funding')} onAssistant={() => navigate('assistant')} onCalendar={() => navigate('calendar')}
            onApplications={() => navigate('applications')} onSaved={() => { navigate('programs'); setCatalogScope('saved'); setOnlySaved(true); }} />}
          {page === 'profile' && profile && <details className="ai-entry"><summary>Проанализировать бизнес и следующий шаг</summary><AIPanel title="План развития" task="analysis" context={aiContext} initialQuestion="Проанализируй мой бизнес: какие возможности рассмотреть, чего не хватает и какой следующий шаг?" {...aiHandlers} /></details>}
          {page === 'profile' && profile && <details className="ai-entry source-updates">
            <summary>Изменения в поддержке · разбор с AI</summary>
            <p>{sourcesCheckedAt ? `Последняя проверка: ${new Date(sourcesCheckedAt).toLocaleString('ru-RU')}.` : 'Первая проверка источников ещё не завершена.'} Изменение страницы требует сверки условий программы.</p>
            {sourceUpdates.length ? sourceUpdates.map((update) => <article className="ai-proposal" key={update.id}>
              <span className="tag">{update.kind === 'discovered' ? 'Найден новый материал' : saved.includes(update.opportunityId ?? '') ? 'По сохранённой программе' : 'Изменилась страница'}</span>
              <p><a href={update.url} target="_blank" rel="noreferrer">{update.title} ↗</a></p>
              <ActionButton className="secondary" disabled={sending} onClick={() => {
                void ask(`Оцени, как актуальные материалы по теме «${update.title}» влияют на мой бизнес. Укажи, что подтверждено и что требует проверки.`, programs.find((program) => program.id === update.opportunityId) ?? null, 'strategy');
              }}>Объяснить влияние с AI</ActionButton>
            </article>) : <p>Новых материалов для разбора пока нет.</p>}
          </details>}
          {page === 'profile' &&
            (profile ? (
              <details className="profile-panel"><summary>Сведения о бизнесе</summary>
                <div className="section-title">
                  <div>
                    <span className="tag">{companyProfile ? 'Профиль бизнеса' : 'Проект без компании'}</span>
                    <h2>{profile.name}</h2>
                  </div>
                  <ActionButton className="secondary" onClick={openProfile}>
                    Редактировать
                  </ActionButton>
                </div>
                {companyProfile && <><CompanySources profile={profile} /><FieldSource profile={profile} field="name" /></>}
                {projectProfile && !companyProfile ? <dl className="profile-grid">
                  {[
                    ['Регион', projectProfile.region],
                    ['Направление', projectProfile.industry],
                    ['Стадия', { idea: 'Идея', prototype: 'Прототип', mvp: 'MVP', revenue: 'Есть выручка проекта' }[projectProfile.stage]],
                    ['Команда', projectProfile.teamSize === null ? 'Не указана' : `${projectProfile.teamSize} чел.`],
                    ['Цель финансирования', need.purpose || 'Не указана'],
                    ['Требуемая сумма', need.amount === null ? 'Не указана' : `${need.amount.toLocaleString('ru-RU')} ₽`],
                  ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl> : <>
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
                  {profile.goals.length === 0 && <span className="muted">Добавьте цели в профиле бизнеса.</span>}
                </div>
                </>}
                <div className="data-note">
                  Профиль и черновики сохранены на этом устройстве. На другом устройстве их потребуется заполнить заново.
                </div>
              </details>
            ) : null)}
          {page === 'assistant' && profile && <AssistantPage
            businessName={profile.name} status={assistantMode} messages={messages} question={question} onQuestion={setQuestion}
            sending={sending} onSend={(text) => { void ask(text); }} onBack={() => navigate('profile')}
            onStop={() => { chatRequest.current?.abort(); chatRequest.current = null; setSending(false); }}
            onClear={() => { chatRequest.current?.abort(); chatRequest.current = null; setSending(false); setMessages([]); setChatProgram(null); setQuestion(''); }}
            program={chatProgram ? { title: chatProgram.title, onOpen: () => setSelected(chatProgram), onRemove: () => setChatProgram(null) } : undefined}
            context={(closeInfo) => <>
              <p><b>{profile.name}</b> · {profile.region}<br />Цель: {need.purpose || 'пока не указана'}. Ответы учитывают этот профиль.</p>
              <AdaptiveInsight analysis={businessAnalysis} section="assistant" onAction={(action) => { closeInfo(); followInsight(action); }} compact />
              <p>GigaChat получает вопрос, последние сообщения, параметры бизнеса и выбранной заявки. Известные реквизиты скрываются. Не добавляйте лишние персональные данные. История сохраняется на этом устройстве.</p>
            </>}
            renderMessage={(index) => {
              const message = messages[index];
              return <>{message.text}
                {message.result && <AIResultView result={message.result} {...aiHandlers} showAnswer={false} onQuestion={setQuestion} />}
                {!!message.opportunityIds?.length && <div className="message-links">{message.opportunityIds.map((id) => <ActionButton className="secondary" key={id} onClick={() => openFunding(id)}>Открыть: {programs.find((program) => program.id === id)?.title ?? 'Программа'}</ActionButton>)}</div>}
              </>;
            }}
          />}
      </main>
      {page !== 'overview' && page !== 'assistant' && <AppNavigation active={page} onNavigate={navigate} />}
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
              <h2>{step === 0 ? 'ИНН вашего бизнеса' : 'Данные для подбора'}</h2>
              <p className="muted">Шаг {step + 1} из 2</p>
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
                          {['', 'УСН', 'ОСНО', 'ПСН', 'ЕСХН', 'АУСН', 'СРП'].map((t) => (
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
                {form.inn && step === 0 && (
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
                    {step === 0 ? 'Заполнить вручную' : 'Сохранить бизнес'}
                    <Icon name="arrow" size={17} />
                  </ActionButton>
                </div>
                {step === 1 && <p className="widget-footnote">После сохранения GigaChat анализирует параметры бизнеса и подстраивает все разделы. Известные реквизиты скрываются; исходные файлы автоматически не отправляются.</p>}
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
              <OfficialDetails personalized={!!profile} match={matches.find((m) => m.opportunity.id === selected.id)!} onAsk={() => { const program = selected; close(); void ask('Объясни следующий шаг', program, 'strategy'); }} />
              {activeApp && profile ? (
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
                    profile={profile}
                    documents={applicationDocuments}
                    setDocuments={setApplicationDocuments}
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
                      documents={Object.values(applicationDocuments).filter((d) => d.pages.some((p) => p.text.trim()))}
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
                        profile ? openProfile() : setHomePanel('business');
                      }}
                    >
                      {profile ? 'Уточнить профиль' : 'Проверить для моего бизнеса'}
                    </ActionButton>
                    <ActionButton
                      className="primary"
                      disabled={
                        !!profile && ['expired', 'upcoming', 'not_eligible'].includes(matches.find((m) => m.opportunity.id === selected.id)!.status)
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
      {homePanel && <ModalSheet title={{ business: 'Ваш бизнес', funding: 'Подбор поддержки', events: 'Уведомления' }[homePanel]} onClose={() => setHomePanel(null)}>
        {homePanel === 'business' && <div className="home-panel-actions">
          <h2>Расскажите о бизнесе</h2>
          <details className="ai-entry"><summary>Заполнить с помощью AI</summary><AIPanel title="Расскажите своими словами" task="intake" context={aiContext} {...aiHandlers} /></details>
          <ActionButton className="primary" onClick={openProfile}>{profile ? 'Редактировать профиль' : 'Добавить компанию по ИНН'}</ActionButton>
          <ActionButton className="secondary" onClick={() => { setHomePanel(null); setProjectOnboard(true); }}>У меня пока нет компании</ActionButton>
        </div>}
        {homePanel === 'funding' && profile && <>
          <FundingExperience key={companyProfile?.inn ?? 'project'} profile={fundingProfile} initialNeed={need} onNeed={setNeed} onOpen={openFunding} onResult={(data, fingerprint) => {
            setFundingResult({ data, fingerprint }); setHomePanel(null); setPage('funding-results');
          }} />
        </>}
        {homePanel === 'events' && <div className="home-panel-actions events-panel">
          {!hasNotifications && <p>Новых уведомлений пока нет.</p>}
          {events.map((event) => <button className="widget-link-row" key={event.id} onClick={() => openFunding(event.opportunityId)}>{event.text}</button>)}
          {notificationUpdates.map((update) => <a className="widget-link-row" key={update.id} href={update.url} target="_blank" rel="noreferrer">Обновился источник по сохранённой программе: {update.title} ↗</a>)}
        </div>}
      </ModalSheet>}
      {deleteDraftId && <ModalSheet title="Удалить черновик?" onClose={() => setDeleteDraftId(null)}>
        <h2>Удалить черновик?</h2>
        <p>Текст, выбранные файлы и отметки документов будут удалены из этого браузера.</p>
        <div className="modal-actions">
          <ActionButton className="secondary" onClick={() => setDeleteDraftId(null)}>Оставить черновик</ActionButton>
          <ActionButton className="primary danger-button" onClick={() => {
            setApps((old) => old.filter((item) => item.id !== deleteDraftId));
            setDeleteDraftId(null); setToast('Черновик удалён');
          }}>Удалить</ActionButton>
        </div>
      </ModalSheet>}
      {projectOnboard && <ProjectOnboarding initial={aiProjectSeed ?? projectProfile} onCancel={() => { setProjectOnboard(false); setAIProjectSeed(null); }} onSave={(project) => { setProjectProfile(project); setProfile(null); setNeed({ ...need, purpose: project.fundingPurpose, amount: project.fundingNeed }); setProjectOnboard(false); setAIProjectSeed(null); setPage('overview'); setCatalogScope('personal'); }} />}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
