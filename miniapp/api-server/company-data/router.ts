import { Router } from 'express';
import { FNSRegistrySnapshotProvider } from './official-providers';
import { InvalidInnError } from './inn';
import { CompanyDataService } from './service';
import { ProviderNotConfiguredError } from './types';
import { CompanyProviderError } from './dadata';

// Единственная точка выбора provider; подключение официального адаптера не меняет маршруты.
export function companyDataRouter(service = new CompanyDataService(new FNSRegistrySnapshotProvider())) {
  const router = Router();
  router.get('/:inn', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await service.getCompanyByInn(req.params.inn);
      if (!result) {
        res.status(404).json({ code: 'COMPANY_NOT_FOUND', error: 'Компания не найдена в подключённом источнике' });
        return;
      }
      res.json(result);
    } catch (error) {
      if (error instanceof InvalidInnError)
        res.status(400).json({ code: 'INVALID_INN', error: 'Проверьте ИНН: нужны 10 или 12 цифр с верной контрольной суммой.' });
      else if (error instanceof CompanyProviderError)
        res.status(error.code === 'COMPANY_RATE_LIMITED' ? 429 : 503).json({ code: error.code, error: 'Сервис автозаполнения недоступен' });
      else if (error instanceof ProviderNotConfiguredError)
        res.status(503).json({ code: 'FNS_NOT_CONFIGURED', error: 'Официальный источник данных ещё не подключён' });
      else
        res.status(502).json({ code: 'FNS_UNAVAILABLE', error: 'Источник данных компании временно недоступен' });
    }
  });
  return router;
}
