import { useEffect, useState } from 'react';
import { ActionButton } from './business/MaxControls';
import { BrandWordmark } from './business/AppChrome';

type Workspace = typeof import('./business/BusinessApp')['default'];
let workspaceRequest: Promise<Workspace> | undefined;
function loadWorkspace() {
  return workspaceRequest ??= import('./business/BusinessApp')
    .then((module) => module.default)
    .catch((error: unknown) => { workspaceRequest = undefined; throw error; });
}

export default function App() {
  const [WorkspaceApp, setWorkspaceApp] = useState<Workspace | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void loadWorkspace().then((component) => {
      if (active) setWorkspaceApp(() => component);
    }).catch(() => {
      if (active) setLoadFailed(true);
    });
    return () => { active = false; };
  }, []);

  if (WorkspaceApp) return <WorkspaceApp />;

  return (
    <main className="startup-screen" aria-busy={!loadFailed}>
      <BrandWordmark className="startup-wordmark" />
      {loadFailed ? <div className="startup-error">
        <p role="alert">Не удалось загрузить приложение. Проверьте интернет и обновите страницу.</p>
        <ActionButton className="secondary" onClick={() => window.location.reload()}>
          Обновить страницу
        </ActionButton>
      </div> : <p className="startup-status" role="status">
        <span className="startup-indicator" aria-hidden="true" />
        Открываем Опору…
      </p>}
    </main>
  );
}
