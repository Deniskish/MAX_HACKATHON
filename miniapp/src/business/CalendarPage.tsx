import { ActionButton } from "./MaxControls";
import { Icon } from "./Icon";
import type { Profile, Application } from "./domain";
import type {
  FundingOpportunity,
  FundingMatch,
} from "../../api-server/funding-catalog/types";
import { GlassArt } from "./GlassArt";
import { AdaptiveInsight } from "./AdaptiveInsight";
import type { BusinessAnalysis } from "./useBusinessAnalysis";
import type { WorkspaceInsight } from "../../api-server/ai/types";
import { fundingKindLabels } from "../../api-server/funding-catalog/presentation";

export function CalendarPage({
  profile,
  apps,
  calendarPrograms,
  allCalendar,
  setAllCalendar,
  tracked,
  businessAnalysis,
  followInsight,
  matchesById,
  setSelected,
  exportCalendar,
  onSupport,
}: {
  profile: Profile;
  apps: Application[];
  calendarPrograms: FundingOpportunity[];
  allCalendar: boolean;
  setAllCalendar: (value: boolean) => void;
  tracked: FundingOpportunity[];
  businessAnalysis: BusinessAnalysis;
  followInsight: (action: WorkspaceInsight["action"]) => void;
  matchesById: Map<string, FundingMatch>;
  setSelected: (program: FundingOpportunity) => void;
  exportCalendar: () => void;
  onSupport: () => void;
}) {
  return (
    <>
      {
        <>
          <AdaptiveInsight
            analysis={businessAnalysis}
            section="calendar"
            onAction={followInsight}
          />
          <p className="calendar-context">{profile.name}</p>
          <div className="catalog-scopes">
            <button
              aria-pressed={!allCalendar}
              onClick={() => setAllCalendar(false)}
            >
              Мои сроки
            </button>
            <button
              aria-pressed={allCalendar}
              onClick={() => setAllCalendar(true)}
            >
              Весь каталог
            </button>
          </div>
          {!calendarPrograms.length && (
            <section className="empty-state">
              <GlassArt shape="ring" size={104} />
              <h2>Опубликованных сроков нет</h2>
              <p>
                {tracked.length
                  ? "У выбранных программ нет точных дат в каталоге. Сверяйте сроки на сайте оператора."
                  : "Сохраните программу или начните подготовку заявки — её опубликованный срок появится здесь."}
              </p>
              <ActionButton className="secondary" onClick={() => onSupport()}>
                Найти поддержку
              </ActionButton>
            </section>
          )}
          <div className="section-title">
            <ActionButton
              className="secondary"
              disabled={!calendarPrograms.length}
              onClick={exportCalendar}
            >
              <Icon name="download" size={17} />
              Скачать сроки
            </ActionButton>
          </div>
          <div className="timeline">
            {calendarPrograms
              .sort((a, b) =>
                (a.deadline ?? "").localeCompare(b.deadline ?? ""),
              )
              .map((p) => (
                <button
                  className="timeline-row"
                  key={p.id}
                  onClick={() => setSelected(p)}
                >
                  <span className="date-tile">
                    <b>{new Date(p.deadline!).getDate()}</b>
                    <span>
                      {new Date(p.deadline!).toLocaleDateString("ru-RU", {
                        month: "short",
                      })}
                    </span>
                  </span>
                  <span>
                    <small>
                      {fundingKindLabels[p.kind]} ·{" "}
                      {new Date(p.deadline!).getFullYear()} ·{" "}
                      {matchesById.get(p.id)?.status === "expired"
                        ? "Приём завершён"
                        : "Окончание приёма"}
                    </small>
                    <h3>{p.title}</h3>
                    {apps.some((a) => a.programId === p.id) && (
                      <span className="green-text">Есть ваша заявка</span>
                    )}
                  </span>
                  <Icon name="arrow" />
                </button>
              ))}
          </div>
          <div className="data-note">
            Экспорт .ics добавляет сроки в ваш календарь. Уведомления о новых
            мерах — в настройках.
          </div>
        </>
      }
    </>
  );
}
