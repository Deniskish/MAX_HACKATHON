// Данные бизнеса и подготовленных заявок. Условия мер — в funding-catalog/types.
import type { FieldProvenance } from './company-data/types';

export type ProfileValues = {
  industry?: string;
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
  documentTexts?: Record<string, { id: string; name: string; pages: { page: number; text: string }[] }>;
};
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
  industry: '',
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
