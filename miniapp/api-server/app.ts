import express from 'express';
import compression from 'compression';
import cors from 'cors';
import { PrivacyError } from './privacy';
import { createGigaChatClient } from './gigachat';
import { fundingCatalogRouter } from './funding-catalog/router';
import { fundingCatalogStatus } from './funding-catalog/official-catalog';
import { companyDataRouter } from './company-data/router';
import { OfficialCompanyDataService } from './company-data/official-providers';
import { DaDataCompanyProvider } from './company-data/dadata';
import { CompanyDataService } from './company-data/service';
import { providerStatus } from './company-data/fns-index';
import { runAssistant } from './ai/service';
import { providerFailureCode, providerFailureReason } from './ai/errors';
import { prepareAIContext } from './ai/context';
import type { AIEvidence, AIResult } from './ai/types';
import { SourceStore } from './ai/sources';
import { FundingCatalogService } from './funding-catalog/service';
import { LiveCatalog } from './funding-catalog/live';
import { withAICatalog } from './funding-catalog/ai-runtime';
import { NotificationStore, notificationRouter } from './funding-catalog/notifications';
import { untilAborted } from './funding-catalog/abort';
import { accountRouter } from './account';

export type AIClient = { complete(input: unknown): Promise<{ answer: string; mode: string }>; assist?(input: unknown, evidence?: AIEvidence[], signal?: AbortSignal): Promise<AIResult> };
function isCertificateError(error: unknown): boolean {
  const codes = ['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED'];
  for (let depth = 0; depth < 4 && error && typeof error === 'object'; depth++) {
    if ('code' in error && codes.includes(String(error.code))) return true;
    error = 'cause' in error ? error.cause : undefined;
  }
  return false;
}
export function createApp(options: { giga?: AIClient | null; fnsDir?: string; env?: NodeJS.ProcessEnv; sources?: SourceStore; catalog?: LiveCatalog; notifications?: NotificationStore; notificationStatus?: () => { lastRun: string | null; lastError: string | null } } = {}) {
  const env = options.env ?? process.env;
  const dadata = env.DADATA_API_KEY?.trim() ? new DaDataCompanyProvider(env.DADATA_API_KEY.trim()) : null;
  const sources = options.sources ?? new SourceStore(env.OPORA_SOURCE_DIR);
  const model = env.GIGACHAT_MODEL || 'GigaChat-2-Pro';
  let giga = options.giga;
  let invalidConfig = false;
  if (giga === undefined) {
    try { giga = env.GIGACHAT_AUTH_KEY ? createGigaChatClient({ authKey: env.GIGACHAT_AUTH_KEY, scope: env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS', model }) : null; }
    catch { giga = null; invalidConfig = true; }
  }
  let lastSuccess: string | null = null, lastError: string | null = invalidConfig ? 'configuration' : null;
  let lastFailure: { code: string; task: string; at: string } | null = null;
  const taskStatus: Record<string, { status: 'ready' | 'limited' | 'unavailable'; at: string; code?: string }> = {};
  const aiStatus = () => ({ configured: Boolean(giga || env.GIGACHAT_AUTH_KEY), provider: 'gigachat', model,
    status: !giga ? invalidConfig ? 'unavailable' : 'not_configured' : lastError ? ['request_rejected', 'invalid_response'].includes(lastError) ? 'limited' : 'unavailable' : lastSuccess ? 'ready' : 'unavailable',
    checked: Boolean(lastSuccess || lastError), lastSuccess, lastFailure, tasks: taskStatus, reason: lastError ?? (giga && !lastSuccess ? 'not_verified' : null) });
  const app = express(); app.disable('x-powered-by');
  // Production ingress is local Nginx (or the local frontend proxy). Trust only
  // loopback hops, so clients behind it do not share the proxy's rate-limit key.
  // Untrusted public peers cannot choose their identity via X-Forwarded-For.
  app.set('trust proxy', 'loopback');
  // The HTTPS ingress can route /api directly here, bypassing the frontend proxy.
  app.use(compression());
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
  app.use(cors({ origin: (env.APP_ORIGIN || 'http://localhost:3000').split(',').map((s) => s.trim()) }));
  app.use('/api/ai/assist', express.json({ limit: '384kb' }));
  app.use(express.json({ limit: '48kb' }));
  const requests = new Map<string, { count: number; reset: number }>();
  app.use('/api', (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of requests) if (value.reset < now) requests.delete(key);
    const isAI = req.path === '/assistant' || req.path === '/ai/assist';
    const key = `${req.ip}:${isAI ? 'ai' : 'api'}`;
    const usage = requests.get(key) ?? { count: 0, reset: now + 60000 };
    if (++usage.count > (isAI ? 15 : 120)) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'Слишком много запросов. Повторите через минуту.', code: 'RATE_LIMITED' }); return; }
    requests.set(key, usage); next();
  });
  app.get('/api/health', (_req, res) => res.set('Cache-Control', 'no-store').json({ status: 'ok', service: 'opora', revision: process.env.OPORA_RELEASE_SHA || null, catalog: 'official', privacy: 'context-v2', legacyPrivacy: 'strict-v1' }));
  app.get('/api/ai/status', (_req, res) => res.json(aiStatus()));
  app.get('/api/providers/status', (_req, res) => res.json({ company: { ...providerStatus(options.fnsDir), activeProvider: dadata ? 'dadata' : 'fns', dadata: dadata?.status() ?? { configured: false, state: 'not_configured', lastSuccess: null } },
    funding: { officialSnapshot: 'ready', opportunities: fundingCatalogStatus().total, verifiedAt: fundingCatalogStatus().verifiedAt }, ai: { gigachat: aiStatus().status } }));
  app.use('/api/company', companyDataRouter(dadata ? new CompanyDataService(dadata) : new OfficialCompanyDataService(options.fnsDir)));
  if (options.catalog) app.get('/api/funding/live-status', (_req, res) => res.json(options.catalog!.status()));
  if (options.notifications) app.use('/api/notifications', notificationRouter(options.notifications, env.BOT_TOKEN ?? '', !!giga, options.notificationStatus));
  if (options.notifications) app.use('/api/account', accountRouter(options.notifications, env.BOT_TOKEN ?? ''));
  app.use('/api/funding', fundingCatalogRouter(new FundingCatalogService(undefined, options.catalog)));
  if (options.catalog) app.use('/api/ai', (_req, _res, next) => withAICatalog(options.catalog!.getCatalog(), next));
  app.get('/api/funding/updates', async (_req, res, next) => { try { res.json(await sources.status()); } catch (e) { next(e); } });
  let activeAI = 0;
  app.post('/api/ai/assist', async (req, res) => {
    try { prepareAIContext(req.body); }
    catch (error) {
      const code = error instanceof PrivacyError ? error.code : 'INVALID_INPUT';
      const messages: Record<string, string> = {
        INVALID_PROGRAM: 'Программа изменилась в каталоге. Откройте её заново из раздела поддержки.',
        INVALID_FUNDING_NEED: 'Проверьте параметры бизнеса и суммы в потребности.',
        FIELD_TOO_LONG: 'Сократите документы до 60 000 символов суммарно и повторите запрос.',
      };
      res.status(400).json({ error: messages[code] ?? 'Проверьте вопрос, профиль и объём документов.', code }); return;
    }
    if (activeAI >= 4) { res.status(429).json({ error: 'Помощник занят. Повторите запрос через минуту.', code: 'AI_BUSY' }); return; }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('AI deadline exceeded', 'TimeoutError')), 65000);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect); activeAI++;
    try {
      if (options.catalog && typeof req.body?.context?.programId === 'string' && req.body.context.programId.startsWith('budget-')) {
        try { await untilAborted(options.catalog.enrich(req.body.context.programId), AbortSignal.any([controller.signal, AbortSignal.timeout(12000)])); } catch { /* Unverified details remain explicitly unknown. */ }
      }
      controller.signal.throwIfAborted();
      // The change-monitor archive is optional and only used by change analysis.
      // An unreadable snapshot must not take down chat or document processing.
      const evidence = req.body.task === 'changes'
        ? await untilAborted(sources.evidence().catch(() => []), controller.signal) : [];
      const result = await untilAborted(giga?.assist ? giga.assist(req.body, evidence, controller.signal) : runAssistant(req.body, undefined, evidence, controller.signal), controller.signal);
      if (result.mode === 'llm') { lastSuccess = new Date().toISOString(); lastError = null; taskStatus[req.body.task] = { status: 'ready', at: lastSuccess }; }
      else if (giga) {
        const code = providerFailureCode({ code: result.providerFailure });
        lastError = providerFailureReason(code);
        lastFailure = { code, task: req.body.task, at: new Date().toISOString() };
        taskStatus[req.body.task] = { status: ['request_rejected', 'invalid_response'].includes(lastError) ? 'limited' : 'unavailable', at: lastFailure.at, code };
      }
      if (!controller.signal.aborted) res.json(result);
    } catch (error) {
      // Closing the screen is not an outage of the shared AI service.
      if (!res.destroyed) {
        const code = providerFailureCode(controller.signal.aborted ? controller.signal.reason : error);
        lastError = providerFailureReason(code);
        lastFailure = { code, task: req.body.task, at: new Date().toISOString() };
        taskStatus[req.body.task] = { status: lastError === 'request_rejected' ? 'limited' : 'unavailable', at: lastFailure.at, code };
        res.status(502).json({ error: code, code });
      }
    } finally { clearTimeout(timeout); res.off('close', disconnect); activeAI--; }
  });
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
