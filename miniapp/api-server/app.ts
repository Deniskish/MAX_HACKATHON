import express from 'express';
import cors from 'cors';
import { PrivacyError } from './privacy';
import { createGigaChatClient } from './gigachat';
import { fundingCatalogRouter } from './funding-catalog/router';
import { fundingCatalogStatus } from './funding-catalog/official-catalog';
import { companyDataRouter } from './company-data/router';
import { OfficialCompanyDataService } from './company-data/official-providers';
import { providerStatus } from './company-data/fns-index';

export type AIClient = { complete(input: unknown): Promise<{ answer: string; mode: string }> };
function isCertificateError(error: unknown): boolean {
  const codes = ['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED'];
  for (let depth = 0; depth < 4 && error && typeof error === 'object'; depth++) {
    if ('code' in error && codes.includes(String(error.code))) return true;
    error = 'cause' in error ? error.cause : undefined;
  }
  return false;
}
export function createApp(options: { giga?: AIClient | null; fnsDir?: string; env?: NodeJS.ProcessEnv } = {}) {
  const env = options.env ?? process.env;
  const model = env.GIGACHAT_MODEL || 'GigaChat-2-Pro';
  let giga = options.giga;
  let invalidConfig = false;
  if (giga === undefined) {
    try { giga = env.GIGACHAT_AUTH_KEY ? createGigaChatClient({ authKey: env.GIGACHAT_AUTH_KEY, scope: env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS', model }) : null; }
    catch { giga = null; invalidConfig = true; }
  }
  let lastSuccess: string | null = null, lastError: string | null = invalidConfig ? 'configuration' : null;
  const aiStatus = () => ({ configured: Boolean(giga || env.GIGACHAT_AUTH_KEY), provider: 'gigachat', model,
    status: !giga ? invalidConfig ? 'unavailable' : 'not_configured' : lastError ? 'unavailable' : lastSuccess ? 'ready' : 'unavailable',
    checked: Boolean(lastSuccess || lastError), lastSuccess, reason: lastError ?? (giga && !lastSuccess ? 'not_verified' : null) });
  const app = express(); app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
  app.use(cors({ origin: (env.APP_ORIGIN || 'http://localhost:3000').split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '48kb' }));
  const requests = new Map<string, { count: number; reset: number }>();
  app.use('/api', (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of requests) if (value.reset < now) requests.delete(key);
    const key = `${req.ip}:${req.path === '/assistant' ? 'ai' : 'api'}`;
    const usage = requests.get(key) ?? { count: 0, reset: now + 60000 };
    if (++usage.count > (req.path === '/assistant' ? 15 : 120)) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'Слишком много запросов. Повторите через минуту.', code: 'RATE_LIMITED' }); return; }
    requests.set(key, usage); next();
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'opora', catalog: 'official', privacy: 'strict-v1' }));
  app.get('/api/ai/status', (_req, res) => res.json(aiStatus()));
  app.get('/api/providers/status', (_req, res) => res.json({ company: providerStatus(options.fnsDir),
    funding: { officialSnapshot: 'ready', opportunities: fundingCatalogStatus().total, verifiedAt: fundingCatalogStatus().verifiedAt }, ai: { gigachat: aiStatus().status } }));
  app.use('/api/company', companyDataRouter(new OfficialCompanyDataService(options.fnsDir)));
  app.use('/api/funding', fundingCatalogRouter());
  app.post('/api/assistant', async (req, res) => {
    if (typeof req.body?.question !== 'string' || !req.body.question.trim() || req.body.question.length > 2000 || !req.body.context || typeof req.body.context !== 'object' || Array.isArray(req.body.context)) {
      res.status(400).json({ error: 'Проверьте вопрос и контекст.', code: 'INVALID_INPUT' }); return;
    }
    if (!giga) { res.status(503).json({ error: 'GigaChat не настроен. Подбор по правилам доступен.', code: 'AI_NOT_CONFIGURED' }); return; }
    try {
      const result = await giga.complete(req.body);
      lastSuccess = new Date().toISOString(); lastError = null;
      res.json(result);
    } catch (error) {
      if (error instanceof PrivacyError && ['INVALID_INPUT', 'INVALID_QUESTION', 'INVALID_PROGRAM', 'INVALID_FUNDING_NEED', 'FIELD_TOO_LONG'].includes(error.code)) {
        res.status(400).json({ error: 'Проверьте вопрос и контекст.', code: 'INVALID_INPUT' }); return;
      }
      const tls = isCertificateError(error);
      lastError = tls ? 'tls' : error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'provider';
      const limited = error instanceof PrivacyError && error.code === 'PROVIDER_RATE_LIMITED';
      res.status(limited ? 429 : 502).json({ error: limited ? 'Лимит GigaChat исчерпан. Повторите позже.' : tls ? 'Сервер не доверяет сертификату GigaChat. Администратору нужно проверить доверенную цепочку и при необходимости NODE_EXTRA_CA_CERTS. TLS-проверка включена.' : 'GigaChat временно недоступен. Подбор по правилам продолжает работать.', code: limited ? 'AI_RATE_LIMITED' : tls ? 'AI_TLS_ERROR' : 'AI_UNAVAILABLE' });
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Маршрут не найден.', code: 'NOT_FOUND' }));
  app.use((error: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error.status === 413 || error.status === 400 ? 400 : 500;
    res.status(status).json({ error: status === 400 ? 'Некорректный или слишком большой запрос.' : 'Внутренняя ошибка сервера.', code: status === 400 ? 'INVALID_INPUT' : 'INTERNAL_ERROR' });
  });
  return app;
}
