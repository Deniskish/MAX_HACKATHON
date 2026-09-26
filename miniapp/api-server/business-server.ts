// HTTP entry point. Configuration is loaded before provider selection; imports have no network side effects.
import { config } from 'dotenv';
import path from 'node:path';
import { createApp } from './app';
import { SourceStore, startSourceMonitor } from './ai/sources';
import { LiveCatalog } from './funding-catalog/live';
import { NotificationStore, NotificationWorker, maxSender } from './funding-catalog/notifications';
import { createGigaChatClient } from './gigachat';
config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
config({ quiet: true });
// The bot may keep its token in chatbot/.env, outside the API's own dotenv files.
const botSettings: NodeJS.ProcessEnv = {};
config({ path: path.resolve(process.cwd(), '../../chatbot/.env'), processEnv: botSettings, quiet: true });
for (const key of ['BOT_TOKEN', 'MINIAPP_URL', 'MAX_BOT_USERNAME']) {
  if (!process.env[key]?.trim() && botSettings[key]?.trim()) process.env[key] = botSettings[key]!.trim();
}
config({ path: path.resolve(__dirname, __dirname.endsWith('dist') ? '../../../.env.dadata' : '../../.env.dadata'), quiet: true });
const port = Number(process.env.PORT || 3002);
const sources = new SourceStore();
const dataDirectory = process.env.OPORA_FUNDING_DIR || path.resolve(process.cwd(), 'source-data/funding');
const catalog = new LiveCatalog(dataDirectory);
const notifications = new NotificationStore(path.join(dataDirectory, 'notifications.sqlite'));
let giga: ReturnType<typeof createGigaChatClient> | null = null;
try { if (process.env.GIGACHAT_AUTH_KEY) giga = createGigaChatClient({ authKey: process.env.GIGACHAT_AUTH_KEY,
  scope: process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS', model: process.env.GIGACHAT_MODEL || 'GigaChat-2-Pro' }); } catch { console.error('AI configuration is invalid'); }
const worker = new NotificationWorker(notifications, catalog, giga?.assessOpportunity,
  process.env.BOT_TOKEN ? maxSender(process.env.BOT_TOKEN, process.env.MINIAPP_URL || 'https://business-opora.ru', fetch, process.env.MAX_BOT_USERNAME) : undefined);
createApp({ sources, catalog, notifications, giga, notificationStatus: () => ({ lastRun: worker.lastRun, lastError: worker.lastError }) }).listen(port, '0.0.0.0', () => {
  console.log(`Opora API: http://localhost:${port}/api/health`);
  if (process.env.AI_SOURCE_SYNC !== 'off') startSourceMonitor(sources);
  if (process.env.FUNDING_SYNC !== 'off') {
    const sync = () => void catalog.sync().catch(() => console.error('Funding catalogue sync failed'));
    const notify = () => void worker.tick().catch(() => console.error('Funding notification cycle failed'));
    setTimeout(sync, 3000).unref(); setInterval(sync, 15 * 60000).unref();
    setTimeout(notify, 60000).unref(); setInterval(notify, 60000).unref();
  }
});
