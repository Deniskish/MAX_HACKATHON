export const allFundingPurposes = 'Все цели' as const;
export const fundingPurposes = [allFundingPurposes,
  'Запуск или развитие бизнеса', 'Оборудование и модернизация', 'Оборотные расходы',
  'Разработка продукта / технологии', 'Продажи, продвижение и экспорт',
  'Персонал и обучение', 'Помещения и инфраструктура',
] as const;
export type FundingPurpose = typeof fundingPurposes[number];

// Source facts stay unchanged. These categories group published purposes, not new programme conditions.
export const legacyPurposeMapping = {
  'покупка оборудования': 'Оборудование и модернизация',
  'сельхозтехника': 'Оборудование и модернизация',
  'запуск производства': 'Запуск или развитие бизнеса',
  'масштабирование': 'Запуск или развитие бизнеса',
  'оборотные средства': 'Оборотные расходы',
  'разработка продукта': 'Разработка продукта / технологии',
  'найм сотрудников': 'Персонал и обучение',
  'экспорт': 'Продажи, продвижение и экспорт',
  'аренда / недвижимость': 'Помещения и инфраструктура',
} as const satisfies Record<string, FundingPurpose>;
export const legacyFundingPurposes = Object.keys(legacyPurposeMapping);

export function normalizeFundingPurpose(value: string): FundingPurpose | undefined {
  if (value === '') return allFundingPurposes; // Older workspaces stored an unset purpose as an empty string.
  if (fundingPurposes.some(p => p === value)) return value as FundingPurpose;
  return Object.prototype.hasOwnProperty.call(legacyPurposeMapping, value)
    ? legacyPurposeMapping[value as keyof typeof legacyPurposeMapping] : undefined;
}
export const isAllFundingPurposes = (value: string) => normalizeFundingPurpose(value) === allFundingPurposes;
export function programmePurposeCategories(purposes: string[]): FundingPurpose[] {
  return [...new Set(purposes.map(normalizeFundingPurpose)
    .filter((p): p is FundingPurpose => p !== undefined && p !== allFundingPurposes))];
}
export function fundingPurposeFit(purpose: string, published: string[]): 'unrestricted' | 'match' | 'mismatch' | 'unknown' {
  const category = normalizeFundingPurpose(purpose);
  if (category === allFundingPurposes) return 'unrestricted';
  if (!category) return 'unknown';
  if (programmePurposeCategories(published).includes(category)) return 'match';
  return published.length && published.every(p => {
    const mapped = normalizeFundingPurpose(p);
    return mapped !== undefined && mapped !== allFundingPurposes;
  }) ? 'mismatch' : 'unknown';
}
export function fundingTaskLabel(need: { purpose: string; amount: number | null }): string {
  return `${normalizeFundingPurpose(need.purpose) ?? allFundingPurposes} · ${need.amount === null
    ? 'сумма не указана' : `${need.amount.toLocaleString('ru-RU')} ₽`}`;
}
