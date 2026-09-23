// Редактор документов сохраняет данные локально; модель получает только обезличенные параметры.
import { useState } from 'react';
import { ActionButton, BusinessTextarea } from './MaxControls';
import { Icon } from './Icon';
import { type Profile, type Program, type Application, type DraftKind,
  documentGuide, inspectDocumentText, generateDraft, draftKinds } from './domain';
export function DocumentChecklist({
  program,
  app,
  onUpdate,
}: {
  program: Program;
  app: Application;
  onUpdate: (patch: Partial<Application>) => void;
}) {
  const [reviews, setReviews] = useState<Record<string, ReturnType<typeof inspectDocumentText>>>(
    {},
  );
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function fileSelected(name: string, file: File) {
    if (file.size > 2 * 1024 * 1024) {
      setErrors((old) => ({ ...old, [name]: 'Для локальной проверки выберите файл до 2 МБ.' }));
      return;
    }
    onUpdate({ documentFiles: { ...app.documentFiles, [name]: file.name } });
    setErrors((old) => ({ ...old, [name]: '' }));
    setReviews((old) => {
      const copy = { ...old };
      delete copy[name];
      return copy;
    });
    if (file.name.toLowerCase().endsWith('.txt'))
      try {
        const text = await file.text();
        setReviews((old) => ({ ...old, [name]: inspectDocumentText(name, text) }));
      } catch {
        setErrors((old) => ({
          ...old,
          [name]: 'Не удалось прочитать текст. Скопируйте нужные разделы в поле ниже.',
        }));
      }
    else
      setErrors((old) => ({
        ...old,
        [name]:
          'Название сохранено. PDF, DOCX и изображения здесь не распознаются; вставьте текст ниже для локальной проверки.',
      }));
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
            <details>
              <summary>Зачем нужен и как подготовить</summary>
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
                  accept=".txt,text/plain"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void fileSelected(name, f);
                  }}
                />
              </label>
              <p className="widget-footnote">
                Файл не отправляется на сервер. TXT проверяется локально; содержимое не сохраняется.
                Готовность отметьте отдельно после проверки.
              </p>
              <label className="field">
                Проверка текста документа
              <BusinessTextarea
                  aria-label={`Проверка текста документа: ${name}`}
                  rows={3}
                  maxLength={100000}
                  value={texts[name] || ''}
                  onChange={(e) => {
                    setTexts((old) => ({ ...old, [name]: e.target.value }));
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
}: {
  program: Program;
  profile: Profile;
  app: Application;
  onUpdate: (patch: Partial<Application>) => void;
  onDownload: (text: string) => void;
}) {
  const [kind, setKind] = useState<DraftKind>('project');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  async function create() {
    setBusy(true);
    setNotice('');
    let text = generateDraft(kind, program, profile, app),
      origin = 'Локальный автоматический шаблон';
    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'draft',
          draftKind: kind,
          question: 'Подготовь черновик по выбранной программе',
          context: {
            profile,
            programId: program.id,
            application: {
              preparedDocuments: program.documents.filter((d) => app.documents[d]),
              budget: app.budget.trim() ? Number(app.budget) : null,
            },
          },
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (data.mode !== 'llm' || typeof data.answer !== 'string' || !data.answer.trim())
        throw new Error('invalid');
      text =
        'АВТОМАТИЧЕСКИЙ ЧЕРНОВИК GIGACHAT — ПРОВЕРЬТЕ И ОТРЕДАКТИРУЙТЕ\n\n' +
        data.answer +
        '\n\nПроверьте факты, заполните пропуски и сверяйте текст с формой оператора. Заявка не отправлена.';
      origin = 'GigaChat · обезличенные параметры';
    } catch {
      setNotice('GigaChat недоступен. Подготовлен локальный шаблон с вашими данными.');
    }
    onUpdate({ generatedDraft: text, draftOrigin: origin });
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
        </>
      )}
      <p className="widget-footnote">
        Черновик сохраняется в этом браузере. Модель получает только разрешённые параметры и официальные
        условия; ваш исходный текст проекта ей не отправляется.
      </p>
    </section>
  );
}
