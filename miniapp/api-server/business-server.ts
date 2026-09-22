// HTTP-маршруты Опоры. Секреты провайдера остаются на сервере.
import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import path from 'node:path';
import { PrivacyError } from './privacy';
import { createGigaChatClient } from './gigachat';
import { demoProfile, programs, shortlist, monitorChanges } from './support-model';
import { companyDataRouter } from './company-data/router';

config({ path: path.resolve(process.cwd(), '../../.env') });
config();
const giga = process.env.GIGACHAT_AUTH_KEY
  ? createGigaChatClient({
      authKey: process.env.GIGACHAT_AUTH_KEY,
      scope: process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS',
      model: process.env.GIGACHAT_MODEL || 'GigaChat',
    })
  : null;
const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(cors({ origin: process.env.APP_ORIGIN || 'http://localhost:3000' }));
app.use(express.json({ limit: '48kb' }));
app.use('/api/company', companyDataRouter());
const requests = new Map<string, { count: number; reset: number }>();
app.get('/api/health', (_req, res) =>
  res.json({
    status: 'ok',
    service: 'opora',
    catalog: 'demo',
    assistant: giga ? 'configured' : 'local',
    provider: 'gigachat',
    privacy: 'strict-v1',
  }),
);
// Публичный учебный пример не принимает профиль или адресата пользователя.
app.get('/api/demo-notification', (_req, res) => {
  const candidates = shortlist(demoProfile);
  const first = candidates.find((x) => x.p.id === 'equipment') || candidates[0];
  if (!first) {
    res.status(404).json({ error: 'Нет открытых учебных программ' });
    return;
  }
  const previous = Object.fromEntries(programs.map((p) => [p.id, `${p.version}:${p.deadline}`]));
  delete previous[first.p.id];
  const event = monitorChanges(demoProfile, previous).events.find(
    (e) => e.programId === first.p.id,
  );
  if (!event) {
    res.status(404).json({ error: 'Нет подходящего события' });
    return;
  }
  res.json({
    programId: event.programId,
    text: `ДЕМОНСТРАЦИЯ · УЧЕБНЫЙ ПРОФИЛЬ\n\n🟢 ${event.title}\n\n${event.text}\n\nЭто ответ на команду /demo, а не результат фонового мониторинга вашей компании.`,
  });
});
app.post('/api/assistant', async (req, res) => {
  const now = Date.now();
  for (const [key, value] of requests) if (value.reset < now) requests.delete(key);
  const key = req.ip || 'unknown';
  const usage = requests.get(key) || { count: 0, reset: now + 60000 };
  if (++usage.count > 15) {
    res.status(429).json({ error: 'Слишком много запросов. Попробуйте через минуту.' });
    return;
  }
  requests.set(key, usage);
  const { question, context } = req.body || {};
  if (
    typeof question !== 'string' ||
    !question.trim() ||
    question.length > 2000 ||
    !context ||
    typeof context !== 'object'
  ) {
    res.status(400).json({ error: 'Некорректный запрос' });
    return;
  }
  if (!giga) {
    res.status(503).json({ error: 'GigaChat не подключён', mode: 'local' });
    return;
  }
  try {
    const result = await giga.complete(req.body);
    res.json(result);
  } catch (error) {
    if (
      error instanceof PrivacyError &&
      error.code.startsWith('INVALID_') &&
      error.code !== 'INVALID_RESPONSE' &&
      error.code !== 'INVALID_PROVIDER_URL'
    ) {
      res.status(400).json({ error: 'INVALID_INPUT' });
      return;
    }
    res.status(502).json({ error: 'AI временно недоступен', mode: 'local' });
  }
});
app.use(
  (
    error: { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(error.status === 413 ? 413 : 400).json({ error: 'Не удалось обработать запрос' });
  },
);
const port = Number(process.env.PORT || 3002);
app.listen(port, '0.0.0.0', () => console.log(`Opora API: http://localhost:${port}/api/health`));
