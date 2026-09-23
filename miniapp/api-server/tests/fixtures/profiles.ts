import type { Profile, Program } from '../../support-model';
import catalog from './trusted-programs.json';
export const programs = catalog as Program[];
export const demoProfile: Profile = {
  inn: '7707083893',
  name: 'ООО «Новая идея» · учебный профиль',
  region: 'Москва',
  companyType: 'ООО',
  okved: '62.01',
  ageMonths: 26,
  employees: 12,
  revenue: 18000000,
  isSme: 'yes',
  tax: 'УСН',
  goals: ['Разработка продукта', 'Покупка оборудования'],
};
