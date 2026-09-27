import { InfoDisclosureRow } from './InfoDisclosureRow';
// Файлы читаются на устройстве; отправка текста в AI запускается отдельной кнопкой.
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { ActionButton, BusinessTextarea } from './MaxControls';
import { Icon } from './Icon';
import { AIPanel } from './AIExperience';

import { readDocument } from './document-reader';
import { requestAI, type AIDocument } from './ai-client';
import { toFundingProfile } from '../../api-server/funding-catalog/input';
import { type Profile, type Program, type Application, type DraftKind,
  documentGuide, inspectDocumentText, generateDraft, draftKinds } from './domain';
export function DocumentChecklist({
  program,
  app,
  profile,
  onUpdate,
  documents,
  setDocuments,
}: {
  program: Program;
  app: Application;
  profile: Profile | null;
  onUpdate: (patch: Partial<Application>) => void;
  documents: Record<string, AIDocument>;
  setDocuments: Dispatch<SetStateAction<Record<string, AIDocument>>>;
}) {
  const [reviews, setReviews] = useState<Record<string, ReturnType<typeof inspectDocumentText>>>(
    {},
  );
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reading, setReading] = useState('');
  const reader = useRef<AbortController | null>(null);
  useEffect(() => () => reader.current?.abort(), []);
  async function fileSelected(name: string, file: File) {
    reader.current?.abort(); const controller = new AbortController(); reader.current = controller; setReading(name);
    onUpdate({ documentFiles: { ...app.documentFiles, [name]: file.name } });
    setErrors((old) => ({ ...old, [name]: '' }));
    setReviews((old) => {
      const copy = { ...old };
      delete copy[name];
      return copy;
    });
    setDocuments((old) => { const next = { ...old }; delete next[name]; return next; });
    setTexts((old) => ({ ...old, [name]: '' }));
    try {
      const document = await readDocument(file, (text) => { if (!controller.signal.aborted) setErrors((old) => ({ ...old, [name]: text })); }, controller.signal);
      if (controller.signal.aborted || reader.current !== controller) return;
      const text = document.pages.map((p) => `[Страница ${p.page}]\n${p.text}`).join('\n\n');
      setDocuments((old) => ({ ...old, [name]: document })); setTexts((old) => ({ ...old, [name]: text }));
      setReviews((old) => ({ ...old, [name]: inspectDocumentText(name, text) }));
      setErrors((old) => ({ ...old, [name]: `Прочитано страниц: ${document.pages.length}. Проверьте текст перед AI-анализом.` }));
    } catch { if (!controller.signal.aborted) setErrors((old) => ({ ...old, [name]: 'Выберите другой файл или вставьте текст документа.' })); }
    finally { if (reader.current === controller) { reader.current = null; setReading(''); } }
  }
  return (
    <div className="personal-checklist">
      {program.documents.map((name) => {
        const guide = documentGuide(name);
        return (
          <section className="widget checklist-item" key={name}>
            <label className="checklist-title">
              <input
                type="checkbox"
                checked={!!app.documents[name]}
                onChange={(e) =>
                  onUpdate({
                    documents: {
                      ...app.documents,
                      [name]: e.target.checked ? 'Готовность отмечена пользователем' : '',
                    },
                  })
                }
              />
              <span>
                <b>{name}</b>
                <small>
                  {app.documents[name] ? 'Готовность отмечена вами' : 'Нужно подготовить'}
                  {app.documentFiles?.[name] ? ` · ${app.documentFiles[name]}` : ''}
                </small>
              </span>
            </label>
            <details className="info-disclosure">
              <InfoDisclosureRow as="summary" label="Подготовить документ" icon="file" />
              <dl>
                <dt>Зачем</dt>
                <dd>{guide.why}</dd>
                <dt>Где получить</dt>
                <dd>{guide.where}</dd>
                <dt>Что должно быть внутри</dt>
                <dd>{guide.contents}</dd>
              </dl>
              <label className="attach">
                Выбрать документ
                <input
                  type="file"
                  accept=".txt,.pdf,.docx,.png,.jpg,.jpeg,.webp"
                  disabled={!!reading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void fileSelected(name, f);
                  }}
                />
              </label>
              <p className="widget-footnote">PDF, DOCX, TXT или скан · до 10 МБ</p>
              {reading === name && <ActionButton className="secondary" onClick={() => { reader.current?.abort(); reader.current = null; setReading(''); setErrors((old) => ({ ...old, [name]: 'Чтение отменено.' })); }}>Отменить чтение</ActionButton>}
              <label className="field">
                Проверка текста документа
              <BusinessTextarea
                  aria-label={`Проверка текста документа: ${name}`}
                  rows={3}
                  maxLength={60000}
                  value={texts[name] || ''}
                  onChange={(e) => {
                    setTexts((old) => ({ ...old, [name]: e.target.value }));
                    const content = e.target.value;
                    setDocuments((old) => ({ ...old, [name]: { id: old[name]?.id ?? crypto.randomUUID(), name,
                      pages: [{ page: 1, text: content }] } }));
                    setReviews((old) => {
                      const next = { ...old };
                      delete next[name];
                      return next;
                    });
                  }}
                  placeholder="Вставьте текст документа; он останется в этой вкладке"
                />
              </label>
              <ActionButton
                className="secondary"
                disabled={!texts[name]?.trim()}
                onClick={() =>
                  setReviews((old) => ({ ...old, [name]: inspectDocumentText(name, texts[name]) }))
                }
              >
                Проверить текст документа
              </ActionButton>
              {errors[name] && (
                <p className="widget-footnote" role="status">
                  {errors[name]}
                </p>
              )}
              {reviews[name] && (
                <div className="document-review" role="status">
                  <b>{reviews[name].status}</b>
                  {reviews[name].tooShort && (
                    <p>Текста слишком мало для содержательной проверки.</p>
                  )}
                  {!!reviews[name].missing.length && (
                    <p>Не найдены упоминания: {reviews[name].missing.join(', ')}.</p>
                  )}
                  <small>{reviews[name].notice}</small>
                </div>
              )}
            </details>
          </section>
        );
      })}
      <details className="ai-entry"><summary>AI-проверка заявки</summary>
        <AIPanel title="Проверить перед подачей" task="review" context={{ profile: profile ? toFundingProfile(profile) : {},
          identifiers: profile ? { name: profile.name, inn: profile.inn } : undefined, programId: program.id, project: app.project,
          draft: app.generatedDraft?.slice(0, 18000), budget: app.budget.trim() ? Number(app.budget) : null,
          preparedDocuments: program.documents.filter((d) => app.documents[d]), documents: Object.values(documents).filter((d) => d.pages.some((p) => p.text.trim())) }}
          button="Проверить заявку" initialQuestion="Проверь заявку: чего не хватает и что нужно исправить перед подачей?" />
      </details>
    </div>
  );
}

// Результат модели и локальный шаблон помечаем по-разному; оба можно редактировать.
export function DraftComposer({
  program,
  profile,
  app,
  onUpdate,
  onDownload,
  documents,
}: {
  program: Program;
  profile: Profile;
  app: Application;
  onUpdate: (patch: Partial<Application>) => void;
  onDownload: (text: string) => void;
  documents: AIDocument[];
}) {
  const [kind, setKind] = useState<DraftKind>('project');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const pending = useRef<AbortController | null>(null);
  const documentFingerprint = JSON.stringify(documents);
  useEffect(() => { pending.current?.abort(); pending.current = null; setBusy(false); setNotice(''); return () => pending.current?.abort(); }, [kind, app.id, program.id, app.project, app.budget, documentFingerprint, JSON.stringify(profile)]);
  async function create() {
    const controller = new AbortController(); pending.current = controller;
    setBusy(true);
    setNotice('');
    let text = generateDraft(kind, program, profile, app),
      origin = 'Локальный автоматический шаблон';
    try {
      const data = await requestAI({ task: 'draft', question: 'Подготовь черновик по выбранной программе и описанию моего проекта.',
        context: { profile: toFundingProfile(profile), identifiers: { name: profile.name, inn: profile.inn },
          programId: program.id, draftKind: draftKinds[kind], project: app.project, documents,
          preparedDocuments: program.documents.filter((d) => app.documents[d]), budget: app.budget.trim() ? Number(app.budget) : null } },
        controller.signal);
      if (data.mode !== 'llm' || !data.draft?.trim())
        throw new Error(data.providerFailure ?? 'INVALID_RESPONSE');
      text =
        'АВТОМАТИЧЕСКИЙ ЧЕРНОВИК GIGACHAT — ПРОВЕРЬТЕ И ОТРЕДАКТИРУЙТЕ\n\n' +
        data.draft +
        '\n\nПроверьте факты, заполните пропуски и сверяйте текст с формой оператора. Заявка не отправлена.';
      origin = 'GigaChat · по описанию проекта';
    } catch {
      if (controller.signal.aborted || pending.current !== controller) return;
      setNotice('Подготовлен шаблон с вашими данными.');
    }
    if (controller.signal.aborted) return;
    onUpdate({ generatedDraft: text, draftOrigin: origin });
    pending.current = null;
    setBusy(false);
  }
  return (
    <section className="widget draft-composer">
      <div className="widget-heading">
        <h2>Подготовим документ</h2>
        <Icon name="spark" />
      </div>
      {!app.generatedDraft && (
        <>
          <label className="field">
            Тип документа
            <select value={kind} onChange={(e) => setKind(e.target.value as DraftKind)}>
              {Object.entries(draftKinds).map(([id, label]) => (
                <option value={id} key={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <ActionButton className="primary" disabled={busy} onClick={() => void create()}>
            {busy ? 'Готовим черновик…' : 'Сформировать черновик'}
            <Icon name="spark" size={17} />
          </ActionButton>
          {busy && <ActionButton className="secondary" onClick={() => { pending.current?.abort(); pending.current = null; setBusy(false); }}>Отменить генерацию</ActionButton>}
        </>
      )}
      {notice && (
        <p role="status" className="widget-footnote">
          {notice}
        </p>
      )}
      {app.generatedDraft !== undefined && (
        <>
          <span className="tag">{app.draftOrigin || 'Черновик пользователя'}</span>
          <label className="field">
            Редактор документа
            <BusinessTextarea
              aria-label="Редактор документа"
              rows={14}
              maxLength={30000}
              value={app.generatedDraft}
              onChange={(e) => onUpdate({ generatedDraft: e.target.value })}
            />
          </label>
          <ActionButton
            className="secondary"
            disabled={!app.generatedDraft.trim()}
            onClick={() => onDownload(app.generatedDraft!)}
          >
            <Icon name="download" size={18} />
            Скачать этот документ
          </ActionButton>
          <details className="ai-entry"><summary>Доработать текст с AI</summary><AIPanel title="Редактор с AI" task="draft"
            context={{ profile: toFundingProfile(profile), identifiers: { name: profile.name, inn: profile.inn }, programId: program.id,
              project: app.project, documents, draft: app.generatedDraft.slice(0, 18000), draftKind: draftKinds[kind], budget: app.budget.trim() ? Number(app.budget) : null }}
            initialQuestion="Улучши структуру и обоснование документа по условиям программы. Сохрани факты и цифры; недостающие сведения отметь [заполните]."
            onDraft={(text) => onUpdate({ generatedDraft: text, draftOrigin: 'GigaChat · правки применены пользователем' })} />
            {app.generatedDraft.length > 18000 && <p className="widget-footnote">Для AI-редактирования доступны первые 18 000 символов. Выберите нужный фрагмент перед применением результата.</p>}
          </details>
        </>
      )}
    </section>
  );
}
