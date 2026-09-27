import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import type { DatabaseSync } from 'node:sqlite';

// Separate service credentials from MAX WebApp initData. Only the bot process
// signs requests; a user id or a callback payload alone never authenticates one.
export function botAccess(token: string): RequestHandler {
  const used = new Map<string, number>();
  return (req, res, next) => {
    if (!req.header('X-Opora-Bot-User')) { next(); return; }
    const user = req.header('X-Opora-Bot-User') ?? '';
    const timestamp = req.header('X-Opora-Bot-Time') ?? '';
    const nonce = req.header('X-Opora-Bot-Nonce') ?? '';
    const signature = req.header('X-Opora-Bot-Signature') ?? '';
    const now = Date.now();
    for (const [id, expires] of used) if (expires < now) used.delete(id);
    const valid = token && /^[1-9]\d{0,15}$/.test(user) && Number.isSafeInteger(Number(user)) &&
      /^\d{13}$/.test(timestamp) && Math.abs(now - Number(timestamp)) < 60000 &&
      /^[a-f0-9-]{36}$/.test(nonce) && /^[a-f0-9]{64}$/.test(signature);
    if (!valid) { res.status(401).json({ code: 'BOT_AUTH_REQUIRED' }); return; }
    const key = createHmac('sha256', token).update('opora-bot-api-v1').digest();
    const expected = createHmac('sha256', key).update([
      req.method, req.originalUrl, user, timestamp, nonce,
      JSON.stringify(req.body ?? {}),
    ].join('\n')).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')) || used.has(nonce)) {
      res.status(401).json({ code: 'BOT_AUTH_REQUIRED' }); return;
    }
    if (used.size >= 20000) { res.status(429).json({ code: 'BOT_BUSY' }); return; }
    used.set(nonce, now + 120000);
    res.locals.botUser = user;
    next();
  };
}

export function botWorkspaceRouter(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS bot_workspaces (
    user_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 0)`);
  const router = Router();
  router.use((_req, res, next) => {
    if (!res.locals.botUser) { res.status(401).json({ code: 'BOT_AUTH_REQUIRED' }); return; }
    next();
  });
  const read = (user: string) => {
    const row = db.prepare('SELECT data, revision FROM bot_workspaces WHERE user_id=?').get(user) as { data: string; revision: number } | undefined;
    return { data: row ? JSON.parse(row.data) : {}, revision: row?.revision ?? 0 };
  };
  router.get('/workspace', (_req, res) => res.json(read(res.locals.botUser)));
  router.put('/workspace', (req, res) => {
    const data = req.body?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data) || JSON.stringify(data).length > 80000 ||
      !Number.isSafeInteger(req.body.revision) || req.body.revision < 0) {
      res.status(400).json({ code: 'INVALID_BOT_WORKSPACE' }); return;
    }
    db.prepare('INSERT OR IGNORE INTO bot_workspaces(user_id) VALUES(?)').run(res.locals.botUser);
    const changed = db.prepare('UPDATE bot_workspaces SET data=?,revision=revision+1 WHERE user_id=? AND revision=?')
      .run(JSON.stringify(data), res.locals.botUser, req.body.revision);
    if (!changed.changes) { res.status(409).json({ code: 'BOT_WORKSPACE_CONFLICT' }); return; }
    res.json(read(res.locals.botUser));
  });
  return router;
}
