import { ActionButton } from "./MaxControls";
import { Icon } from "./Icon";
import type { Profile, Application } from "./domain";
import type { FundingOpportunity } from "../../api-server/funding-catalog/types";
import { GlassArt } from "./GlassArt";
import { AdaptiveInsight } from "./AdaptiveInsight";
import type { BusinessAnalysis } from "./useBusinessAnalysis";
import type { WorkspaceInsight } from "../../api-server/ai/types";
import { applicationStatus, applicationLabels } from "./workspace";
import { displayDate as formatDate } from "./display";

export function ApplicationsPage({
  profile,
  apps,
  programs,
  detachedApplicationIds,
  businessAnalysis,
  followInsight,
  priorityRank,
  onAdd,
  onSupport,
  setSelected,
  setDeleteDraftId,
}: {
  profile: Profile | null;
  apps: Application[];
  programs: FundingOpportunity[];
  detachedApplicationIds: string[];
  businessAnalysis: BusinessAnalysis;
  followInsight: (action: WorkspaceInsight["action"]) => void;
  priorityRank: (id: string) => number;
  onAdd: () => void;
  onSupport: () => void;
  setSelected: (program: FundingOpportunity) => void;
  setDeleteDraftId: (id: string) => void;
}) {
  return (
    <>
      {!profile && (
        <section className="empty-state guest-applications">
          <GlassArt shape="tiles" size={120} />
          <h2>Заявки вашего бизнеса</h2>
          <p>Добавьте бизнес, чтобы подготовить заявку.</p>
          <ActionButton className="primary" onClick={() => onAdd()}>
            Добавить бизнес
          </ActionButton>
          <ActionButton className="secondary" onClick={() => onSupport()}>
            Посмотреть программы
          </ActionButton>
        </section>
      )}
      {profile && (
        <AdaptiveInsight
          analysis={businessAnalysis}
          section="applications"
          onAction={followInsight}
        />
      )}
      {(profile || apps.length > 0) &&
        (apps.length ? (
          <div className="application-list">
            {[...apps]
              .sort(
                (a, b) => priorityRank(a.programId) - priorityRank(b.programId),
              )
              .map((a) => {
                const p = programs.find((p) => p.id === a.programId);
                if (!p)
                  return (
                    <article className="widget" key={a.id}>
                      <p>{a.project || "Черновик заявки"}</p>
                      <p>Ожидаем загрузку программы. Черновик сохранён.</p>
                    </article>
                  );
                const count = p.requiredDocuments.filter(
                  (d) => a.documents[d],
                ).length;

                return (
                  <article className="application-row" key={a.id}>
                    <GlassArt
                      shape="tiles"
                      size={54}
                      className="application-art"
                    />
                    <div className="application-info">
                      <span className="tag">{`${detachedApplicationIds.includes(a.id) ? "Сохранённый черновик без привязки к бизнесу" : applicationLabels[applicationStatus(a, programs.find((o) => o.id === a.programId)!)]} · не отправлено`}</span>
                      <h3>{p.title}</h3>
                      <p>
                        {p.requiredDocuments.length
                          ? `${count} из ${p.requiredDocuments.length} документов отмечено`
                          : "Перечень документов нужно уточнить"}{" "}
                        · срок {formatDate(p.deadline)}
                      </p>
                      <div className="progress">
                        <i
                          style={{
                            width: `${(p.requiredDocuments.length ? count / p.requiredDocuments.length : 0) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                    <ActionButton
                      className="secondary"
                      onClick={() => setSelected(p)}
                    >
                      Продолжить <Icon name="arrow" size={17} />
                    </ActionButton>
                    <ActionButton
                      className="text-button"
                      onClick={() => setDeleteDraftId(a.id)}
                    >
                      Удалить черновик
                    </ActionButton>
                  </article>
                );
              })}
          </div>
        ) : (
          <div className="empty-state">
            <GlassArt shape="tiles" size={120} />
            <h2>Пока нет заявок</h2>
            <ActionButton className="primary" onClick={() => onSupport()}>
              Выбрать программу <Icon name="arrow" size={17} />
            </ActionButton>
          </div>
        ))}
    </>
  );
}
