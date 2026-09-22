import { Router } from 'express';
import { DemoCompanyDataProvider } from './demo-provider';
import { InvalidInnError } from './inn';
import { CompanyDataService } from './service';
import { ProviderNotConfiguredError } from './types';

// Единственная точка выбора provider; подключение официального адаптера не меняет маршруты.
export function companyDataRouter(service = new CompanyDataService(new DemoCompanyDataProvider())) {
  const router = Router();
  router.get('/:inn', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const result = await service.getCompanyByInn(req.params.inn);
      if (!result) {
        res.status(404).json({ error: 'Компания не найдена в подключённом источнике' });
        return;
      }
      res.json(result);
    } catch (error) {
      if (error instanceof InvalidInnError)
        res.status(400).json({ error: 'Проверьте ИНН: нужны 10 или 12 цифр с верной контрольной суммой.' });
      else if (error instanceof ProviderNotConfiguredError)
        res.status(503).json({ error: 'Официальный источник данных ещё не подключён' });
      else
        res.status(502).json({ error: 'Источник данных компании временно недоступен' });
    }
  });
  return router;
}
