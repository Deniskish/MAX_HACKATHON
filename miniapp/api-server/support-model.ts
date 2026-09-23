// Общие правила для браузера и API, чтобы оценки и суммы не расходились.
import { legacyPrograms } from './funding-catalog/legacy-adapter';
import type { FieldProvenance } from './company-data/types';

export type ProfileValues = {
  inn: string;
  name: string;
  region: string;
  companyType: 'ООО' | 'АО' | 'ИП' | 'КФХ' | 'другое' | '';
  okved: string;
  ageMonths: number | null;
  employees: number | null;
  revenue: number | null;
  isSme: 'yes' | 'no' | 'unknown';
  tax: string;
  goals: string[];
};
export type Profile = ProfileValues & {
  companyStatus?: string | null;
  applicantType?: 'legal_entity' | 'individual_entrepreneur' | 'individual' | 'team' | 'project';
  provenance?: Partial<Record<keyof ProfileValues | 'applicantType' | 'companyStatus', FieldProvenance>>;
};
export type Rule = {
  field:
    | 'region'
    | 'okved'
    | 'ageMonths'
    | 'employees'
    | 'revenue'
    | 'isSme'
    | 'goals'
    | 'companyType'
    | 'tax';
  label: string;
  value: string | number;
  op?: 'eq' | 'gte' | 'lte' | 'prefix' | 'includes';
};
export type BenefitKind = 'grant' | 'loan' | 'guarantee' | 'tax' | 'lease' | 'service' | 'property';
export type Program = {
  id: string;
  title: string;
  provider: string;
  type: string;
  amount: string;
  description: string;
  deadline: string;
  region: string;
  icon: string;
  rules: Rule[];
  documents: string[];
  source: string;
  benefit: { kind: BenefitKind; max: number | null; expenseRate?: number; explanation: string };
  difficulty: 'Низкая' | 'Средняя' | 'Высокая';
  preparationDays: number;
  sectors: string[];
  version: string;
  updatedAt: string;
};
export type Application = {
  reviewConfirmed?: boolean;
  status?: 'draft' | 'collecting_documents' | 'ready_for_review';
  id: string;
  programId: string;
  createdAt: string;
  documents: Record<string, string>;
  project: string;
  budget: string;
  generatedDraft?: string;
  draftOrigin?: string;
  documentFiles?: Record<string, string>;
};
export const programs = legacyPrograms;
export const goals = [
  'Разработка продукта',
  'Покупка оборудования',
  'Найм сотрудников',
  'Выход на экспорт',
  'Пополнение оборотных средств',
  'Снижение налоговой нагрузки',
  'Аренда помещения',
  'Поиск покупателей',
  'Обучение команды',
];
export const emptyProfile: Profile = {
  inn: '',
  name: '',
  region: '',
  companyType: '',
  okved: '',
  ageMonths: null,
  employees: null,
  revenue: null,
  isSme: 'unknown',
  tax: '',
  goals: [],
};

// Пустое значение — это «неизвестно», а не выполненное условие.
export function evaluate(program: Program, profile: Profile, now = new Date()) {
  const checks = program.rules.map((rule) => {
    const value = profile[rule.field];
    const unknown =
      value === null ||
      value === '' ||
      value === 'unknown' ||
      (Array.isArray(value) && value.length === 0);
    let pass = false;
    if (!unknown) {
      const op =
        rule.op ||
        (rule.field === 'okved'
          ? 'prefix'
          : rule.field === 'ageMonths'
            ? 'gte'
            : rule.field === 'employees'
              ? 'lte'
              : rule.field === 'goals'
                ? 'includes'
                : 'eq');
      if (op === 'prefix')
        pass =
          String(value) === String(rule.value) ||
          String(value).startsWith(String(rule.value) + '.');
      else if (op === 'gte')
        pass = typeof value === 'number' && Number.isFinite(value) && value >= Number(rule.value);
      else if (op === 'lte')
        pass = typeof value === 'number' && Number.isFinite(value) && value <= Number(rule.value);
      else if (op === 'includes') pass = Array.isArray(value) && value.includes(String(rule.value));
      else pass = value === rule.value;
    }
    return {
      ...rule,
      status: unknown ? ('unknown' as const) : pass ? ('pass' as const) : ('fail' as const),
    };
  });
  const expired = new Date(program.deadline + 'T23:59:59+03:00').getTime() < now.getTime();
  const passed = checks.filter((c) => c.status === 'pass').length;
  return {
    checks,
    expired,
    score: checks.length ? Math.round((passed / checks.length) * 100) : 0,
    status: expired
      ? 'Приём завершён'
      : checks.some((c) => c.status === 'fail')
        ? 'Есть несоответствия'
        : checks.some((c) => c.status === 'unknown')
          ? 'Нужно уточнить'
          : 'Условия совпадают',
  };
}

export const benefitLabels: Record<BenefitKind, string> = {
  grant: 'Гранты и компенсации',
  loan: 'Возвратное финансирование',
  guarantee: 'Поручительства',
  tax: 'Налоговая экономия',
  lease: 'Лизинг',
  service: 'Услуги',
  property: 'Имущество',
};
export const rubles = (amount: number) => `${amount.toLocaleString('ru-RU')} ₽`;
// Считаем выплату по допустимой доле расходов и ограничиваем лимитом программы.
export function potentialBenefit(program: Program, budget?: string) {
  const amount = budget?.trim() ? Number(budget) : NaN;
  const validBudget = Number.isFinite(amount) && amount > 0;
  const cap = program.benefit.max;
  const calculated = cap !== null && validBudget && program.benefit.expenseRate !== undefined;
  const estimate = calculated
    ? Math.min(cap, Math.floor(amount * program.benefit.expenseRate!))
    : cap;
  return {
    kind: program.benefit.kind,
    max: estimate,
    calculated,
    label: calculated ? `до ${rubles(estimate!)}` : program.amount,
    explanation: calculated
      ? `Модельная оценка: ${Math.round(program.benefit.expenseRate! * 100)}% указанного бюджета, не выше лимита. Допустимость расходов ещё не проверена.`
      : program.benefit.explanation,
  };
}
export type OpportunityStatus =
  | 'Подходит'
  | 'Почти подходит'
  | 'Не хватает данных'
  | 'Не подходит'
  | 'Приём завершён';
// Разделяем условия бизнеса и готовность документов: у этих пробелов разные действия.
export function analyzeOpportunity(
  program: Program,
  profile: Profile,
  app?: Application,
  now = new Date(),
) {
  const base = evaluate(program, profile, now);
  const fulfilled = base.checks.filter((c) => c.status === 'pass');
  const unmet = base.checks.filter((c) => c.status === 'fail');
  const unknown = base.checks.filter((c) => c.status === 'unknown');
  const missingDocuments = program.documents.filter((d) => !app?.documents[d]);
  const preparedDocuments = program.documents.filter((d) => !!app?.documents[d]);
  const total = base.checks.length + program.documents.length;
  const confirmed = fulfilled.length + preparedDocuments.length;
  const score = total ? Math.round((confirmed / total) * 100) : 0;
  const status: OpportunityStatus = base.expired
    ? 'Приём завершён'
    : unmet.length
      ? 'Не подходит'
      : unknown.length || !base.checks.length
        ? 'Не хватает данных'
        : missingDocuments.length
          ? 'Почти подходит'
          : 'Подходит';
  const daysLeft = Math.max(
    0,
    Math.ceil(
      (new Date(program.deadline + 'T23:59:59+03:00').getTime() - now.getTime()) / 86400000,
    ),
  );
  const plan = [
    ...unmet.map((c) => ({
      kind: 'blocked',
      title: c.label,
      detail:
        c.field === 'ageMonths'
          ? 'Требуется дождаться нужного возраста компании. Документ не устраняет это ограничение.'
          : 'Указанные параметры не соответствуют программе. Проверьте данные или выберите другую меру; подготовка документов не устраняет это ограничение.',
    })),
    ...unknown.map((c) => ({
      kind: 'profile',
      title: `Уточнить: ${c.label}`,
      detail:
        'Добавьте подтверждённые сведения в профиль. Неизвестное значение не считается выполненным условием.',
    })),
    ...missingDocuments.map((d) => ({
      kind: 'document',
      title: `Подготовить: ${d}`,
      detail: documentGuide(d).where,
    })),
    {
      kind: 'deadline',
      title: `Проверить комплект до ${program.deadline}`,
      detail: base.expired
        ? 'Приём в этой версии программы завершён.'
        : `Осталось ${daysLeft} дн. Ориентир подготовки: ${program.preparationDays} дн. Проверьте официальную форму и правила перед подачей.`,
    },
  ];
  return {
    ...base,
    score,
    profileScore: base.score,
    status,
    fulfilled,
    unmet,
    unknown,
    missingDocuments,
    preparedDocuments,
    confirmed,
    total,
    daysLeft,
    plan,
    benefit: potentialBenefit(program, app?.budget),
    canPrepare: !base.expired && !unmet.length && base.checks.length > 0,
  };
}
// Не дополняем список неподходящими мерами ради нужного количества карточек.
export function shortlist(
  profile: Profile,
  apps: Application[] = [],
  catalog: Program[] = programs,
  now = new Date(),
  limit = 5,
) {
  const priority: Record<OpportunityStatus, number> = {
    Подходит: 0,
    'Почти подходит': 1,
    'Не хватает данных': 2,
    'Не подходит': 3,
    'Приём завершён': 4,
  };
  return catalog
    .map((p) => ({
      p,
      r: analyzeOpportunity(
        p,
        profile,
        apps.find((a) => a.programId === p.id),
        now,
      ),
    }))
    .filter(({ r }) => r.canPrepare && r.fulfilled.length > 0)
    .sort(
      (a, b) =>
        priority[a.r.status] - priority[b.r.status] ||
        b.r.score - a.r.score ||
        a.p.preparationDays - b.p.preparationDays ||
        a.p.deadline.localeCompare(b.p.deadline) ||
        a.p.id.localeCompare(b.p.id),
    )
    .slice(0, Math.max(0, Math.min(5, limit)));
}
export function benefitSummary(items: ReturnType<typeof shortlist>) {
  // Программы могут быть несовместимы: показываем максимальный лимит каждого вида, не сумму.
  return (Object.keys(benefitLabels) as BenefitKind[]).flatMap((kind) => {
    const group = items.filter((x) => x.r.benefit.kind === kind);
    if (!group.length) return [];
    const caps = group.flatMap((x) => (x.r.benefit.max === null ? [] : [x.r.benefit.max]));
    return [
      {
        kind,
        label: benefitLabels[kind],
        count: group.length,
        max: caps.length ? Math.max(...caps) : null,
      },
    ];
  });
}

export type DocumentGuide = { why: string; where: string; contents: string; sections: string[] };
// Подсказки помогают подготовить документы; официальную форму задаёт оператор.
export function documentGuide(name: string): DocumentGuide {
  if (/ЕГРЮЛ|ЕГРИП/.test(name))
    return {
      why: 'Подтверждает регистрационные сведения о заявителе.',
      where: 'Получите актуальную выписку через официальный сервис ФНС.',
      contents:
        'Реквизиты компании, дата выписки, сведения о регистрации. Срок допустимой давности уточните у оператора программы.',
      sections: ['ИНН', 'ОГРН', 'дата'],
    };
  if (/МСП/.test(name))
    return {
      why: 'Подтверждает принадлежность бизнеса к субъектам МСП.',
      where: 'Проверьте компанию в Едином реестре субъектов МСП ФНС и получите сведения.',
      contents: 'ИНН, категория предприятия и дата включения/актуализации.',
      sections: ['ИНН', 'категория', 'дата'],
    };
  if (/задолженности/.test(name))
    return {
      why: 'Нужен для проверки ограничений по задолженности.',
      where: 'Запросите справку через личный кабинет налогоплательщика или инспекцию.',
      contents:
        'Заявитель, дата выдачи и сведения об исполнении налоговых обязательств. Точную форму определяет программа.',
      sections: ['ИНН', 'дата', 'обязательств'],
    };
  if (/договор|Договор/.test(name))
    return {
      why: 'Подтверждает основание планируемых или произведённых расходов.',
      where: 'Запросите у поставщика договор с приложениями и спецификацией.',
      contents: 'Стороны, предмет договора, стоимость, сроки, реквизиты и подписи.',
      sections: ['предмет', 'стоимость', 'срок'],
    };
  if (/Платёж/.test(name))
    return {
      why: 'Подтверждает факт оплаты заявленных затрат.',
      where: 'Получите платёжные документы в обслуживающем банке.',
      contents: 'Плательщик, получатель, сумма, назначение, дата и подтверждение исполнения.',
      sections: ['сумма', 'назначение', 'дата'],
    };
  if (/Смета|смета|Расчёт/.test(name))
    return {
      why: 'Раскрывает состав расходов и потребность в финансировании.',
      where: 'Подготовьте по статьям затрат и подтвердите расчёт предложениями поставщиков.',
      contents:
        'Статья, количество, цена, итог, источник финансирования и обоснование каждой позиции.',
      sections: ['количество', 'цена', 'итого'],
    };
  if (/отчётность/.test(name))
    return {
      why: 'Нужна для оценки финансовых параметров компании.',
      where: 'Запросите у бухгалтера отчётность за период, указанный оператором.',
      contents:
        'Отчётный период, баланс, финансовые результаты и подтверждение сдачи при необходимости.',
      sections: ['период', 'баланс', 'результат'],
    };
  if (/коммерческое|Коммерческое/.test(name))
    return {
      why: 'Подтверждает предварительную стоимость покупки.',
      where: 'Запросите у поставщика предложение с действующим сроком цены.',
      contents: 'Описание оборудования, количество, цена, срок поставки и реквизиты поставщика.',
      sections: ['оборудован', 'цена', 'срок'],
    };
  return {
    why: 'Описывает проект и позволяет оценить обоснованность поддержки.',
    where:
      'Подготовьте с командой. Используйте редактор черновика, затем сверяйте с формой оператора.',
    contents: 'Цель, мероприятия, сроки, бюджет, измеримый результат и ответственные.',
    sections: ['цель', 'срок', 'бюджет', 'результат'],
  };
}
// Ищем упоминания разделов локально. Это не подтверждение достоверности документа.
export function inspectDocumentText(name: string, text: string) {
  if (text.length > 100000) throw new Error('DOCUMENT_TOO_LARGE');
  const normalized = text.normalize('NFKC').toLocaleLowerCase('ru-RU');
  const guide = documentGuide(name);
  const missing = guide.sections.filter((s) => !normalized.includes(s.toLocaleLowerCase('ru-RU')));
  return {
    missing,
    tooShort: text.trim().length < 100,
    status:
      missing.length || text.trim().length < 100
        ? 'Нужна доработка'
        : 'Упоминания разделов найдены',
    notice:
      'Локальная проверка ищет только упоминания разделов. Она не проверяет достоверность, подписи, актуальность или соответствие официальной форме.',
  };
}
export type DraftKind = 'project' | 'rationale' | 'cover';
export const draftKinds: Record<DraftKind, string> = {
  project: 'Описание проекта',
  rationale: 'Обоснование расходов',
  cover: 'Сопроводительное письмо',
};
// Неизвестные сведения оставляем пустыми для пользователя, а не придумываем.
export function generateDraft(
  kind: DraftKind,
  program: Program,
  profile: Profile,
  app: Application,
) {
  const header = `АВТОМАТИЧЕСКИЙ ШАБЛОН — ПРОВЕРЬТЕ И ОТРЕДАКТИРУЙТЕ\nПрограмма: ${program.title}\nЗаявитель: ${profile.name}\nИНН: ${profile.inn}\n`;
  const sections =
    kind === 'cover'
      ? [
          'Просим рассмотреть материалы проекта для участия в указанной программе.',
          'Цель проекта:',
          app.project || '[Укажите цель и краткое описание проекта]',
          'Приложения:',
          ...program.documents.map(
            (d) => `— ${d}: ${app.documents[d] ? 'отмечен пользователем' : 'не подготовлен'}`,
          ),
          'Контактное лицо: [заполните]',
          'Дата и подпись: [заполните]',
        ]
      : kind === 'rationale'
        ? [
            'Обоснование расходов',
            `Цели компании: ${profile.goals.join(', ')}`,
            `Бюджет проекта: ${app.budget || '[укажите]'} ₽`,
            'Статьи затрат: [наименование, количество, цена, источник расчёта]',
            'Связь затрат с результатом проекта: [обоснуйте каждую статью]',
            'Собственное финансирование: [источник, сумма, подтверждение]',
            'Ожидаемый результат: [измеримый показатель и срок]',
          ]
        : [
            'Описание проекта',
            `Цель: ${profile.goals.join(', ')}`,
            app.project || '[Опишите проблему, решение и целевую аудиторию]',
            `Бюджет: ${app.budget || '[укажите]'} ₽`,
            'Этапы и сроки: [мероприятие, начало, завершение]',
            'Ожидаемый результат: [показатель, исходное и целевое значение]',
            'Команда и ресурсы: [заполните]',
            'Риски и способы их снижения: [заполните]',
          ];
  return (
    header +
    '\n' +
    sections.join('\n\n') +
    '\n\nЭто автоматически подготовленный рабочий шаблон, а не утверждённая форма. Проверьте сведения и требования оператора. Заявка не отправлена.'
  );
}

export type CatalogSnapshot = Record<string, string>;
// Версия и срок образуют ключ события, по которому можно убрать повторные уведомления.
export function monitorChanges(
  profile: Profile,
  previous: CatalogSnapshot,
  catalog: Program[] = programs,
  now = new Date(),
) {
  const snapshot = Object.fromEntries(catalog.map((p) => [p.id, `${p.version}:${p.deadline}`]));
  const events = catalog
    .map((p) => ({ p, r: analyzeOpportunity(p, profile, undefined, now) }))
    .filter(({ r }) => r.canPrepare && r.unknown.length === 0)
    .flatMap(({ p, r }) => {
      const changed = previous[p.id] !== snapshot[p.id];
      const near = r.daysLeft <= 14;
      if (!changed && !near) return [];
      const kind = previous[p.id] === undefined ? 'new' : changed ? 'updated' : 'deadline';
      return [
        {
          key: `${p.id}:${snapshot[p.id]}:${kind}`,
          programId: p.id,
          kind,
          title:
            kind === 'new'
              ? 'Новая возможность'
              : kind === 'updated'
                ? 'Условия обновились'
                : 'Приближается дедлайн',
          text: `${p.title}\n${r.benefit.label}\nПодтверждено ${r.confirmed} из ${r.total} условий и документов (${r.score}%).\nДо окончания: ${r.daysLeft} дн.\nСовпадение не гарантирует одобрение.`,
        },
      ];
    });
  return { snapshot, events };
}
