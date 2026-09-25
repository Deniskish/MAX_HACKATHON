// HTTP entry point. Configuration is loaded before provider selection; imports have no network side effects.
import { config } from 'dotenv';
import path from 'node:path';
import { createApp } from './app';
import { SourceStore, startSourceMonitor } from './ai/sources';
config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
config({ quiet: true });
config({ path: path.resolve(__dirname, __dirname.endsWith('dist') ? '../../../.env.dadata' : '../../.env.dadata'), quiet: true });
const port = Number(process.env.PORT || 3002);
const sources = new SourceStore();
createApp({ sources }).listen(port, '0.0.0.0', () => {
  console.log(`Opora API: http://localhost:${port}/api/health`);
  if (process.env.AI_SOURCE_SYNC !== 'off') startSourceMonitor(sources);
});
