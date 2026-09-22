import { ProviderNotConfiguredError, type CompanyDataProvider, type CompanyDataResult } from './types';

// TODO: импорт разрешённых официальных выгрузок ЕГРЮЛ/ЕГРИП в локальный индекс по ИНН.
// Нужны документированная схема, порядок доступа, обновления и ссылки на версии файлов.
// https://www.nalog.gov.ru/rn77/service/egrip2/
export class FNSOpenDataProvider implements CompanyDataProvider {
  readonly mode = 'official' as const;
  async getCompanyByInn(_inn: string): Promise<CompanyDataResult> {
    throw new ProviderNotConfiguredError();
  }
}

// TODO: импорт официальных файлов реестра МСП и сопоставление по ИНН.
// Отсутствие записи в неполной/устаревшей выгрузке не доказывает isSme=false.
// https://rmsp.nalog.ru/developers.html
export class SMERegistryProvider implements CompanyDataProvider {
  readonly mode = 'official' as const;
  async getCompanyByInn(_inn: string): Promise<CompanyDataResult> {
    throw new ProviderNotConfiguredError();
  }
}
