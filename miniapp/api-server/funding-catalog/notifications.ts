import { DatabaseSync } from 'node:sqlite';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { providerJson } from '../provider-json';
import { emptyFundingNeed, type FundingProfile, type FundingNeed, type FundingOpportunity } from './types';
import { parseFundingProfile, parseFundingNeed } from './input';
import { matchFundingOpportunity } from './matching';
import { catalogHash, type LiveCatalog } from './live';
import type { AssessOpportunity } from './notification-ai';

export function verifyMaxUser(raw: string, token: string, now = Date.now()): string {
  if (!token || !raw || raw.length > 16000) throw new Error('AUTH_REQUIRED');
  const params = new URLSearchParams(raw), seen = new Set<string>();
  for (const [key] of params) { if (seen.has(key)) throw new Error('INVALID_AUTH'); seen.add(key); }
  const hash = params.get('hash') ?? '', issued = Number(params.get('auth_date'));
  if (!/^[a-f0-9]{64}$/i.test(hash) || !Number.isSafeInteger(issued) || issued * 1000 > now + 60000 || issued * 1000 < now - 86400000) throw new Error('AUTH_EXPIRED');
  params.delete('hash');
  const data = [...params].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(data).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw new Error('INVALID_AUTH');
  const user = JSON.parse(params.get('user') ?? 'null');
  if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw new Error('INVALID_AUTH');
  return String(user.id);
}
type Subscription = { user_id: string; profile: string; need: string; context_hash: string; bot: number; created_at: number };
export class NotificationStore {
  readonly db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file); this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS subscriptions(user_id TEXT PRIMARY KEY,profile TEXT NOT NULL,need TEXT NOT NULL,context_hash TEXT NOT NULL,bot INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS assessments(user_id TEXT NOT NULL,program_id TEXT NOT NULL,version TEXT NOT NULL,context_hash TEXT NOT NULL,next_at INTEGER NOT NULL,done INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,program_id,version,context_hash));
      CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,program_id TEXT NOT NULL,version TEXT NOT NULL,context_hash TEXT NOT NULL,title TEXT NOT NULL,reason TEXT NOT NULL,source TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER,bot_state TEXT NOT NULL,next_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,UNIQUE(user_id,program_id,version));
      CREATE TABLE IF NOT EXISTS worker_lock(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
  }
  get(user: string) { return this.db.prepare('SELECT * FROM subscriptions WHERE user_id=?').get(user) as Subscription | undefined; }
  subscribe(user: string, profile: FundingProfile, need: FundingNeed, bot: boolean, now = Date.now()) {
    const hash = catalogHash({ profile, need }), previous = this.get(user);
    this.db.prepare(`INSERT INTO subscriptions VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET profile=excluded.profile,need=excluded.need,context_hash=excluded.context_hash,bot=excluded.bot`).run(user, JSON.stringify(profile), JSON.stringify(need), hash, +bot, now);
    if (previous?.context_hash !== hash || !bot) this.db.prepare("UPDATE notifications SET bot_state='cancelled' WHERE user_id=? AND bot_state='pending'").run(user);
  }
  remove(user: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try { for (const table of ['subscriptions', 'assessments', 'notifications']) this.db.prepare(`DELETE FROM ${table} WHERE user_id=?`).run(user); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  list(user: string) { return this.db.prepare('SELECT id,program_id AS programId,title,reason,source,created_at AS createdAt,read_at AS readAt,bot_state AS delivery FROM notifications WHERE user_id=? AND context_hash=(SELECT context_hash FROM subscriptions WHERE user_id=?) ORDER BY created_at DESC LIMIT 100').all(user, user); }
  status() { return { subscribers: (this.db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get() as any).n,
    pending: (this.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE bot_state='pending'").get() as any).n }; }
}
export function notificationRouter(store: NotificationStore, token: string, aiConfigured: boolean, monitor?: () => { lastRun: string | null; lastError: string | null }) {
  const router = Router();
  router.use((req, res, next) => {
    try { res.locals.user = verifyMaxUser(req.header('X-Max-Init-Data') ?? '', token); next(); }
    catch { res.status(401).json({ error: 'Откройте приложение заново через MAX.', code: 'MAX_AUTH_REQUIRED' }); }
  });
  router.get('/', (_req, res) => { const sub = store.get(res.locals.user); res.json({ enabled: !!sub, bot: !!sub?.bot, aiConfigured, monitor: monitor?.(), items: store.list(res.locals.user) }); });
  router.put('/subscription', (req, res) => {
    try {
      const profile = parseFundingProfile(req.body?.profile), need = req.body?.need?.purpose ? parseFundingNeed(req.body.need) : { ...emptyFundingNeed };
      if (!profile.region || !(profile.okved || profile.industry || profile.goals?.length) || typeof req.body?.bot !== 'boolean') throw new Error('INVALID_PROFILE');
      store.subscribe(res.locals.user, profile, need, req.body.bot); res.json({ enabled: true, bot: req.body.bot });
    } catch { res.status(400).json({ error: 'Укажите регион и направление бизнеса.', code: 'INVALID_PROFILE' }); }
  });
  router.delete('/subscription', (_req, res) => { store.remove(res.locals.user); res.json({ enabled: false }); });
  router.post('/read', (req, res) => {
    if (typeof req.body?.id !== 'string') { res.sendStatus(400); return; }
    store.db.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?').run(Date.now(), req.body.id, res.locals.user); res.json({ ok: true });
  });
  return router;
}
export function notificationCandidate(profile: FundingProfile, need: FundingNeed, o: FundingOpportunity, now = Date.now()) {
  if (o.status !== 'active' || !o.imported || !Number.isFinite(Date.parse(o.imported.endsAt)) || Date.parse(o.imported.endsAt) <= now) return false;
  const geography = o.imported.detail?.geography;
  if (geography?.length && profile.region) {
    const normalize = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/республика|область|край|город|\bг\.|\bобл\./g, '').replace(/[^а-яa-z0-9]/g, '');
    const region = normalize(profile.region);
    if (region && !geography.some((g) => /^(российская федерация|вся россия)$/i.test(g.trim())
      || !!normalize(g) && (normalize(g).includes(region) || region.includes(normalize(g))))) return false;
  }
  const match = matchFundingOpportunity(profile, { ...need, purpose: '' }, o, { now: new Date(now) });
  if (match.missingRequirements.some((r) => r.required) || match.amountFit === 'no') return false;
  // Cheap shortlist only; the model must still establish territorial and sector relevance from the source.
  const words = `${profile.industry ?? ''} ${(profile.goals ?? []).join(' ')} ${need.purpose}`.toLowerCase().match(/[а-яё]{5,}/g) ?? [];
  const title = o.title.toLowerCase();
  return /мал[оы].*предприним|субъект.*мсп/i.test(title) && profile.isSme !== 'no'
    || words.some((word) => title.includes(word.slice(0, 6)));
}
export type SendNotification = (user: string, text: string, programId: string) => Promise<void>;
export function maxSender(token: string, miniappUrl: string, transport: typeof fetch = fetch, botUsername?: string): SendNotification {
  const base = new URL(miniappUrl);
  if (base.protocol !== 'https:') throw new Error('INVALID_MINIAPP_URL');
  return async (user, text, programId) => {
    const name = botUsername?.replace(/^@/, '');
    const link = name && /^[a-zA-Z0-9_]{3,80}$/.test(name) ? new URL(`https://max.ru/${name}`) : new URL(base);
    link.searchParams.set(link.hostname === 'max.ru' ? 'startapp' : 'program', programId);
    const response = await transport(`https://platform-api2.max.ru/messages?user_id=${encodeURIComponent(user)}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 3900), notify: true, attachments: [{ type: 'inline_keyboard', payload: {
        buttons: [[{ type: 'link', text: 'Посмотреть меру', url: link.href }]] } }] }) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`MAX_HTTP_${response.status}`); }
    const data = await providerJson(response, 32000) as any;
    if (!data.message?.body?.mid && !data.body?.mid) throw new Error('MAX_DELIVERY_UNCONFIRMED');
  };
}
export class NotificationWorker {
  private owner = randomUUID();
  lastRun: string | null = null; lastError: string | null = null;
  constructor(private store: NotificationStore, private catalog: LiveCatalog, private assess?: AssessOpportunity, private send?: SendNotification) {}
  async tick(now = Date.now()) {
    const db = this.store.db;
    const locked = db.prepare('INSERT INTO worker_lock VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE worker_lock.expires_at<?').run(this.owner, now + 900000, now);
    if (!locked.changes) return;
    try {
      const started = Date.now(); this.lastError = null;
      let remaining = 12;
      const subscriptions = db.prepare('SELECT * FROM subscriptions s ORDER BY COALESCE((SELECT MAX(next_at) FROM assessments a WHERE a.user_id=s.user_id),0),created_at').all() as Subscription[];
      if (this.assess && this.catalog.status().checkedAt && now - Date.parse(this.catalog.status().checkedAt!) < 3600000) {
        for (const sub of subscriptions) {
          let perUser = 2;
          const profile = JSON.parse(sub.profile), need = JSON.parse(sub.need);
          const candidates = this.catalog.getCatalog().filter((o) => notificationCandidate(profile, need, o, now));
          for (let item of candidates) {
            const key = [sub.user_id, item.id, item.version, sub.context_hash];
            const state = db.prepare('SELECT done,next_at FROM assessments WHERE user_id=? AND program_id=? AND version=? AND context_hash=?').get(...key) as any;
            if (remaining <= 0 || perUser <= 0 || Date.now() - started > 420000) break;
            if (state?.done || state?.next_at > now) continue;
            remaining--; perUser--;
            db.prepare('INSERT OR REPLACE INTO assessments VALUES(?,?,?,?,?,0)').run(...key, now + 3600000);
            try {
              item = await this.catalog.enrich(item.id) ?? item;
              if (!item.imported?.detail?.complete || !item.imported.detail.accepting || !notificationCandidate(profile, need, item, Date.now())) continue;
              const result = await this.assess(profile, need, item);
              if (this.store.get(sub.user_id)?.context_hash !== sub.context_hash) continue;
              db.exec('BEGIN IMMEDIATE');
              try {
                if (result.relevant) db.prepare(`INSERT INTO notifications(id,user_id,program_id,version,context_hash,title,reason,source,created_at,bot_state,next_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(user_id,program_id,version) DO UPDATE SET context_hash=excluded.context_hash,reason=excluded.reason`)
                  .run(randomUUID(), sub.user_id, item.id, item.version, sub.context_hash, item.title, result.reason, item.source.url!, now, this.store.get(sub.user_id)?.bot ? 'pending' : 'off', now);
                db.prepare('UPDATE assessments SET done=1 WHERE user_id=? AND program_id=? AND version=? AND context_hash=?').run(...key);
                db.exec('COMMIT');
              } catch (error) { db.exec('ROLLBACK'); throw error; }
            } catch { this.lastError = 'analysis_unavailable'; }
          }
        }
      }
      if (this.send && this.catalog.status().checkedAt && now - Date.parse(this.catalog.status().checkedAt!) < 3600000) {
        const pending = db.prepare("SELECT * FROM notifications WHERE bot_state='pending' AND next_at<=? ORDER BY created_at LIMIT 10").all(now) as any[];
        const deliveredUsers = new Set<string>();
        for (const notification of pending) {
          if (Date.now() - started > 420000) break;
          if (deliveredUsers.has(notification.user_id)) continue;
          const sub = this.store.get(notification.user_id), item = this.catalog.getCatalog().find((o) => o.id === notification.program_id);
          if (!sub?.bot || sub.context_hash !== notification.context_hash || item?.version !== notification.version || item?.status !== 'active') {
            db.prepare("UPDATE notifications SET bot_state='cancelled' WHERE id=?").run(notification.id); continue;
          }
          try {
            const fresh = await this.catalog.enrich(item.id);
            if (!fresh?.imported?.detail?.accepting || Date.parse(fresh.imported.endsAt) <= Date.now()) {
              db.prepare("UPDATE notifications SET bot_state='cancelled' WHERE id=?").run(notification.id); continue;
            }
            // Recheck consent after the source request, before the external side effect.
            const consent = this.store.get(sub.user_id);
            if (!consent?.bot || consent.context_hash !== notification.context_hash) continue;
            await this.send(sub.user_id, `Нашли меру поддержки для вашего бизнеса\n\n${notification.title}\n\n${notification.reason}\n\nAI отметил связь с вашим бизнесом. Полные условия и решение — у оператора программы.\nИсточник: ${notification.source}`, notification.program_id);
            db.prepare("UPDATE notifications SET bot_state='sent' WHERE id=?").run(notification.id); deliveredUsers.add(sub.user_id);
          } catch (error) {
            const permanent = /MAX_HTTP_(400|401|403|404)/.test(String(error));
            db.prepare('UPDATE notifications SET bot_state=?,attempts=attempts+1,next_at=? WHERE id=?').run(permanent || notification.attempts >= 7 ? 'failed' : 'pending', now + Math.min(86400000, 60000 * 2 ** notification.attempts), notification.id);
            this.lastError = 'delivery_unavailable';
          }
        }
      }
      this.lastRun = new Date(now).toISOString();
    } finally { db.prepare('DELETE FROM worker_lock WHERE id=1 AND owner=?').run(this.owner); }
  }
}
