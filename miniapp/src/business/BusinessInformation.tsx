import { ActionButton } from "./MaxControls";
import { FieldSource } from "./CompanySource";
import type { Profile, ProfileValues } from "./domain";
import type {
  ProjectProfile,
  FundingNeed,
} from "../../api-server/funding-catalog/types";

export function BusinessInformation({
  profile,
  companyProfile,
  projectProfile,
  need,
  openProfile,
  savedToAccount,
}: {
  profile: Profile;
  companyProfile: Profile | null;
  projectProfile: ProjectProfile | null;
  need: FundingNeed;
  openProfile: () => void;
  savedToAccount: boolean;
}) {
  return (
    <>
      <section className="profile-panel business-information">
        <div className="section-title">
          <div>
            <span className="tag">
              {companyProfile ? "Профиль бизнеса" : "Проект без компании"}
            </span>
            <h2>{profile.name}</h2>
          </div>
          <ActionButton className="secondary" onClick={openProfile}>
            Редактировать
          </ActionButton>
        </div>
        {companyProfile && (
          <>
            <FieldSource profile={profile} field="name" />
          </>
        )}
        {projectProfile && !companyProfile ? (
          <dl className="profile-grid">
            {[
              ["Регион", projectProfile.region],
              ["Направление", projectProfile.industry],
              [
                "Стадия",
                {
                  idea: "Идея",
                  prototype: "Прототип",
                  mvp: "MVP",
                  revenue: "Есть выручка проекта",
                }[projectProfile.stage],
              ],
              [
                "Команда",
                projectProfile.teamSize === null
                  ? "Не указана"
                  : `${projectProfile.teamSize} чел.`,
              ],
              ["Цель финансирования", need.purpose || "Не указана"],
              [
                "Требуемая сумма",
                need.amount === null
                  ? "Не указана"
                  : `${need.amount.toLocaleString("ru-RU")} ₽`,
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <>
            <dl className="profile-grid">
              {[
                ["ИНН", profile.inn, "inn"],
                [
                  "Форма бизнеса",
                  profile.companyType || "Не указана",
                  "companyType",
                ],
                ["Регион", profile.region, "region"],
                ["Основной ОКВЭД", profile.okved, "okved"],
                [
                  "Возраст компании",
                  profile.ageMonths === null
                    ? "Не указан"
                    : `${profile.ageMonths} мес.`,
                  "ageMonths",
                ],
                ["Сотрудники", profile.employees ?? "Не указано", "employees"],
                [
                  "Годовой оборот",
                  profile.revenue === null
                    ? "Не указан"
                    : `${profile.revenue.toLocaleString("ru-RU")} ₽`,
                  "revenue",
                ],
                ["Налоговый режим", profile.tax || "Не указан", "tax"],
                [
                  "Статус МСП",
                  profile.isSme === "yes"
                    ? "Да"
                    : profile.isSme === "no"
                      ? "Нет"
                      : "Неизвестно",
                  "isSme",
                ],
              ].map(([k, v, field]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>
                    {v}
                    <FieldSource
                      profile={profile}
                      field={field as keyof ProfileValues}
                    />
                  </dd>
                </div>
              ))}
            </dl>
            <h3>Цели развития</h3>
            <div className="goal-chips">
              {profile.goals.map((g) => (
                <span className="tag" key={g}>
                  {g}
                </span>
              ))}
              {profile.goals.length === 0 && (
                <span className="muted">Добавьте цели в профиле бизнеса.</span>
              )}
            </div>
          </>
        )}
        <div className="data-note">
          {savedToAccount
            ? "Компания сохранена в аккаунте MAX. Черновики и документы остаются на этом устройстве."
            : "Профиль и черновики сохранены на этом устройстве. Подключение аккаунта — в настройках."}
        </div>
      </section>
    </>
  );
}
