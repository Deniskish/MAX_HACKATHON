import { InfoDisclosure } from './InfoDisclosure';
import type { Dispatch, SetStateAction, ReactNode } from "react";
import type {
  FundingKind,
  FundingNeed,
  FundingOpportunity,
} from "../../api-server/funding-catalog/types";
import { fundingKindLabels } from "../../api-server/funding-catalog/presentation";
import { ActionButton, BusinessInput } from "./MaxControls";
import { CatalogStatusFilter } from "./CatalogStatusFilter";
import { catalogRegions } from './catalog-filters';
import { programmeCount } from "./display";
import { Icon } from "./Icon";
type Setter<T> = Dispatch<SetStateAction<T>>;
type Scope = "personal" | "all" | "saved";
export function CataloguePage({
  profile,
  need,
  saved,
  catalogScope,
  setCatalogScope,
  onlySaved,
  setOnlySaved,
  query,
  setQuery,
  selectedKinds,
  setSelectedKinds,
  selectedRegion,
  setSelectedRegion,
  availability,
  setAvailability,
  catalogToolsOpen,
  setCatalogToolsOpen,
  officialFundingCatalog,
  visiblePrograms,
  catalogLimit,
  setCatalogLimit,
  programCard,
  onTask,
  onEdit,
}: {
  profile: boolean;
  need: FundingNeed;
  saved: string[];
  catalogScope: Scope;
  setCatalogScope: Setter<Scope>;
  onlySaved: boolean;
  setOnlySaved: Setter<boolean>;
  query: string;
  setQuery: Setter<string>;
  selectedKinds: FundingKind[];
  setSelectedKinds: Setter<FundingKind[]>;
  selectedRegion: string;
  setSelectedRegion: Setter<string>;
  availability: string;
  setAvailability: Setter<string>;
  catalogToolsOpen: boolean;
  setCatalogToolsOpen: Setter<boolean>;
  officialFundingCatalog: FundingOpportunity[];
  visiblePrograms: { p: FundingOpportunity }[];
  catalogLimit: number;
  setCatalogLimit: Setter<number>;
  programCard: (p: FundingOpportunity) => ReactNode;
  onTask: () => void;
  onEdit: () => void;
}) {
  const personal = profile && catalogScope === 'personal';
  const regionActive = !personal && !!selectedRegion;
  const filterCount = selectedKinds.length + Number(!!availability) + Number(regionActive);
  const resetFilters = () => { setSelectedKinds([]); setSelectedRegion(''); setAvailability(''); };
  return (
    <>
      {profile && (
        <div
          className="catalog-scopes catalog-scope-tabs"
          role="group"
          aria-label="Область подбора"
          data-scope={catalogScope}
        >
          <span className="catalog-scope-indicator" aria-hidden="true" />
          {(
            [
              ["personal", "Для вас"],
              ["all", "Все меры"],
              ["saved", `Сохранённые · ${saved.length}`],
            ] as const
          ).map(([scope, title]) => (
            <button
              key={scope}
              aria-pressed={catalogScope === scope}
              onClick={() => {
                setCatalogScope(scope);
                setOnlySaved(scope === "saved");
              }}
            >
              {title}
            </button>
          ))}
        </div>
      )}
      <div className="catalog-toolbar">
        {!profile && (
          <div className="segmented-control" aria-label="Показать программы">
            <button
              aria-pressed={!onlySaved}
              className={!onlySaved ? "selected" : ""}
              onClick={() => setOnlySaved(false)}
            >
              Все меры
            </button>
            <button
              aria-pressed={onlySaved}
              className={onlySaved ? "selected" : ""}
              onClick={() => setOnlySaved(true)}
            >
              Сохранённые <span>{saved.length}</span>
            </button>
          </div>
        )}
        <div className="search-box">
          <BusinessInput
            className="catalog-search-input"
            iconBefore={<Icon name="search" />}
            aria-label="Поиск мер поддержки"
            placeholder="Название или цель"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <button type="button" className="catalog-task" onClick={() => onTask()}>
        <span>
          <b>Моя задача</b>
          <span>
            {need.purpose || "Выбрать цель и сумму"}
            {need.amount ? ` · ${need.amount.toLocaleString("ru-RU")} ₽` : ""}
          </span>
        </span>
        <Icon name="chevron" size={18} />
      </button>
      <InfoDisclosure
        className="catalog-tools"
        open={catalogToolsOpen}
        onOpenChange={setCatalogToolsOpen}
        summary={<summary>
          <Icon name="settings" size={18} />
          <span>Фильтры</span>
          {(filterCount > 0) && (
            <span className="catalog-tools-count">
              {filterCount}
            </span>
          )}
          <Icon name="chevron" size={16} />
        </summary>}
      >
        <div className="catalog-tools-body">
          <CatalogStatusFilter
            value={availability}
            onChange={setAvailability}
            includeClosedByDefault={onlySaved}
          />
          {personal ? <p className="muted">Территория подбирается по региону вашего бизнеса.</p> : (
            <label className="field">Территория действия
              <select value={selectedRegion} onChange={event => setSelectedRegion(event.target.value)}>
                <option value="">Все территории</option>
                <option value="all">Федеральные / вся Россия</option>
                {catalogRegions(officialFundingCatalog).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
              </select>
            </label>
          )}
          <h3>Вид поддержки</h3>
          <div className="filter-chips" aria-label="Виды мер поддержки">
            <button type="button" aria-pressed={!selectedKinds.length}
              className={!selectedKinds.length ? 'selected' : ''} onClick={() => setSelectedKinds([])}>Все виды</button>
            {[...new Set(officialFundingCatalog.map(o => o.kind))].map(kind => (
              <button type="button" key={kind} aria-pressed={selectedKinds.includes(kind)}
                className={selectedKinds.includes(kind) ? 'selected' : ''}
                onClick={() => setSelectedKinds(previous => previous.includes(kind)
                  ? previous.filter(item => item !== kind) : [...previous, kind])}>
                {fundingKindLabels[kind]}
              </button>
            ))}
          </div>

          {(filterCount > 0) && (
            <button
              type="button"
              className="catalog-clear-filters"
              onClick={() => {
                resetFilters();
              }}
            >
              Сбросить фильтры
            </button>
          )}
          <ActionButton
            className="secondary"
            onClick={() => setCatalogToolsOpen(false)}
          >
            Показать программы · {visiblePrograms.length}
          </ActionButton>
        </div>
      </InfoDisclosure>
      <div className="catalog-results-header">
        <h2>
          {personal ? 'Для вашего бизнеса' : 'Все возможности'}
        </h2>
        <span>{programmeCount(visiblePrograms.length)}</span>
        {filterCount > 0 && (
          <button onClick={resetFilters}>
            Сбросить <Icon name="close" size={13} />
          </button>
        )}
      </div>
      <div className="program-grid catalog">
        {visiblePrograms.slice(0, catalogLimit).map(({ p }) => programCard(p))}
      </div>
      {visiblePrograms.length > catalogLimit && (
        <ActionButton
          className="secondary"
          onClick={() => setCatalogLimit((n) => n + 30)}
        >
          Показать ещё
        </ActionButton>
      )}
      {!visiblePrograms.length && (
        <div className="empty-state">
          <span className="empty-symbol">
            <Icon name={onlySaved ? "bookmark" : "search"} size={32} />
          </span>
          <h2>
            {onlySaved && !saved.length
              ? "Пока нет сохранённых программ"
              : "Здесь пока нет программ"}
          </h2>
          <p>
            {onlySaved && !saved.length
              ? "Нажмите на закладку в карточке, чтобы сохранить возможность."
              : profile && catalogScope === "personal"
                ? "По текущим параметрам и фильтрам подходящих программ не найдено. Уточните цель или посмотрите все меры."
                : "С выбранными фильтрами нет результатов. Попробуйте изменить категорию или запрос."}
          </p>
          {profile && catalogScope === "personal" && (
            <div className="catalog-empty-actions">
              <ActionButton className="secondary" onClick={() => onTask()}>
                Изменить цель и сумму
              </ActionButton>
              <ActionButton className="text-button" onClick={onEdit}>
                Изменить сведения о бизнесе
              </ActionButton>
            </div>
          )}
          <ActionButton
            className="secondary"
            onClick={() => {
              resetFilters();
              setQuery("");
              setOnlySaved(false);
              setCatalogScope("all");
              setAvailability("");
            }}
          >
            Посмотреть все меры
          </ActionButton>
        </div>
      )}
    </>
  );
}
