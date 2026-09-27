// Read-only team diagnostics. No user messages, company records or credentials.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const directory = process.env.OPORA_FUNDING_DIR || path.resolve(__dirname, '../source-data/funding');
const read = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const budget = read(path.join(directory, 'catalog.json'));
const sources = [];
const folder = path.join(directory, 'official-web');
if (fs.existsSync(folder)) for (const file of fs.readdirSync(folder).filter(f => f.endsWith('.json') && f !== 'interests.json')) {
  const state = read(path.join(folder, file)); if (!state) continue;
  sources.push({ source: file.slice(0,-5), attemptedAt: state.attemptedAt, checkedAt: state.checkedAt, code: state.error,
    programmes: state.entries?.length ?? 0, discovered: state.queue?.length ?? 0,
    pending: Object.values(state.pages ?? {}).filter(p => p.outcome === 'pending').length,
    problems: Object.entries(state.pages ?? {}).filter(([,p])=>p.error).map(([url,p])=>({url,code:p.error})).slice(0,30) });
}
let deliveries = [];
if (fs.existsSync(path.join(directory,'notifications.sqlite'))) {
  const db = new DatabaseSync(path.join(directory,'notifications.sqlite'),{readOnly:true});
  try { deliveries = db.prepare('SELECT bot_state AS state, COUNT(*) AS count FROM notifications GROUP BY bot_state').all(); }
  finally { db.close(); }
}
const result = { at: new Date().toISOString(), budget: budget && { checkedAt: budget.checkedAt, attemptedAt: budget.attemptedAt,
  code: budget.errorCode ?? budget.error, imported: budget.entries?.length ?? 0 }, sources, deliveries,
  unsupportedRegions: Object.keys(read(path.join(folder,'interests.json'))?.unsupported ?? {}) };
console.log(JSON.stringify(result,null,2));
if (process.argv.includes('--strict') && (!budget?.checkedAt || budget.error || !sources.length || sources.some(s=>s.code || s.problems.length))) process.exitCode=1;
