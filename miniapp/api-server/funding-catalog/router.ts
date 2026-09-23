import { calendarICS } from './calendar';
import { Router } from 'express';
import { FundingCatalogService } from './service';
import { FundingInputError } from './input';

export function fundingCatalogRouter(service = new FundingCatalogService()) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.get('/catalog', (_req, res) => res.json({ mode: 'official', opportunities: service.getCatalog() }));
  router.get('/calendar.ics', (_req, res) => { res.type('text/calendar').setHeader('Content-Disposition', 'attachment; filename=opora-calendar.ics'); res.send(calendarICS(service.getCatalog())); });
  router.get('/status', (_req, res) => res.json(service.status()));
  router.post('/match', (req, res) => {
    try { res.json(service.match(req.body)); }
    catch (error) {
      res.status(error instanceof FundingInputError ? 400 : 500).json({
        code: error instanceof FundingInputError ? 'INVALID_INPUT' : 'INTERNAL_ERROR',
        error: error instanceof FundingInputError ? error.message : 'Не удалось рассчитать варианты финансирования.',
      });
    }
  });
  return router;
}
