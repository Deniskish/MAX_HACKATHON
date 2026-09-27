import { ProgrammeDetails } from './ProgrammeDetails';
import { fundingKindLabels } from '../../api-server/funding-catalog/presentation';
import { SettingsPage } from './SettingsPage';
import { BusinessInformation } from './BusinessInformation';
import { CalendarPage } from './CalendarPage';
import { ApplicationsPage } from './ApplicationsPage';
import { CompanyProfileForm } from './CompanyProfileForm';
import type { FundingOpportunity } from '../../api-server/funding-catalog/types';
import { AssistantPage } from './AssistantPage';
import { BusinessDetailsPage } from './BusinessDetailsPage';

// Общее состояние экранов, профиля и заявок. Условия программ считаются в domain.
import { editCompanyProfile, mergeCompanyProfile, requestCompanyData } from './company-data';
import { FundingExperience, FundingOpportunityCard } from './FundingExperience';
import { ProjectOnboarding } from './OfficialExperience';
import { useLiveCatalog } from './live-catalog';
import { useSupportNotifications } from './SupportNotifications';
import { useAccount } from './AccountPanel';
import { CataloguePage } from './CataloguePage';
import { useScreenHistory } from './useScreenHistory';
import { matchFundingOpportunity, rankFundingMatches } from '../../api-server/funding-catalog/matching';
import { toFundingProfile } from '../../api-server/funding-catalog/input';
import type { FundingProfile, ProjectProfile } from '../../api-server/funding-catalog/types';
import { loadWorkspace, saveWorkspace, removeBusiness, businessAddedNotice, projectAsProfile, calendarICS, personalFunding, trackedFunding } from './workspace';

import { BusinessHub } from './BusinessHub';
import { useBusinessAnalysis } from './useBusinessAnalysis';
import { AdaptiveInsight } from './AdaptiveInsight';
import type { WorkspaceInsight } from '../../api-server/ai/types';
import { Icon } from './Icon';
import { ModalSheet } from './ModalSheet';
import { HomePage } from './HomePage';
import { useTabTransition } from './useTabTransition';
import { AppHeader, AppNavigation, navigationTab, type MainTab, type AppPage as Page } from './AppChrome';
import { AIResultView } from './AIExperience';
import { aiErrorMessage, requestAI, readAIHistory, saveAIHistory, type AIResult } from './ai-client';
import { ActionButton, BusinessTextarea } from './MaxControls';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  type Profile,
  type Application,
  emptyProfile,
  validInn,
} from './domain';

type Message = { role: 'user' | 'assistant'; text: string; opportunityIds?: string[]; result?: AIResult; applicationId?: string };


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
  const { catalog: officialFundingCatalog } = useLiveCatalog();
  const programs = officialFundingCatalog;
  const [catalogLimit, setCatalogLimit] = useState(30);
  const [exportText, setExportText] = useState('');
  function download(text: string, name: string, type = 'text/plain;charset=utf-8') {
    if (window.WebApp?.initData) {
      if (type.startsWith('text/calendar') && window.WebApp.downloadFile && location.protocol === 'https:') {
        try {
          const calendarUrl = new URL('/api/funding/calendar.ics', location.origin);
          if (!allCalendar) calendarUrl.searchParams.set('ids', calendarCatalog.map((o) => o.id).join(','));
          Promise.resolve(window.WebApp.downloadFile(calendarUrl.href, name))
            .catch(() => setToast('Откройте приложение в браузере, чтобы скачать календарь.'));
        } catch { setToast('Откройте приложение в браузере, чтобы скачать календарь.'); }
      } else { setSelected(null); setExportText(text); }
    } else browserDownload(text, name, type);
  }
  const [page, setPageState] = useState<Page>('overview');
  const [activeTab, setActiveTab] = useState<MainTab>('overview');
  const [settingsReturn, setSettingsReturn] = useState<Page>('overview');
  const [catalogToolsOpen, setCatalogToolsOpen] = useState(false);
  function openSettings() { setSettingsReturn(page); navigate('settings'); }
  const { shell, prepare } = useTabTransition(page);
  const setPage = (next: Page) => { prepare(next); const tab = navigationTab(next); if (tab) setActiveTab(tab); setPageState(next); };
  const [initial] = useState(() => loadWorkspace(localStorage, programs.map((p) => p.id)));
  const [companyProfile, setProfile] = useState<Profile | null>(initial.profile);
  useEffect(() => {
    if (!companyProfile?.region) return;
    const controller = new AbortController();
    void fetch('/api/funding/interest', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region: companyProfile.region }), signal: controller.signal }).catch(() => {});
    return () => controller.abort();
  }, [companyProfile?.region]);
  const account = useAccount();
  const [savingCompany, setSavingCompany] = useState(false);
  const [businessNotice, setBusinessNotice] = useState(initial.businessNotice ?? null);
  const [deletingBusiness, setDeletingBusiness] = useState(false);
  const [projectProfile, setProjectProfile] = useState<ProjectProfile | null>(initial.projectProfile);
  const [projectOnboard, setProjectOnboard] = useState(false);
  const [aiProjectSeed, setAIProjectSeed] = useState<ProjectProfile | null>(null);
  const [need, setNeed] = useState(initial.fundingNeed);
  const profile = companyProfile ?? (projectProfile ? projectAsProfile(projectProfile) : null);
  const fundingProfile: FundingProfile = projectProfile && !companyProfile
    ? { region: projectProfile.region, applicantType: 'project', stage: projectProfile.stage, industry: projectProfile.industry }
    : toFundingProfile(profile ?? emptyProfile);
  const supportNotifications = useSupportNotifications(profile ? fundingProfile : null, need);
  const [apps, setApps] = useState<Application[]>(initial.applications);
  const [deleteBusinessOpen, setDeleteBusinessOpen] = useState(false);
  const [deleteBusinessError, setDeleteBusinessError] = useState('');
  const [detachedApplicationIds, setDetachedApplicationIds] = useState<string[]>(initial.detachedApplicationIds ?? []);
  const businessApps = apps.filter((app) => !detachedApplicationIds.includes(app.id));
  const [deleteDraftId, setDeleteDraftId] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>(initial.saved);
  const [availability, setAvailability] = useState('');
  const [homePanel, setHomePanel] = useState<'business' | 'funding' | null>(null);
  const [catalogScope, setCatalogScope] = useState<'personal' | 'all' | 'saved'>('personal');
  const matches = useMemo(() => rankFundingMatches(officialFundingCatalog.map(o => matchFundingOpportunity(fundingProfile, need, o))), [officialFundingCatalog, JSON.stringify(fundingProfile), need]);
  const matchesById = useMemo(() => new Map(matches.map(m => [m.opportunity.id, m])), [matches]);
  const programsById = useMemo(() => new Map(programs.map(p => [p.id, p])), [programs]);
  const personalIds = new Set(personalFunding(matches, !!profile).candidates.map(m => m.opportunity.id));
  const tracked = trackedFunding(officialFundingCatalog, saved, apps);
  const [allCalendar, setAllCalendar] = useState(false);
  const calendarCatalog = allCalendar ? officialFundingCatalog : tracked;
  const calendarPrograms = programs.filter((p) => p.deadline && calendarCatalog.some((o) => o.id === p.id));
  function navigate(next: Page) {
    setHomePanel(null);
    if (next === 'calendar' && !profile) { setPage('profile'); return; }
    if (next === 'assistant') rememberAssistantOrigin();
    if (next === 'calendar') setAllCalendar(false);
    setPage(next);
  }
  const analysisContext = profile ? { profile: fundingProfile, need: need.purpose ? need : undefined,
    identifiers: { name: profile.name, inn: profile.inn }, page: 'workspace',
    workspace: { savedIds: saved.filter((id) => programs.some((p) => p.id === id)).slice(-50), applications: businessApps.filter((a) => programs.some((p) => p.id === a.programId)).slice(-30).map((a) => ({ programId: a.programId, project: a.project.slice(0, 2000),
      budget: a.budget.trim() && Number.isSafeInteger(Number(a.budget)) && Number(a.budget) >= 0 && Number(a.budget) <= 1e15 ? Number(a.budget) : null,
      preparedDocuments: Object.keys(a.documents).filter((d) => a.documents[d]), hasDraft: !!a.generatedDraft?.trim(), reviewConfirmed: !!a.reviewConfirmed })) } } : null;
  const businessAnalysis = useBusinessAnalysis(analysisContext, officialFundingCatalog.map((o) => `${o.id}:${o.version}:${o.status}`).join('|'), page === 'assistant');
  const aiPriorities = businessAnalysis.data?.personalization?.priorities ?? [];
  const personal = personalFunding(matches, !!profile);
  const priorityRank = (id: string) => { const index = aiPriorities.findIndex((p) => p.programId === id); return index < 0 ? 100 : index; };
  function followInsight(action: WorkspaceInsight['action']) {
    if (action === 'funding') setHomePanel(profile ? 'funding' : 'business');
    else if (action === 'profile') openProfile();
    else navigate(action);
  }
  useEffect(() => { try { localStorage.setItem('opora.snapshot.v2', JSON.stringify(Object.fromEntries(officialFundingCatalog.map((o) => [o.id, o.version])))); } catch { /* Workspace storage warning handles unavailable storage. */ } }, []);
  const openFunding = (id: string) => { const p = programs.find((p) => p.id === id); if (p) { setHomePanel(null); setSelected(p); } };
  const [onlySaved, setOnlySaved] = useState(false);
  const [selected, setSelected] = useState<FundingOpportunity | null>(
    () =>
      programs.find((p) => p.id === (new URLSearchParams(window.location.search).get('program') || new URLSearchParams(window.location.search).get('WebAppStartParam'))) ||
      null,
  );
  const openedProgramLink = useRef(false);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('program') || new URLSearchParams(location.search).get('WebAppStartParam') || window.WebApp?.initDataUnsafe?.start_param;
    if (id && !openedProgramLink.current) { const found = programs.find((p) => p.id === id); if (found) { openedProgramLink.current = true; setSelected((current) => current ?? found); } }
  }, [programs]);
  const [chatProgram, setChatProgram] = useState<FundingOpportunity | null>(null);

  const [onboard, setOnboard] = useState(false);
  const pendingProgramme = useRef<FundingOpportunity | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Profile>(emptyProfile);
  const [error, setError] = useState('');
  const [companyLoading, setCompanyLoading] = useState(false);
  const autoFilledCompany = form.provenance?.name?.kind === 'source' && form.provenance?.inn?.kind !== 'manual'
    && !!form.name.trim() && !!form.region.trim() && /^\d{2}(\.\d{1,2}){0,2}$/.test(form.okved);
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
  useEffect(() => { saveAIHistory(messages); }, [messages]);
  useEffect(() => () => chatRequest.current?.abort(), []);
  useEffect(() => {
    if (chatRequest.current) { chatRequest.current.abort(); chatRequest.current = null; setSending(false); }
  }, [companyProfile, projectProfile, need]);
  const [question, setQuestion] = useState('');
  const [sending, setSending] = useState(false);
  const [chatFailure, setChatFailure] = useState<{ message: string; text: string; program: FundingOpportunity | null; task?: 'strategy' | 'documents' | 'review' | 'draft' | 'intake' | 'analysis' | 'search' } | null>(null);
  useEffect(() => { setChatFailure(null); }, [companyProfile, projectProfile, need]);
  const [assistantMode, setAssistantMode] = useState('Проверяем доступность GigaChat');
  const assistantOrigin = useRef<{page: Page; selected: FundingOpportunity | null; panel: typeof homePanel}>({page: 'overview', selected: null, panel: null});
  function rememberAssistantOrigin() { if (page !== 'assistant') assistantOrigin.current = {page, selected, panel: homePanel}; }
  function returnFromAssistant() { const origin = assistantOrigin.current; setPage(origin.page); setSelected(origin.selected); setHomePanel(origin.panel); }
  useEffect(() => { const controller = new AbortController(); fetch('/api/ai/status', { signal: controller.signal }).then((r) => r.json()).then((data) => setAssistantMode(data.status === 'ready' ? 'GigaChat подключён' : data.status === 'limited' ? 'GigaChat · предыдущий запрос не завершён' : data.configured ? 'GigaChat · готов к запросу' : 'GigaChat не настроен')).catch(() => { if (!controller.signal.aborted) setAssistantMode('Статус AI недоступен'); }); return () => controller.abort(); }, []);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => { dialogRef.current?.querySelector('.modal')?.scrollTo({ top: 0 }); }, [selected?.id, onboard, step]);

  useEffect(() => {
    // Параметр запуска открывает публичную карточку, но не подтверждает личность пользователя.
    const openLaunchProgram = () => {
      const p = programs.find((p) => p.id === window.WebApp?.initDataUnsafe?.start_param);
      if (p && !openedProgramLink.current) { openedProgramLink.current = true; setSelected(p); }
    };
    openLaunchProgram();
    window.addEventListener('opora:max-ready', openLaunchProgram);
    return () => window.removeEventListener('opora:max-ready', openLaunchProgram);
  }, [programs]);
  useEffect(() => {
    try {
      saveWorkspace(localStorage, { profile: companyProfile, projectProfile, fundingNeed: need, saved, applications: apps, detachedApplicationIds, businessNotice });
    } catch {
      setToast('Скачайте черновики, чтобы сохранить их на устройстве.');
    }
  }, [companyProfile, projectProfile, need, apps, saved, detachedApplicationIds, businessNotice]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    if (selected || onboard) {
      dialogRef.current?.showModal();
      if (selected && !onboard) dialogRef.current?.querySelector<HTMLElement>('.modal')?.focus({ preventScroll: true });
    }
    else dialogRef.current?.close();
  }, [selected, onboard]);

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
  const visiblePrograms = matches.map(m => ({ p: programsById.get(m.opportunity.id)!, m }))
    .filter(({p, m}) => p && (filter === 'Все меры' || fundingKindLabels[p.kind] === filter) && (!onlySaved || saved.includes(p.id)) &&
      (!profile || catalogScope !== 'personal' || personalIds.has(p.id)) &&
      (availability ? m.opportunity.status === availability : onlySaved || m.opportunity.status !== 'closed') &&
      `${p.title} ${p.description} ${fundingKindLabels[p.kind]}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => profile && catalogScope === 'personal' ? priorityRank(a.p.id) - priorityRank(b.p.id) : 0);
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
    if (onboard) pendingProgramme.current = null;
    cancelCompanyRequest();
    setSelected(null);
    setOnboard(false);
    setError('');
  };
  const updateApp = (id: string, patch: Partial<Application>) =>
    setApps((old) => old.map((a) => (a.id === id ? { ...a, ...patch, reviewConfirmed: ['project', 'budget', 'documents', 'documentTexts', 'generatedDraft'].some(key => key in patch) ? false : patch.reviewConfirmed ?? a.reviewConfirmed } : a)));
  useScreenHistory({ page, selectedId: selected?.id ?? null, homePanel, onboard, projectOnboard }, snapshot => {
    setPage(snapshot.page); setSelected(snapshot.selectedId ? programsById.get(snapshot.selectedId) ?? null : null);
    setHomePanel(snapshot.homePanel); setOnboard(snapshot.onboard); setProjectOnboard(snapshot.projectOnboard);
  }, page !== 'overview' || !!selected || !!homePanel || onboard || projectOnboard, () => {
    if (onboard || selected) close(); else if (homePanel) setHomePanel(null); else if (projectOnboard) setProjectOnboard(false);
    else if (page === 'assistant') returnFromAssistant(); else if (page === 'settings') setPage(settingsReturn);
    else navigate(['business-details', 'calendar', 'verification'].includes(page) ? 'profile' : 'overview');
  });
  // Для одной программы создаём один черновик, сохраняя уже введённые данные.
  function startApplication(p: FundingOpportunity) {
    if (!profile) {
      pendingProgramme.current = p;
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
  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (companyLoading || savingCompany) return;
    if (!validInn(form.inn)) {
      setError('Проверьте ИНН: нужны 10 или 12 цифр с верной контрольной суммой.');
      return;
    }
    if (step === 0) {
      void loadCompany();
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
    if (account.available && !account.account) { setError('account'); return; }
    if (account.account) {
      setSavingCompany(true);
      try { await account.save({ ...form, name: form.name.trim(), region: form.region.trim() }); }
      catch { setError('save'); return; }
      finally { setSavingCompany(false); }
    }
    setProjectProfile(null);
    if (companyProfile?.inn !== form.inn) {
      const notice = businessAddedNotice(); setBusinessNotice(notice); setToast(notice.title);
    }
    setProfile({
      ...form,
      name: form.name.trim(),
      region: form.region.trim(),
      applicantType: form.inn.length === 12 ? 'individual_entrepreneur' : 'legal_entity',
    });
    const returnProgramme = pendingProgramme.current;
    close();
    if (returnProgramme) { setSelected(returnProgramme); pendingProgramme.current = null; setPage('programs'); } else setPage('overview');
    setCatalogScope('personal');
  }
  async function confirmBusinessRemoval() {
    if (deletingBusiness) return;
    setDeletingBusiness(true); setDeleteBusinessError('');
    try {
      if (supportNotifications.available && !await supportNotifications.subscribe(false, false)) {
        setDeleteBusinessError('Не удалось отключить уведомления на сервере. Проверьте соединение или откройте приложение заново через MAX и повторите удаление.'); return;
      }
      if (account.available) {
        try { await account.remove(); }
        catch (e) { setDeleteBusinessError(e instanceof Error ? e.message : 'Не удалось удалить компанию из аккаунта.'); return; }
      }
      const cleared = removeBusiness(localStorage, { profile: companyProfile, projectProfile, fundingNeed: need, saved, applications: apps, detachedApplicationIds, businessNotice });
      cancelCompanyRequest(); chatRequest.current?.abort(); chatRequest.current = null;
      setProfile(null); setProjectProfile(null); setNeed(cleared.fundingNeed);
      setBusinessNotice(null);
      setDetachedApplicationIds(cleared.detachedApplicationIds ?? []);
      setForm({ ...emptyProfile, goals: [] }); setStep(0); setError(''); setOnboard(false);
      setProjectOnboard(false); setAIProjectSeed(null);
      setSelected(null); setHomePanel(null);
      setMessages([]); setQuestion(''); setChatProgram(null); setChatFailure(null); setSending(false);
      setCatalogScope('all'); setOnlySaved(false); setFilter('Все меры'); setQuery(''); setAvailability('');
      setDeleteBusinessOpen(false); setToast('Бизнес удалён. Черновики и сохранённые программы остались на устройстве.');
    } catch {
      setDeleteBusinessError('Не удалось сохранить удаление на устройстве. Бизнес не удалён. Попробуйте ещё раз.');
    } finally { setDeletingBusiness(false); }
  }
  const aiContext = { profile: profile ? fundingProfile : undefined, need: need.purpose ? need : undefined, page, workspace: analysisContext?.workspace,
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
    program: FundingOpportunity | null = chatProgram,
    task?: 'strategy' | 'documents' | 'review' | 'draft' | 'intake' | 'analysis' | 'search',
    retry = false,
  ) {
    if (!text.trim() || sending) return;
    rememberAssistantOrigin();
    setHomePanel(null); setSelected(null); setPage('assistant');
    setChatProgram(program);
    setQuestion('');
    if (!retry) setMessages((m) => [...m, { role: 'user', text }]);
    setChatFailure(null);
    setSending(true);
    const controller = new AbortController(); chatRequest.current = controller;
    const application = profile ? businessApps.find((a) => a.programId === program?.id) : undefined;
    try {
      const data = await requestAI({ task: task === 'documents' ? 'review' : task ?? 'chat', question: text,
        history: messages.slice(-8).map(({ role, text }) => ({ role, text })),
        context: { ...aiContext, programId: program?.id, project: application?.project?.slice(0, 10000), draft: application?.generatedDraft?.slice(0, 18000),
          documents: Object.values(application?.documentTexts ?? {}),
          preparedDocuments: application && program ? program.requiredDocuments.filter((d) => application.documents[d]) : [],
          budget: application?.budget.trim() ? Number(application.budget) : null } },
        controller.signal);
      if (controller.signal.aborted || chatRequest.current !== controller) return;
      if (data.providerFailure) { setChatFailure({ message: aiErrorMessage(data.providerFailure), text, program, task }); return; }
      setMessages((m) => [...m.slice(-29), { role: 'assistant', text: data.answer, result: !profile && data.mode === 'local' ? undefined : data, applicationId: application?.id }]);
      setAssistantMode(data.mode === 'llm' ? 'GigaChat · контекстный помощник' : 'Ответ по правилам');
      if (data.providerFailure) setChatFailure({ message: aiErrorMessage(data.providerFailure), text, program, task });
    } catch (error) {
      if (controller.signal.aborted || chatRequest.current !== controller) return;
      setChatFailure({ message: aiErrorMessage(error), text, program, task });
      setAssistantMode('Запрос не завершён');
    } finally {
      if (chatRequest.current === controller) { chatRequest.current = null; setSending(false); }
    }
  }
  // Экспортируем только опубликованные в каталоге сроки, в том числе архивные.
  function exportCalendar() { download(calendarICS(calendarCatalog), 'opora-calendar.ics', 'text/calendar;charset=utf-8'); }
  function programCard(p: FundingOpportunity) {
    const match = matchesById.get(p.id)!;
    return <FundingOpportunityCard key={p.id} match={match} onOpen={openFunding} onSave={toggleSaved} saved={saved.includes(p.id)} personalized={!!profile} />;
  }

  return (
    <div ref={shell} className={`app-shell shared-navigation page-${page}`}>
      {page !== 'overview' && page !== 'assistant' && <AppHeader
        title={{ programs: 'Меры поддержки', applications: 'Мои заявки', calendar: 'Календарь', profile: 'Мой бизнес', settings: 'Настройки', verification: 'Подтверждение компании', 'business-details': 'Данные и рекомендации' }[page]}
        backLabel={page === 'settings' ? 'Назад' : ['calendar', 'business-details'].includes(page) ? 'В мой бизнес' : page === 'verification' ? 'Назад к сценарию' : 'На главную'}
        onBack={() => page === 'settings' ? setPage(settingsReturn) : page === 'verification' ? navigate('profile') : navigate(['calendar', 'business-details'].includes(page) ? 'profile' : 'overview')}
        onSettings={page === 'settings' ? undefined : openSettings}
      />}
      <main ref={mainRef} className="app-content">
          {page === 'verification' && <section className="profile-panel"><h2>Подтверждение компании</h2><p>Подключение Госуслуг пока недоступно. Подтверждение полномочий выполняется на сайте оператора при подаче.</p><ActionButton className="primary" onClick={() => navigate('profile')}>К моему бизнесу</ActionButton></section>}
          {page === 'settings' && <SettingsPage account={account} companyProfile={companyProfile} profile={profile} supportNotifications={supportNotifications}
            onRestore={p => { setProfile({ ...emptyProfile, ...p }); setProjectProfile(null); setToast('Компания загружена из аккаунта'); }}
            onSave={() => { if (companyProfile) void account.save(companyProfile).then(() => setToast('Компания сохранена в аккаунте')).catch(() => {}); }}
            onRemove={() => { setDeleteBusinessError(''); setDeleteBusinessOpen(true); }} />}
          {page === 'overview' && <HomePage
            showNavigation={false}
            onFindSupport={() => navigate('programs')}
            onAddBusiness={() => profile ? navigate('profile') : setHomePanel('business')}
            onAssistant={() => navigate('assistant')}
            onSettings={openSettings}
            onApplications={() => setPage('applications')}
            onBusiness={() => navigate('profile')} personalized={!!profile}
            analysis={businessAnalysis} onAIAction={followInsight}

          />}
          {page === 'programs' && <CataloguePage profile={!!profile} need={need} saved={saved}
            catalogScope={catalogScope} setCatalogScope={setCatalogScope} onlySaved={onlySaved} setOnlySaved={setOnlySaved}
            query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} availability={availability} setAvailability={setAvailability}
            catalogToolsOpen={catalogToolsOpen} setCatalogToolsOpen={setCatalogToolsOpen} officialFundingCatalog={officialFundingCatalog}
            visiblePrograms={visiblePrograms} catalogLimit={catalogLimit} setCatalogLimit={setCatalogLimit} programCard={programCard}
            onTask={() => setHomePanel(profile ? 'funding' : 'business')} onEdit={openProfile} />}
          {page === 'applications' && <ApplicationsPage profile={profile} apps={apps} programs={programs}
            detachedApplicationIds={detachedApplicationIds} businessAnalysis={businessAnalysis} followInsight={followInsight} priorityRank={priorityRank}
            onAdd={() => setHomePanel('business')} onSupport={() => browse()} setSelected={setSelected} setDeleteDraftId={setDeleteDraftId} />}
          {page === 'calendar' && profile && <CalendarPage profile={profile} apps={apps} calendarPrograms={calendarPrograms}
            allCalendar={allCalendar} setAllCalendar={setAllCalendar} tracked={tracked} businessAnalysis={businessAnalysis} followInsight={followInsight}
            matchesById={matchesById} setSelected={setSelected} exportCalendar={exportCalendar} onSupport={() => navigate('programs')} />}
          {page === 'profile' && <BusinessHub profile={profile} project={!!projectProfile && !companyProfile}
            verification={companyProfile ? <div className="company-authority"><Icon name="shield" size={20} /><span>Полномочия подтверждаются при подаче на сайте оператора</span></div> : undefined}
            insight={businessAnalysis.data?.personalization?.sections.home} onInsight={followInsight}
            confirmed={personal.confirmed.length} applications={apps.length} saved={saved.length} purpose={need.purpose}
            onAdd={() => setHomePanel('business')} onEdit={openProfile} onSupport={() => { navigate('programs'); setCatalogScope('personal'); setOnlySaved(false); }}
            onNeed={() => setHomePanel('funding')} onAssistant={() => navigate('assistant')} onCalendar={() => navigate('calendar')}
            onApplications={() => navigate('applications')} onSaved={() => { navigate('programs'); setCatalogScope('saved'); setOnlySaved(true); }} />}
          {page === 'profile' && profile && <button type="button" className="business-details-link" onClick={() => navigate('business-details')}>
            <span className="business-details-link-icon"><Icon name="file" size={22} /></span><span>Данные и рекомендации</span><Icon name="chevron" size={18} />
          </button>}
          {page === 'business-details' && profile && <BusinessDetailsPage name={profile.name}
            analysis={<><AdaptiveInsight analysis={businessAnalysis} section="home" onAction={followInsight} /><ActionButton className="secondary" onClick={() => void ask('Проанализируй мой бизнес и объясни следующий шаг.', null, 'analysis')}>Обсудить рекомендации с AI</ActionButton></>}
            details={
              <BusinessInformation profile={profile} companyProfile={companyProfile} projectProfile={projectProfile}
                need={need} openProfile={openProfile} savedToAccount={!!account.account?.company} />
            } />}
          {page === 'assistant' && <AssistantPage
  businessName={profile?.name ?? 'Вопросы о бизнесе'}
  guest={!profile}
  backLabel="Назад"
  status={assistantMode}
  messages={messages}
  question={question}
  onQuestion={setQuestion}
  sending={sending}
  onSend={(text) => { void ask(text); }}
  onBack={returnFromAssistant}
  error={chatFailure?.message}
  onRetry={() => {
    if (chatFailure) {
      void ask(chatFailure.text, chatFailure.program, chatFailure.task, true);
    }
  }}

            onStop={() => { chatRequest.current?.abort(); chatRequest.current = null; setSending(false); }}
            onClear={() => { chatRequest.current?.abort(); chatRequest.current = null; setSending(false); setMessages([]); setChatProgram(null); setQuestion(''); setChatFailure(null); }}
            program={chatProgram ? { title: chatProgram.title, onOpen: () => setSelected(chatProgram), onRemove: () => setChatProgram(null) } : undefined}
            context={(closeInfo) => <>
              {profile ? <p><b>{profile.name}</b> · {profile.region}<br />Цель: {need.purpose || 'пока не указана'}.</p>
                : <ActionButton className="secondary" onClick={() => { closeInfo(); setHomePanel('business'); }}>Добавить бизнес</ActionButton>}
              <AdaptiveInsight analysis={businessAnalysis} section="assistant" onAction={(action) => { closeInfo(); followInsight(action); }} compact />
            </>}
            renderMessage={(index) => {
              const message = messages[index];
              if (message.result?.providerFailure) {
                const previous = messages.slice(0, index).reverse().find((item) => item.role === 'user');
                return previous ? <ActionButton className="secondary" disabled={sending} onClick={() => void ask(previous.text)}>Повторить запрос</ActionButton> : null;
              }
              return <>{message.text}
                {message.result && <AIResultView result={message.result} {...aiHandlers} showAnswer={false} onQuestion={setQuestion} onDraft={message.applicationId ? text => {
                  updateApp(message.applicationId!, { generatedDraft: text, draftOrigin: 'AI · текст применён пользователем' }); setToast('Текст добавлен в черновик');
                } : undefined} />}
                {!!message.opportunityIds?.length && <div className="message-links">{message.opportunityIds.map((id) => <ActionButton className="secondary" key={id} onClick={() => openFunding(id)}>Открыть: {programs.find((program) => program.id === id)?.title ?? 'Программа'}</ActionButton>)}</div>}
              </>;
            }}
          />}
      </main>
      {page !== 'assistant' && <AppNavigation active={activeTab} onNavigate={(next) => {
        if (next === 'overview' && page === 'overview') mainRef.current?.querySelector('.home-scroll')?.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        else navigate(next);
      }} />}
      <dialog
        aria-label={onboard ? 'Профиль бизнеса' : selected?.title || 'Программа'}
        ref={dialogRef}
        className={selected && !onboard ? 'opportunity-dialog' : undefined}
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
        <div className="modal" tabIndex={selected && !onboard ? -1 : undefined}>
          {onboard && (
            <CompanyProfileForm form={form} editForm={editForm} step={step} setStep={setStep}
              companyLoading={companyLoading} savingCompany={savingCompany} autoFilledCompany={autoFilledCompany}
              error={error} setError={setError} account={account} saveProfile={saveProfile} />
          )}
          {selected && <ProgrammeDetails match={matchesById.get(selected.id)!} profile={profile} activeApp={activeApp}
            detached={!!activeApp && detachedApplicationIds.includes(activeApp.id)}
            onUpdate={patch => { if (activeApp) updateApp(activeApp.id, patch); }}
            onDocuments={next => { if (activeApp) setApps(old => old.map(a => a.id === activeApp.id ? { ...a, reviewConfirmed: false,
              documentTexts: typeof next === 'function' ? next(a.documentTexts ?? {}) : next } : a)); }}
            onAttach={() => { if (activeApp) { updateApp(activeApp.id, { reviewConfirmed: false }); setDetachedApplicationIds(ids => ids.filter(id => id !== activeApp.id)); } }}
            onAsk={(task, text) => void ask(text, selected, task)} onDownload={download} onEdit={openProfile} onPrepare={() => startApplication(selected)} />}

        </div>
      </dialog>
      {exportText && <ModalSheet title="Экспорт текста" onClose={() => setExportText('')}><h2>Текст черновика</h2><p>Скопируйте текст в редактор и сохраните как TXT. Документ остаётся на вашем устройстве.</p><BusinessTextarea aria-label="Текст для экспорта" readOnly rows={12} value={exportText} /><div className="modal-actions"><ActionButton className="primary" onClick={() => navigator.clipboard.writeText(exportText).then(() => setToast('Текст скопирован')).catch(() => setToast('Выделите и скопируйте текст вручную.'))}>Копировать текст</ActionButton><ActionButton className="secondary" onClick={() => setExportText('')}>Закрыть</ActionButton></div></ModalSheet>}
      {homePanel && <ModalSheet title={{ business: 'Ваш бизнес', funding: 'Подбор поддержки' }[homePanel]} onClose={() => setHomePanel(null)}>
        {homePanel === 'business' && <div className="home-panel-actions">
          <h2>Расскажите о бизнесе</h2>
          <ActionButton className="text-button" onClick={() => void ask('Помоги описать бизнес для подбора поддержки.', null, 'intake')}>Обсудить задачу с AI</ActionButton>
          <ActionButton className="primary" onClick={openProfile}>{profile ? 'Редактировать профиль' : 'Добавить компанию по ИНН'}</ActionButton>
          <ActionButton className="secondary" onClick={() => { setHomePanel(null); setProjectOnboard(true); }}>У меня пока нет компании</ActionButton>
        </div>}
        {homePanel === 'funding' && profile && <>
          <FundingExperience key={companyProfile?.inn ?? 'project'} initialNeed={need} goals={profile.goals}
            onAsk={() => void ask('Помоги уточнить цель и параметры подбора.', null, 'intake')} onApply={nextNeed => {
              setNeed(nextNeed); setHomePanel(null); setCatalogScope('personal'); setOnlySaved(false); setFilter('Все меры'); setQuery(''); setAvailability(''); setPage('programs');
            }} />
        </>}

      </ModalSheet>}
      {deleteBusinessOpen && <ModalSheet title="Удалить бизнес?" onClose={() => { if (!deletingBusiness) setDeleteBusinessOpen(false); }}>
        <div className="delete-business-confirmation">
          <h2>Удалить бизнес?</h2>
          <p>Удалим профиль бизнеса, параметры подбора и историю AI с этого устройства{account.available ? ' и компанию из аккаунта MAX' : ''}.</p>
          {supportNotifications.available && <p>Подписка на новые меры и ожидающие сообщения MAX также будут удалены.</p>}
          <p>Черновики, документы и сохранённые программы останутся. Для нового бизнеса потребуется заново проверить реквизиты.</p>
          <div className="modal-actions">
            <ActionButton className="secondary" disabled={deletingBusiness} onClick={() => setDeleteBusinessOpen(false)}>Отмена</ActionButton>
            <ActionButton className="secondary danger-button" disabled={deletingBusiness} onClick={() => void confirmBusinessRemoval()}>{deletingBusiness ? 'Удаляем…' : deleteBusinessError ? 'Повторить удаление' : 'Удалить'}</ActionButton>
          </div>
        </div>
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
      {projectOnboard && <ProjectOnboarding initial={aiProjectSeed ?? (projectProfile ? { ...projectProfile, fundingPurpose: need.purpose, fundingNeed: need.amount } : null)} onCancel={() => { setProjectOnboard(false); setAIProjectSeed(null); }} onSave={(project) => { if (!projectProfile || companyProfile) { const notice = businessAddedNotice(true); setBusinessNotice(notice); setToast(notice.title); } setProjectProfile(project); setProfile(null); setNeed({ ...need, purpose: project.fundingPurpose, amount: project.fundingNeed }); setProjectOnboard(false); setAIProjectSeed(null); setPage('overview'); setCatalogScope('personal'); }} />}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
