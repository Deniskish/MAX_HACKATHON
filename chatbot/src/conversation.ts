import { randomUUID } from 'node:crypto';
import { APIError, type BotAPI } from './api-client';

export type Button = { text: string; action?: string; url?: string };
export type Reply = { text: string; buttons: Button[][]; file?: { name: string; text: string } };
export type Input = { id: string; text?: string; action?: string };
type Profile = { inn?: string; name?: string; region?: string; okved?: string; industry?: string; applicantType?: string; [key: string]: unknown };
type Need = { purpose: string; amount: number | null; ownFunds: number | null; preferredTermMonths: number | null; needsCollateralSupport: boolean | null };
type Opportunity = { id: string; title: string; description: string; providerName: string; amountMin: number | null; amountMax: number | null;
  deadline: string | null; requiredDocuments: string[]; status?: string; source: { url: string | null; name: string }; };
type Match = { opportunity: Opportunity; status: string; explanation: string; unknownRequirements: unknown[]; missingRequirements: unknown[]; purposeFit: boolean };
type Draft = { programId: string; project: string; text: string };
type State = { version: 1; mode: string; companyInn?: string; project?: Profile; need: Need; saved: string[]; drafts: Draft[];
  selected?: string; pendingCompany?: Profile; confirm?: string; resume?: string; query?: string; page: number;
  history: { role: 'user' | 'assistant'; text: string }[]; seen: string[]; retry?: Pick<Input, 'text' | 'action'> };
const purposes = ['покупка оборудования', 'оборотные средства', 'разработка продукта', 'найм сотрудников', 'экспорт', 'аренда / недвижимость', 'сельхозтехника', 'запуск производства', 'масштабирование'];
const goalLabels = ['Оборудование', 'Оборотные средства', 'Разработка', 'Сотрудники', 'Экспорт', 'Помещение', 'Сельхозтехника', 'Производство', 'Развитие'];
const fresh = (): State => ({ version: 1, mode: 'menu', need: { purpose: '', amount: null, ownFunds: null, preferredTermMonths: null, needsCollateralSupport: null }, saved: [], drafts: [], page: 0, history: [], seen: [] });
const button = (text: string, action: string): Button => ({ text, action });
const menu = () => [[button('Найти поддержку', 'find'), button('Спросить AI', 'chat')], [button('Мой бизнес', 'business'), button('Сохранённое', 'saved')], [button('Мои черновики', 'drafts'), button('Сообщения MAX', 'notifications')]];
const back = () => [button('Меню', 'menu')];
const reply = (text: string, buttons: Button[][] = [back()]): Reply => ({ text, buttons });
const safeLink = (url: string | null | undefined): string | undefined => {
  try { const u = new URL(url || ''); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : undefined; } catch { return undefined; }
};
const money = (n: number | null) => n === null ? 'не указана' : new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
const deadline = (value: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('ru-RU', { timeZone: 'UTC' }).format(new Date(value)) : value || 'уточняется у оператора';
const short = (s: string, limit = 900) => s.length > limit ? s.slice(0, limit - 1) + '…' : s;
export function parseAmount(text: string): number | null {
  const match = text.trim().toLowerCase().replace(/\s/g, '').replace(',', '.').match(/^(\d+(?:\.\d{1,2})?)(млн|млрд|тыс|миллион(?:а|ов)?|тысяч(?:а|и)?)?(?:₽|руб(?:лей|ля|ль)?\.?)?$/);
  if (!match) return null;
  const multiplier = match[2]?.startsWith('млрд') ? 1e9 : /млн|миллион/.test(match[2] || '') ? 1e6 : match[2] ? 1e3 : 1;
  const value = Number(match[1]) * multiplier;
  return Number.isSafeInteger(value) && value > 0 && value <= 1e15 ? value : null;
}
export function quickNeed(text: string): Need | null {
  if (!/(нуж[еннаыо]|ищу|подбер|най[дт]|хочу)/i.test(text)) return null;
  const words = [/оборудован|станок|станки/i, /оборотн/i, /разработк|продукт/i, /найм|сотрудник/i, /экспорт/i, /аренд|помещен|недвижим/i, /сельхоз|трактор/i, /производств/i, /масштаб|расширен/i];
  const index = words.findIndex(re => re.test(text));
  if (index < 0) return null;
  const amount = text.match(/\d[\d\s]*(?:[.,]\d+)?\s*(?:млрд|млн|тыс|миллион(?:а|ов)?|тысяч(?:а|и)?|руб(?:лей|ля|ль)?|₽)/i)?.[0];
  return { ...fresh().need, purpose: purposes[index], amount: amount ? parseAmount(amount) : null };
}

/** Channel UI only: company lookup, matching and AI stay in the existing API. */
export class Conversation {
  private state = fresh(); private revision = 0;
  private account: { company: Profile | null; revision: number } = { company: null, revision: 0 };
  constructor(private readonly api: BotAPI, private readonly appUrl: string) {}
  private profile() { return this.state.project ?? this.account.company; }
  private async save() {
    const result = await this.api.request('PUT', '/api/bot/workspace', { revision: this.revision, data: this.state });
    this.revision = result.revision;
  }
  async handle(input: Input): Promise<Reply | null> {
    const [workspace, account] = await Promise.all([
      this.api.request('GET', '/api/bot/workspace'), this.api.request('GET', '/api/account'),
    ]);
    this.revision = workspace.revision; this.account = account;
    this.state = workspace.data?.version === 1 ? workspace.data : fresh();
    if (this.state.companyInn !== account.company?.inn) {
      const saved = this.state.saved, seen = this.state.seen;
      this.state = { ...fresh(), saved, seen, companyInn: account.company?.inn };
    }
    if (this.state.seen.includes(input.id)) return null;
    let result: Reply;
    const command = input.action === 'retry' && this.state.retry ? { ...input, ...this.state.retry } : input;
    try {
      result = await this.route(command);
      delete this.state.retry;
    } catch (error) {
      if (error instanceof APIError && error.status === 409) {
        return reply('Данные уже изменились. Откройте меню, чтобы продолжить.', [back()]);
      }
      this.state.retry = { text: command.text, action: command.action };
      result = reply('Не удалось завершить действие. Можно повторить или выбрать другой шаг.', [[button('Повторить', 'retry')], back()]);
      console.error('Bot action incomplete', error instanceof APIError ? error.code : 'UNEXPECTED');
    }
    this.state.seen = [...this.state.seen, input.id].slice(-25);
    await this.save();
    return result;
  }
  private goals(): Reply {
    this.state.mode = 'purpose';
    const rows: Button[][] = [];
    for (let i = 0; i < purposes.length; i += 2) rows.push(purposes.slice(i, i + 2).map((_p, j) => button(goalLabels[i + j], `purpose:${i + j}`)));
    return reply('На что нужна поддержка?', [...rows, back()]);
  }
  private async catalog(): Promise<Opportunity[]> { return (await this.api.request('GET', '/api/funding/catalog')).opportunities; }
  private async opportunity(id = this.state.selected): Promise<Opportunity | undefined> { return (await this.catalog()).find(o => o.id === id); }
  private async matches(): Promise<Match[]> {
    const result = await this.api.request('POST', '/api/funding/match', { profile: this.profile() ?? {}, need: this.state.need });
    return result.matches;
  }
  private async list(saved = false): Promise<Reply> {
    let items: Opportunity[], heading: string;
    if (saved) { items = (await this.catalog()).filter(o => this.state.saved.includes(o.id)); heading = 'Сохранённые меры'; }
    else if (this.profile() && this.state.need.purpose) {
      const matches = await this.matches();
      items = matches.filter(m => ['eligible', 'almost_eligible', 'need_more_data'].includes(m.status) && m.opportunity.status !== 'closed').map(m => m.opportunity);
      heading = 'Варианты по данным бизнеса. Неизвестные условия нужно уточнить.';
    } else { items = (await this.catalog()).filter(o => o.status !== 'closed'); heading = 'Открытый каталог'; }
    if (this.state.query && !saved) { const q = this.state.query.toLowerCase(); items = items.filter(o => `${o.title} ${o.description} ${o.providerName}`.toLowerCase().includes(q)); }
    this.state.mode = saved ? 'saved' : 'results';
    const offset = this.state.page * 3, current = items.slice(offset, offset + 3);
    if (!current.length) return reply(saved ? 'Пока ничего не сохранено.' : 'По этим параметрам вариантов пока нет. Можно изменить задачу или открыть каталог.', [[button('Изменить задачу', 'find'), button('Весь каталог', 'catalog')], back()]);
    const text = heading + '\n\n' + current.map((o, i) => `${offset + i + 1}. ${o.title}\n${o.amountMax ? 'До ' + money(o.amountMax) : 'Размер помощи уточняется'}`).join('\n\n');
    const rows = current.map((o, i) => [button(`${offset + i + 1}. ${short(o.title, 45)}`, 'open:' + o.id)]);
    const pagination: Button[] = [];
    if (offset) pagination.push(button('Назад', `page:${saved ? 'saved' : 'results'}:${this.state.page - 1}`));
    if (offset + 3 < items.length) pagination.push(button('Ещё 3', `page:${saved ? 'saved' : 'results'}:${this.state.page + 1}`));
    if (pagination.length) rows.push(pagination);
    if (saved) rows.push([button('Сроки сохранённых', 'deadlines')]);
    rows.push([button('Поиск', 'search'), button('Моя задача', 'find')], back());
    return reply(text, rows);
  }
  private async detail(id: string): Promise<Reply> {
    const o = await this.opportunity(id);
    if (!o) return reply('Эта мера больше не доступна в каталоге.', [[button('Найти другую', 'find')], back()]);
    this.state.selected = id; this.state.mode = 'detail';
    let suitability = '';
    if (this.profile() && this.state.need.purpose) {
      const m = (await this.matches()).find(m => m.opportunity.id === id);
      if (m) suitability = m.status === 'not_eligible' ? '\nЕсть несовпадения с условиями.' : m.status === 'expired' ? '\nПриём завершён.' : m.status === 'need_more_data' ? '\nЧасть условий нужно уточнить.' : '\nИзвестные условия проверены. Решение принимает оператор.';
    }
    const source = safeLink(o.source.url);
    return reply(`${o.title}\n${o.providerName}\n\n${short(o.description, 650)}\n\nРазмер: ${o.amountMin ? 'от ' + money(o.amountMin) + ' ' : ''}${o.amountMax ? 'до ' + money(o.amountMax) : 'уточняется'}\nСрок: ${deadline(o.deadline)}${o.status === 'closed' ? '\nПриём завершён.' : ''}${suitability}`, [
      [button('Объяснить с AI', 'explain:' + id), button(this.state.saved.includes(id) ? 'Убрать из сохранённых' : 'Сохранить', 'save:' + id)],
      [button('Подготовить заявку', 'prepare:' + id), button('Документы', 'documents:' + id)],
      ...(source ? [[{ text: 'Официальный источник', url: source }]] : []), back(),
    ]);
  }
  private async ai(question: string, task = 'chat', extra: Record<string, unknown> = {}): Promise<Reply> {
    if (question.length > 2000) return reply('Сократите вопрос до 2 000 символов. Текст документа можно отправить через «Документы → Проверить текст».');
    const p = this.profile();
    const result = await this.api.request('POST', '/api/ai/assist', { task, question,
      history: task === 'chat' ? this.state.history : [],
      context: { ...(p ? { profile: p, identifiers: { name: p.name ?? '', inn: p.inn ?? '' } } : {}), ...(this.state.need.purpose ? { need: this.state.need } : {}),
        ...(this.state.selected ? { programId: this.state.selected } : {}), ...extra },
    });
    if (result.mode !== 'llm' || !result.answer?.trim()) throw new APIError(503, 'AI_UNAVAILABLE');
    this.state.mode = 'chat';
    this.state.history = [...this.state.history, { role: 'user' as const, text: short(question, 1000) }, { role: 'assistant' as const, text: short(result.answer, 1000) }].slice(-6);
    return reply(short(result.answer, 6000), [[button('Найти поддержку', 'find')], ...(this.state.selected ? [[button('К программе', 'open:' + this.state.selected)]] : []), back()]);
  }
  private async route(input: Input): Promise<Reply> {
    const text = input.text?.trim() ?? '', action = input.action ?? '';
    if (text.length > 6000) return reply('Отправьте фрагмент до 6 000 символов.', [back()]);
    if (['/start', '/menu', '/cancel', 'меню'].includes(text.toLowerCase()) || action === 'menu') {
      this.state.mode = 'menu'; delete this.state.confirm; delete this.state.pendingCompany;
      return reply('Что нужно вашему бизнесу? Выберите действие или напишите вопрос.', menu());
    }
    if (text === '/help') return reply('Напишите вопрос, отправьте ИНН или выберите действие. /cancel — выйти из текущего шага.\n\nКомпания и черновики чата сохраняются в вашем аккаунте MAX.', menu());
    if (action === 'chat') { this.state.mode = 'chat'; this.state.selected = undefined; return reply('Задайте вопрос. Например: «Какая поддержка есть для ИП?»'); }
    if (action === 'find' || text === '/support') {
      this.state.query = undefined; this.state.page = 0;
      if (this.profile()) return this.goals();
      this.state.mode = 'inn'; this.state.resume = 'find';
      return reply('Отправьте ИНН — подберём меры по данным компании.', [[button('Пока без компании', 'project')], [button('Смотреть каталог', 'catalog')], back()]);
    }
    if (action === 'business' || text === '/business') {
      const p = this.profile();
      if (!p) { this.state.mode = 'inn'; this.state.resume = 'business'; return reply('Отправьте ИНН компании или ИП.', [[button('У меня проект', 'project')], back()]); }
      return reply(`${p.name || 'Ваш проект'}\n${p.inn ? 'ИНН ' + p.inn + '\n' : ''}${p.region || ''}\n${p.industry || p.okved || ''}`, [
        [button('Подобрать поддержку', 'find'), button('AI-анализ', 'analysis')],
        [button('Изменить бизнес', 'replace'), button('Удалить бизнес', 'delete')], back()]);
    }
    if (action === 'replace') { this.state.mode = 'inn'; this.state.resume = 'business'; return reply('Отправьте новый ИНН.', [[button('У меня проект', 'project')], back()]); }
    if (action === 'project') { this.state.mode = 'region'; return reply('В каком регионе работаете или планируете начать?'); }
    if (this.state.mode === 'region' && text) {
      if (text.length > 120) return reply('Напишите только название региона.');
      this.state.project = { region: text, applicantType: 'project' }; this.state.mode = 'industry'; return reply('Чем занимаетесь? Например: «производство мебели».');
    }
    if (this.state.mode === 'industry' && text) {
      if (text.length > 120) return reply('Коротко укажите направление бизнеса.');
      this.state.project = { ...this.state.project, industry: text, name: 'Мой проект' };
      return this.state.need.purpose ? this.list() : this.goals();
    }
    if ((/^\d{10}(\d{2})?$/.test(text) && ['menu', 'chat', 'results', 'detail', 'saved'].includes(this.state.mode)) || this.state.mode === 'inn' && text) {
      if (!/^\d{10}(\d{2})?$/.test(text)) return reply('Нужен ИНН: 10 цифр для компании или 12 для ИП.', [[button('Без компании', 'project')], back()]);
      let found;
      try { found = await this.api.request('GET', '/api/company/' + text); }
      catch (e) { if (e instanceof APIError && [400,404].includes(e.status)) return reply('Проверьте ИНН или продолжите как проект.', [[button('Без компании', 'project')], back()]); throw e; }
      this.state.pendingCompany = Object.fromEntries(Object.entries(found.profile).filter(([key]) =>
        ['inn','name','region','okved','industry','applicantType','ageMonths','employees','revenue','isSme','companyType','tax','goals','companyStatus'].includes(key)));
      this.state.confirm = randomUUID(); this.state.mode = 'company-confirm';
      return reply(`${found.profile.name}\nИНН ${text}\n${found.profile.region}\nОКВЭД ${found.profile.okved}\n\nДобавить в ваш аккаунт?`, [[button('Добавить компанию', 'company:' + this.state.confirm)], [button('Другой ИНН', 'replace')], back()]);
    }
    if (action.startsWith('company:')) {
      if (this.state.mode !== 'company-confirm' || action.slice(8) !== this.state.confirm || !this.state.pendingCompany) return reply('Это действие уже не актуально.', [back()]);
      this.account = await this.api.request('PUT', '/api/account/company', { revision: this.account.revision, company: this.state.pendingCompany });
      const resume = this.state.resume, saved = this.state.saved, need = this.state.need;
      this.state = { ...fresh(), saved, need, companyInn: this.account.company?.inn };
      if (resume === 'find') { const next = need.purpose ? await this.list() : this.goals(); next.text = 'Компания добавлена.\n\n' + next.text; return next; }
      return reply('Компания добавлена. Можно перейти к подбору.', [[button('Найти поддержку', 'find'), button('AI-анализ', 'analysis')], back()]);
    }
    if (action === 'delete') {
      this.state.mode = 'delete-confirm'; this.state.confirm = randomUUID();
      return reply('Удалить бизнес, черновики и историю AI в боте? Подписка на меры тоже отключится.', [[button('Удалить', 'delete:' + this.state.confirm)], [button('Отмена', 'menu')]]);
    }
    if (action.startsWith('delete:')) {
      if (this.state.mode !== 'delete-confirm' || action.slice(7) !== this.state.confirm) return reply('Это действие уже не актуально.');
      this.account = await this.api.request('DELETE', '/api/account/company');
      this.revision = (await this.api.request('GET', '/api/bot/workspace')).revision; this.state = fresh();
      return reply('Бизнес удалён.', menu());
    }
    if (action.startsWith('purpose:')) {
      const index = Number(action.slice(8));
      if (!Number.isInteger(index) || !purposes[index]) return this.goals();
      this.state.need = { ...fresh().need, purpose: purposes[index] }; this.state.mode = 'amount';
      return reply('Какая сумма нужна? Можно написать «5 млн» или пропустить.', [[button('Без суммы', 'amount:skip')], back()]);
    }
    if (this.state.mode === 'amount' && (text || action === 'amount:skip')) {
      const amount = action === 'amount:skip' ? null : parseAmount(text);
      if (amount === null && action !== 'amount:skip') return reply('Напишите сумму, например «500 000» или «5 млн».', [[button('Без суммы', 'amount:skip')], back()]);
      this.state.need.amount = amount; this.state.page = 0; return this.list();
    }
    if (action === 'catalog') { this.state.query = undefined; this.state.need = fresh().need; this.state.page = 0; return this.list(); }
    if (action === 'search') { this.state.mode = 'search'; return reply('Напишите название программы или слово для поиска.'); }
    if (this.state.mode === 'search' && text) { this.state.query = short(text,120); this.state.page = 0; return this.list(); }
    if (action === 'saved' || text === '/saved') { this.state.page = 0; return this.list(true); }
    if (action === 'deadlines' || text === '/calendar') {
      const tracked = (await this.catalog()).filter(o => this.state.saved.includes(o.id) || this.state.drafts.some(d => d.programId === o.id));
      tracked.sort((a,b) => (a.deadline ? Date.parse(a.deadline) || Infinity : Infinity) - (b.deadline ? Date.parse(b.deadline) || Infinity : Infinity));
      return reply(tracked.length ? short('Сроки сохранённых мер и черновиков:\n\n'+tracked.map(o=>`${o.title}\n${o.status === 'closed' ? 'Приём завершён' : deadline(o.deadline)}`).join('\n\n'),6000) : 'Сохраните меру, чтобы следить за её сроками.',[[button('Сохранённые меры','saved')],back()]);
    }
    if (action.startsWith('page:')) { const [,scope,n] = action.split(':'); this.state.page = Math.max(0, Math.min(1000, Number(n) || 0)); return this.list(scope === 'saved'); }
    if (action.startsWith('open:')) return this.detail(action.slice(5));
    if (action.startsWith('save:')) {
      const id = action.slice(5); if (!await this.opportunity(id)) return reply('Откройте актуальную меру из каталога.');
      if (this.state.saved.includes(id)) this.state.saved = this.state.saved.filter(v => v !== id);
      else { if (this.state.saved.length >= 30) return reply('Сохранено 30 мер. Уберите одну, чтобы добавить новую.'); this.state.saved.push(id); }
      return this.detail(id);
    }
    if (action === 'analysis') { this.state.selected = undefined; return this.ai('Проанализируй бизнес и предложи один следующий практический шаг.', 'analysis'); }
    if (action.startsWith('explain:')) {
      const id = action.slice(8); if (!await this.opportunity(id)) return reply('Откройте актуальную меру из каталога.');
      this.state.selected = id; return this.ai('Объясни условия программы для моего бизнеса: что известно, что нужно уточнить и с чего начать.');
    }
    if (action.startsWith('documents:')) {
      const o = await this.opportunity(action.slice(10)); if (!o) return reply('Откройте актуальную меру из каталога.');
      return reply(o.requiredDocuments.length ? 'Документы программы:\n\n' + o.requiredDocuments.map(d => '• ' + d).join('\n') : 'Перечень документов нужно уточнить у оператора.', [[button('Проверить текст с AI', 'review:' + o.id)], [button('К программе', 'open:' + o.id)], back()]);
    }
    if (action.startsWith('prepare:') || action.startsWith('review:')) {
      const id = action.slice(action.indexOf(':') + 1); if (!await this.opportunity(id)) return reply('Откройте актуальную меру из каталога.');
      this.state.selected = id; this.state.mode = action.startsWith('review:') ? 'review' : 'project-text';
      return reply(this.state.mode === 'review' ? 'Пришлите текст документа до 6 000 символов. Персональные данные лучше убрать.' : 'Коротко опишите проект: что планируете, какой результат и сроки. Черновик сохранится в аккаунте MAX.', [back()]);
    }
    if (this.state.mode === 'review' && text) return this.ai('Проверь текст документа: чего не хватает для программы, что уточнить.', 'review', { documents: [{ id: 'chat-document', name: 'Текст из чата', pages: [{ page: 1, text }] }] });
    if (this.state.mode === 'project-text' && text) {
      if (!this.state.selected) return reply('Сначала выберите программу.', [[button('Найти поддержку', 'find')]]);
      if (this.state.drafts.length >= 3 && !this.state.drafts.some(d => d.programId === this.state.selected)) return reply('У вас уже три черновика. Удалите ненужный и продолжите.', [[button('Мои черновики', 'drafts')], back()]);
      const o = await this.opportunity(); if (!o) return reply('Откройте актуальную меру из каталога.');
      const result = await this.api.request('POST', '/api/ai/assist', { task: 'draft', question: 'Подготовь краткий черновик описания проекта. Не придумывай факты. Недостающие сведения отметь для заполнения.',
        context: { profile: this.profile() ?? {}, identifiers: { name: this.profile()?.name ?? '', inn: this.profile()?.inn ?? '' }, ...(this.state.need.purpose ? { need: this.state.need } : {}), programId: o.id, project: text, draftKind: 'Описание проекта' } });
      if (result.mode !== 'llm' || !(result.draft || result.answer)?.trim()) throw new APIError(503,'AI_UNAVAILABLE');
      const draft = { programId: o.id, project: short(text,2000), text: short(result.draft || result.answer,6000) };
      this.state.drafts = [...this.state.drafts.filter(d => d.programId !== o.id),draft]; this.state.mode = 'detail';
      return this.showDraft(draft, o);
    }
    if (action === 'drafts' || text === '/applications') {
      const catalog = await this.catalog();
      return reply(this.state.drafts.length ? 'Черновики. Это подготовленные тексты, заявки ещё не отправлены.' : 'Черновиков пока нет. Выберите меру и нажмите «Подготовить заявку».', [...this.state.drafts.map(d => [button(short(catalog.find(o=>o.id===d.programId)?.title || 'Черновик',45),'draft:'+d.programId)]), back()]);
    }
    if (action.startsWith('draft:') || action.startsWith('export:')) {
      const id = action.slice(action.indexOf(':')+1), d = this.state.drafts.find(d => d.programId === id), o = await this.opportunity(id);
      if (!d || !o) return reply('Черновик не найден.', [[button('Мои черновики', 'drafts')], back()]);
      if (action.startsWith('export:')) return { ...reply('Текст черновика. Проверьте его перед подачей.', [[button('К программе','open:'+id)],back()]), file: {name:'opora-draft.txt',text:`${o.title}\n\n${d.text}\n\nИсточник: ${safeLink(o.source.url) || 'уточните у оператора'}\nЗаявка не отправлена.`} };
      return this.showDraft(d,o);
    }
    if (action.startsWith('remove-draft:')) { this.state.drafts = this.state.drafts.filter(d => d.programId !== action.slice(13)); return reply('Черновик удалён.', [[button('Мои черновики','drafts')],back()]); }
    if (action === 'notifications') {
      const sub = await this.api.request('GET','/api/notifications');
      this.state.confirm = randomUUID();
      return reply(sub.bot ? 'Бот сообщает о новых подходящих мерах.' : 'Сообщать о новых мерах для вашего бизнеса?', [[button(sub.bot ? 'Отключить' : 'Включить', `notify:${sub.bot ? 'off' : 'on'}:${this.state.confirm}`)],back()]);
    }
    if (action.startsWith('notify:')) {
      const [,value,nonce] = action.split(':'); if (nonce !== this.state.confirm) return reply('Откройте настройки сообщений заново.',[[button('Сообщения MAX','notifications')],back()]);
      if (value === 'off') await this.api.request('DELETE','/api/notifications/subscription');
      else {
        if (!this.profile()) return reply('Добавьте компанию или проект, чтобы получать подходящие меры.',[[button('Добавить бизнес','business')],back()]);
        await this.api.request('PUT','/api/notifications/subscription',{profile:this.profile(),need:this.state.need,bot:true});
      }
      delete this.state.confirm; return reply(value === 'off' ? 'Сообщения отключены.' : 'Готово. Новые подходящие меры придут в этот чат.',menu());
    }
    if (action) return reply('Выберите актуальное действие.',menu());
    if (!text) return reply('Можно отправить вопрос, ИНН или текст документа. Для файлов откройте приложение.', [...menu(),[{text:'Мини-приложение',url:this.appUrl}]]);
    const proposed = quickNeed(text);
    if (proposed && this.state.mode !== 'chat') {
      this.state.need = proposed; this.state.query = undefined; this.state.page = 0;
      if (this.profile()) return this.list();
      this.state.mode = 'inn'; this.state.resume = 'find';
      return reply(`Задача: ${proposed.purpose}${proposed.amount ? ', ' + money(proposed.amount) : ''}.\n\nОтправьте ИНН для подбора.`, [[button('Без компании','project')],back()]);
    }
    return this.ai(text);
  }
  private showDraft(d: Draft,o: Opportunity): Reply {
    const source = safeLink(o.source.url);
    return reply('Черновик — проверьте перед подачей.\n\n'+d.text,[
      [button('Скачать TXT','export:'+o.id),button('Проверить текст','review:'+o.id)],
      ...(source ? [[{text:'Подать на сайте оператора',url:source}]] : []),
      [button('Удалить черновик','remove-draft:'+o.id)],back(),
    ]);
  }
}
