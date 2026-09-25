import { SourceStore } from './sources';
new SourceStore().sync().then((snapshot) => console.log(JSON.stringify({ pages: snapshot.pages.length, updates: snapshot.updates.length, errors: snapshot.errors, checkedAt: snapshot.checkedAt })))
  .catch(() => { console.error('Не удалось сохранить официальные источники.'); process.exitCode = 1; });
