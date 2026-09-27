import type { Dispatch, SetStateAction } from "react";
import type { FundingMatch } from "../../api-server/funding-catalog/types";
import { fundingKindLabels } from "../../api-server/funding-catalog/presentation";
import { applicationStatus } from "./workspace";
import { draftText, type Profile, type Application } from "./domain";
import type { AIDocument } from "./ai-client";
import { Icon } from "./Icon";
import { InfoDisclosureRow } from "./InfoDisclosureRow";
import { OfficialDetails } from "./OfficialExperience";
import { ApplicationWorkspace } from "./ApplicationWorkspace";
import { PreparationRequirements } from "./VisualWidgets";
import { ActionButton } from "./MaxControls";

export function ProgrammeDetails({
  match,
  profile,
  activeApp,
  detached,
  onUpdate,
  onDocuments,
  onAttach,
  onAsk,
  onDownload,
  onEdit,
  onPrepare,
}: {
  match: FundingMatch;
  profile: Profile | null;
  activeApp?: Application;
  detached: boolean;
  onUpdate: (patch: Partial<Application>) => void;
  onDocuments: Dispatch<SetStateAction<Record<string, AIDocument>>>;
  onAttach: () => void;
  onAsk: (task: "strategy" | "review" | "draft", text: string) => void;
  onDownload: (text: string, name: string) => void;
  onEdit: () => void;
  onPrepare: () => void;
}) {
  const selected = match.opportunity;
  return (
    <>
      {
        <>
          <div className={"detail-emblem " + selected.id}>
            <Icon
              name={selected.kind === "guarantee" ? "shield" : "file"}
              size={38}
            />
          </div>
          <span className="tag">{fundingKindLabels[selected.kind]}</span>
          <h2>{selected.title}</h2>
          <details
            key={selected.id}
            className="application-conditions info-disclosure"
          >
            <InfoDisclosureRow as="summary" label="Условия программы" />
            <p className="muted">{selected.description}</p>
            <OfficialDetails
              personalized={!!profile}
              match={match}
              onAsk={() => onAsk("strategy", "Объясни следующий шаг")}
            />
          </details>
          {activeApp && detached && (
            <section className="retained-application">
              <h3>Сохранённый черновик</h3>
              <p>
                Черновик относится к удалённому бизнесу. Тексты, документы и
                отметки сохранены. Проверьте реквизиты и актуальность документов
                перед использованием для другого бизнеса.
              </p>
              <p className="retained-application-text">{activeApp.project}</p>
              {activeApp.budget && <p>Бюджет: {activeApp.budget} ₽</p>}
              <ActionButton
                className="secondary"
                onClick={() =>
                  onDownload(
                    [
                      activeApp.project,
                      activeApp.budget && `Бюджет: ${activeApp.budget} ₽`,
                      activeApp.generatedDraft,
                      ...Object.entries(activeApp.documents).map(
                        ([name, text]) => `${name}\n${text}`,
                      ),
                    ]
                      .filter(Boolean)
                      .join("\n\n"),
                    `opora-${selected.id}-saved.txt`,
                  )
                }
              >
                Скачать сохранённые тексты
              </ActionButton>
              {profile && (
                <ActionButton className="secondary" onClick={onAttach}>
                  Использовать черновик для этого бизнеса
                </ActionButton>
              )}
            </section>
          )}
          {activeApp && profile && !detached ? (
            <ApplicationWorkspace
              key={activeApp.id}
              app={activeApp}
              profile={profile}
              opportunity={selected}
              documents={activeApp.documentTexts ?? {}}
              setDocuments={onDocuments}
              onUpdate={onUpdate}
              onAsk={onAsk}
              onDownload={(text, name) =>
                onDownload(text, `opora-${selected.id}-${name}.txt`)
              }
              submission={
                <section className="submission-actions">
                  <h3>Подача оператору</h3>
                  <p>
                    {applicationStatus(activeApp, selected) ===
                    "ready_for_review"
                      ? "Комплект подготовлен в «Опоре». Отправьте его на официальном сайте программы."
                      : "Сверьте условия и порядок подачи на сайте оператора."}
                  </p>
                  <a
                    className={
                      applicationStatus(activeApp, selected) ===
                      "ready_for_review"
                        ? "primary"
                        : "secondary"
                    }
                    href={selected.source.url ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Перейти к оператору ↗
                  </a>
                  <ActionButton
                    className="secondary"
                    onClick={() =>
                      onDownload(
                        draftText(activeApp, selected, profile, match),
                        `opora-${selected.id}-package.txt`,
                      )
                    }
                  >
                    Скачать тексты комплекта
                  </ActionButton>
                </section>
              }
            />
          ) : (
            <>
              <PreparationRequirements
                documents={selected.requiredDocuments}
                source={selected.source.url ?? ""}
              />
              <div className="modal-actions">
                {profile && (
                  <ActionButton className="secondary" onClick={onEdit}>
                    Уточнить профиль
                  </ActionButton>
                )}
                <ActionButton
                  className="primary"
                  disabled={
                    !!profile &&
                    ["expired", "upcoming", "not_eligible"].includes(
                      match.status,
                    )
                  }
                  onClick={onPrepare}
                >
                  {profile
                    ? "Начать подготовку"
                    : "Добавить бизнес и проверить"}
                  <Icon name="arrow" size={17} />
                </ActionButton>
              </div>
            </>
          )}
        </>
      }
    </>
  );
}
