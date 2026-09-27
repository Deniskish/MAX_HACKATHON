import { InfoDisclosureRow } from './InfoDisclosureRow';
import { InfoDisclosure } from './InfoDisclosure';
import {
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import type { Application, Profile } from "./domain";
import type { FundingOpportunity } from "../../api-server/funding-catalog/types";
import type { AIDocument } from "./ai-client";
import { applicationReadiness } from "./application-readiness";
import { DocumentChecklist, DraftComposer } from "./AgentExperience";
import { ActionButton, BusinessInput, BusinessTextarea } from "./MaxControls";
import { Icon } from "./Icon";

const stages = ["Проект", "Документы", "Проверка", "Подача"];
export function ApplicationWorkspace({
  app,
  opportunity,
  profile,
  documents,
  setDocuments,
  onUpdate,
  onAsk,
  onDownload,
  submission,
}: {
  app: Application;
  opportunity: FundingOpportunity;
  profile: Profile;
  documents: Record<string, AIDocument>;
  setDocuments: Dispatch<SetStateAction<Record<string, AIDocument>>>;
  onUpdate: (patch: Partial<Application>) => void;
  onAsk: (task: "review" | "draft", text: string) => void;
  onDownload: (text: string, name: string) => void;
  submission: ReactNode;
}) {
  const [stage, setStage] = useState(() => {
    try {
      const value = Number(
        sessionStorage.getItem(`opora.application-stage.${app.id}`),
      );
      return value >= 0 && value < 4 ? value : 0;
    } catch {
      return 0;
    }
  });
  const state = applicationReadiness(app, opportunity);
  const complete = [
    state.project && state.budgetComplete,
    state.documents,
    state.ready,
    false,
  ];
  function move(next: number) {
    setStage(next);
    try {
      sessionStorage.setItem(`opora.application-stage.${app.id}`, String(next));
    } catch {
      /* Keep current stage in memory. */
    }
    requestAnimationFrame(() =>
      document.querySelector("dialog[open] .modal")?.scrollTo({ top: 0 }),
    );
  }
  return (
    <section className="application-workspace">
      <div
        className="application-stages"
        role="tablist"
        aria-label="Подготовка заявки"
      >
        {stages.map((label, index) => (
          <button
            key={label}
            role="tab"
            id={`application-stage-${index}`}
            aria-selected={stage === index}
            aria-controls={`application-panel-${index}`}
            tabIndex={stage === index ? 0 : -1}
            type="button"
            onClick={() => move(index)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % 4
                  : event.key === "ArrowLeft"
                    ? (index + 3) % 4
                    : null;
              if (next !== null) {
                event.preventDefault();
                move(next);
                document.getElementById(`application-stage-${next}`)?.focus();
              }
            }}
          >
            <span aria-hidden="true">
              {complete[index] ? <Icon name="check" size={16} /> : index + 1}
            </span>
            {label}
          </button>
        ))}
      </div>
      <section
        id="application-panel-0"
        role="tabpanel"
        aria-labelledby="application-stage-0"
        hidden={stage !== 0}
      >
        <label className="field">
          Описание проекта
          <BusinessTextarea
            id="application-project"
            rows={4}
            maxLength={10000}
            placeholder="Что планируете сделать и какого результата ждёте?"
            value={app.project}
            onChange={(e) => onUpdate({ project: e.target.value })}
          />
        </label>
        <label className="field">
          Бюджет проекта, ₽
          {!state.budgetRequired && (
            <span className="muted">Необязательно</span>
          )}
          <BusinessInput
            id="application-budget"
            type="number"
            min="1"
            max={1e15}
            step="1"
            value={app.budget}
            onChange={(e) => onUpdate({ budget: e.target.value })}
          />
        </label>
        <ActionButton className="primary" onClick={() => move(1)}>
          К документам <Icon name="arrow" />
        </ActionButton>
      </section>
      <section
        id="application-panel-1"
        role="tabpanel"
        aria-labelledby="application-stage-1"
        hidden={stage !== 1}
      >
        <h3>Документы</h3>
        {!state.total && (
          <p>
            Перечень нужно уточнить у оператора.{" "}
            <a href={opportunity.source.url!} target="_blank" rel="noreferrer">
              Открыть условия ↗
            </a>
          </p>
        )}
        <DocumentChecklist
          program={opportunity}
          app={app}
          profile={profile}
          documents={documents}
          setDocuments={setDocuments}
          onUpdate={onUpdate}
        />
        <InfoDisclosure className="document-composer" summary={<InfoDisclosureRow as="summary" label="Подготовить текст документа" icon="file" />}>
          <DraftComposer
            program={opportunity}
            profile={profile}
            app={app}
            documents={Object.values(documents)}
            onUpdate={onUpdate}
            onAsk={(text) => onAsk("draft", text)}
            onDownload={(text) => onDownload(text, "document")}
          />
        </InfoDisclosure>
        <ActionButton className="primary" onClick={() => move(2)}>
          Проверить комплект <Icon name="arrow" />
        </ActionButton>
      </section>
      <section
        id="application-panel-2"
        role="tabpanel"
        aria-labelledby="application-stage-2"
        hidden={stage !== 2}
      >
        <h3>Проверьте перед подачей</h3>
        <ul className="readiness-list">
          <li>
            {state.project ? "✓ Проект описан" : "Добавьте описание проекта"}
          </li>
          <li>
            {state.budgetValid
              ? "✓ Бюджет указан"
              : state.budgetComplete
                ? "Бюджет необязателен для этой меры"
                : "Укажите бюджет проекта"}
          </li>
          <li>
            {!state.total
              ? "Уточните перечень документов у оператора"
              : `${state.prepared} из ${state.total} документов отмечено`}
          </li>
        </ul>
        <ActionButton
          className="secondary"
          onClick={() =>
            onAsk(
              "review",
              "Проверь комплект по условиям программы. Что нужно исправить перед подачей?",
            )
          }
        >
          Проверить с AI
        </ActionButton>
        <label className="checklist-title application-review">
          <input
            type="checkbox"
            checked={!!app.reviewConfirmed}
            onChange={(e) => onUpdate({ reviewConfirmed: e.target.checked })}
          />
          Я сверил комплект с условиями оператора
        </label>
        <ActionButton
          className="primary"
          disabled={!state.ready}
          onClick={() => move(3)}
        >
          К подаче <Icon name="arrow" />
        </ActionButton>
      </section>
      <section
        id="application-panel-3"
        role="tabpanel"
        aria-labelledby="application-stage-3"
        hidden={stage !== 3}
      >
        {submission}
        {!state.ready && (
          <ActionButton className="primary" onClick={() => move(2)}>
            Завершить проверку
          </ActionButton>
        )}
      </section>
    </section>
  );
}
