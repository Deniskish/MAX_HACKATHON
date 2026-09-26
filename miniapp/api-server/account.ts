import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { NotificationStore, verifyMaxUser } from './funding-catalog/notifications';
import { parseFundingProfile } from './funding-catalog/input';
import { validInn } from './company-data/inn';

export function accountRouter(store: NotificationStore, token: string) {
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS accounts(user_id TEXT PRIMARY KEY,id TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL,company TEXT,revision INTEGER NOT NULL DEFAULT 0)`);
  const router = Router();
  router.use((req, res, next) => {
    if (!token.trim()) { res.status(503).json({ error: 'Вход через MAX временно не настроен на сервере.', code: 'MAX_NOT_CONFIGURED' }); return; }
    try { res.locals.user = verifyMaxUser(req.header('X-Max-Init-Data') ?? '', token); }
    catch { res.status(401).json({ error: 'Откройте приложение заново через MAX.', code: 'MAX_AUTH_REQUIRED' }); return; }
    db.prepare('INSERT OR IGNORE INTO accounts(user_id,id,created_at) VALUES(?,?,?)').run(res.locals.user, randomUUID(), Date.now());
    next();
  });
  const state = (user: string) => {
    const row = db.prepare('SELECT id,created_at,company,revision FROM accounts WHERE user_id=?').get(user) as any;
    return { id: row.id, createdAt: row.created_at, company: row.company ? JSON.parse(row.company) : null, revision: row.revision,
      identity: 'max', authority: 'unverified', esia: 'not_configured', canSubmitApplications: false };
  };
  router.get('/', (_req, res) => res.json(state(res.locals.user)));
  router.put('/company', (req, res) => {
    try {
      const input = req.body?.company, facts = parseFundingProfile(input);
      if (!validInn(input?.inn) || typeof input?.name !== 'string' || !input.name.trim() || input.name.length > 120 || !facts.region || !facts.okved) throw new Error('INVALID_COMPANY');
      const row = state(res.locals.user);
      if (req.body.revision !== row.revision) { res.status(409).json({ error: 'Профиль уже изменён на другом устройстве. Обновите страницу.', code: 'ACCOUNT_CONFLICT' }); return; }
      // Public company facts only. Client-supplied authority/verification claims are never stored.
      const company = { ...facts, inn: input.inn, name: input.name.trim() };
      db.prepare('UPDATE accounts SET company=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(company), res.locals.user);
      res.json(state(res.locals.user));
    } catch { res.status(400).json({ error: 'Проверьте ИНН, название, регион и ОКВЭД.', code: 'INVALID_COMPANY' }); }
  });
  router.delete('/company', (_req, res) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of ['subscriptions', 'assessments', 'notifications']) db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(res.locals.user);
      db.prepare('UPDATE accounts SET company=NULL,revision=revision+1 WHERE user_id=?').run(res.locals.user);
      db.exec('COMMIT'); res.json(state(res.locals.user));
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });
  router.post('/verification/esia', (_req, res) => res.status(503).json({ code: 'ESIA_NOT_CONFIGURED', error: 'Проверка через Госуслуги пока не подключена.' }));
  return router;
}
