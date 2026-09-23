// HTTP entry point. Configuration is loaded before provider selection; imports have no network side effects.
import { config } from 'dotenv';
import path from 'node:path';
import { createApp } from './app';
config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });
config({ quiet: true });
const port = Number(process.env.PORT || 3002);
createApp().listen(port, '0.0.0.0', () => console.log(`Opora API: http://localhost:${port}/api/health`));
