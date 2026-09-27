import { InfoDisclosure } from './InfoDisclosure';
import type { FormEvent } from "react";
import type { Profile } from "./domain";
import { goals, validInn } from "./domain";
import { FieldSource } from "./CompanySource";
import { InfoDisclosureRow } from "./InfoDisclosureRow";
import { Icon } from "./Icon";
import { ActionButton, BusinessInput } from "./MaxControls";
import type { useAccount } from "./AccountPanel";

export function CompanyProfileForm({
  form,
  editForm,
  step,
  setStep,
  companyLoading,
  savingCompany,
  autoFilledCompany,
  error,
  setError,
  account,
  saveProfile,
  onRemove,
}: {
  form: Profile;
  editForm: (next: Profile) => void;
  step: number;
  setStep: (next: number) => void;
  companyLoading: boolean;
  savingCompany: boolean;
  autoFilledCompany: boolean;
  error: string;
  setError: (next: string) => void;
  account: ReturnType<typeof useAccount>;
  saveProfile: (event: FormEvent) => void;
  onRemove?: () => void;
}) {
  return (
    <>
      <form
        className="company-profile-form"
        onSubmit={saveProfile}
        onInvalid={(e) => {
          const details = (e.target as HTMLElement).closest("details");
          if (details) details.open = true;
        }}
      >
        <header className="company-profile-heading">
          <h2>{step === 0 ? "ИНН вашего бизнеса" : "Данные для подбора"}</h2>
          <p className="muted">Шаг {step + 1} из 2</p>
        </header>
        <fieldset
          className="company-form-fields"
          disabled={companyLoading || savingCompany}
        >
          {step === 0 ? (
            <label className="field">
              ИНН
              <FieldSource profile={form} field="inn" />
              <BusinessInput
                autoFocus
                inputMode="numeric"
                maxLength={12}
                placeholder="10 или 12 цифр"
                value={form.inn}
                onChange={(e) =>
                  editForm({ ...form, inn: e.target.value.replace(/\D/g, "") })
                }
              />
            </label>
          ) : (
            <>
              {autoFilledCompany && (
                <section className="company-loaded-summary">
                  <span className="tag">Загружено по ИНН</span>
                  <h3>{form.name}</h3>
                  <p>
                    ИНН {form.inn} · {form.region}
                  </p>
                  <p>ОКВЭД {form.okved}</p>
                </section>
              )}
              <InfoDisclosure
                className="company-fields-section"
                defaultOpen={!autoFilledCompany}
                summary={<InfoDisclosureRow
                  as="summary"
                  label="Реквизиты компании"
                  icon="building"
                />}
              >
                <div className="form-grid">
                  <label className="field">
                    Название
                    <FieldSource profile={form} field="name" />
                    <BusinessInput
                      required
                      value={form.name}
                      onChange={(e) =>
                        editForm({ ...form, name: e.target.value })
                      }
                      placeholder="ООО «Название»"
                      maxLength={120}
                    />
                  </label>
                  <label className="field">
                    ИНН
                    <FieldSource profile={form} field="inn" />
                    <BusinessInput
                      required
                      inputMode="numeric"
                      maxLength={12}
                      value={form.inn}
                      onChange={(e) => {
                        const inn = e.target.value.replace(/\D/g, "");
                        editForm({ ...form, inn });
                      }}
                    />
                  </label>
                  <label className="field">
                    Форма бизнеса
                    <FieldSource profile={form} field="companyType" />
                    <select
                      value={form.companyType}
                      onChange={(e) =>
                        editForm({
                          ...form,
                          companyType: e.target.value as Profile["companyType"],
                        })
                      }
                    >
                      {["", "ООО", "АО", "ИП", "КФХ", "другое"].map((value) => (
                        <option key={value} value={value}>
                          {value || "Не указана"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Регион
                    <FieldSource profile={form} field="region" />
                    <BusinessInput
                      required
                      list="regions"
                      value={form.region}
                      onChange={(e) =>
                        editForm({ ...form, region: e.target.value })
                      }
                    />
                    <datalist id="regions">
                      <option>Москва</option>
                      <option>Санкт-Петербург</option>
                      <option>Республика Татарстан</option>
                      <option>Московская область</option>
                    </datalist>
                  </label>
                  <label className="field">
                    Основной ОКВЭД
                    <FieldSource profile={form} field="okved" />
                    <BusinessInput
                      required
                      placeholder="62.01"
                      value={form.okved}
                      onChange={(e) =>
                        editForm({ ...form, okved: e.target.value })
                      }
                    />
                  </label>
                </div>
              </InfoDisclosure>
              <InfoDisclosure className="company-fields-section"
                summary={<InfoDisclosureRow
                  as="summary"
                  label="Дополнительные параметры"
                />}
              >
                <p className="muted">
                  Можно пропустить. Неизвестные значения не считаются нулевыми.
                </p>
                <div className="form-grid">
                  {(["ageMonths", "employees", "revenue"] as const).map(
                    (key, i) => (
                      <label className="field" key={key}>
                        {
                          [
                            "Возраст компании, месяцев",
                            "Количество сотрудников",
                            "Годовой оборот, ₽",
                          ][i]
                        }
                        <FieldSource profile={form} field={key} />
                        <BusinessInput
                          type="number"
                          min="0"
                          max={
                            key === "revenue"
                              ? 1e15
                              : key === "employees"
                                ? 1e7
                                : 3000
                          }
                          step="1"
                          placeholder="Пока неизвестно"
                          value={form[key] ?? ""}
                          onChange={(e) =>
                            editForm({
                              ...form,
                              [key]:
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    ),
                  )}
                  <label className="field">
                    Статус МСП
                    <FieldSource profile={form} field="isSme" />
                    <select
                      value={form.isSme}
                      onChange={(e) =>
                        editForm({
                          ...form,
                          isSme: e.target.value as Profile["isSme"],
                        })
                      }
                    >
                      <option value="unknown">Не знаю</option>
                      <option value="yes">Есть в реестре</option>
                      <option value="no">Нет в реестре</option>
                    </select>
                  </label>
                  <label className="field">
                    Налоговый режим
                    <FieldSource profile={form} field="tax" />
                    <select
                      value={form.tax}
                      onChange={(e) =>
                        editForm({ ...form, tax: e.target.value })
                      }
                    >
                      {["", "УСН", "ОСНО", "ПСН", "ЕСХН", "АУСН", "СРП"].map(
                        (t) => (
                          <option key={t} value={t}>
                            {t || "Не указан"}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                </div>
              </InfoDisclosure>
              <label className="field">
                Чем занимается бизнес
                <BusinessInput
                  maxLength={120}
                  value={form.industry ?? ""}
                  placeholder="Например, производство мебели · необязательно"
                  onChange={(e) =>
                    editForm({ ...form, industry: e.target.value })
                  }
                />
              </label>
              <h3>Направления развития</h3>
              <div className="goal-chips">
                {goals.map((g) => (
                  <ActionButton
                    type="button"
                    aria-pressed={form.goals.includes(g)}
                    className={
                      "goal-chip " + (form.goals.includes(g) ? "chosen" : "")
                    }
                    key={g}
                    onClick={() =>
                      editForm({
                        ...form,
                        goals: form.goals.includes(g)
                          ? form.goals.filter((x) => x !== g)
                          : [...form.goals, g],
                      })
                    }
                  >
                    {form.goals.includes(g) ? "✓ " : "+ "}
                    {g}
                  </ActionButton>
                ))}
              </div>
            </>
          )}
          {error && step > 0 && (
            <p className="muted" role="status">
              Изменения ещё не сохранены.
              {account.available && !account.account && (
                <button
                  type="button"
                  className="text-button"
                  disabled={account.loading}
                  onClick={() => void account.refresh()}
                >
                  {account.loading
                    ? "Подключаем аккаунт…"
                    : "Подключить аккаунт MAX"}
                </button>
              )}
            </p>
          )}
          {error && !validInn(form.inn) && (
            <p className="muted">Введите ИНН — 10 или 12 цифр.</p>
          )}
          {error === "Укажите название, регион и ОКВЭД (например, 62.01)." && (
            <p className="muted">Заполните название, регион и ОКВЭД.</p>
          )}
          <div className="modal-actions">
            {step === 1 && (
              <ActionButton
                type="button"
                className="secondary"
                onClick={() => setStep(0)}
              >
                Назад
              </ActionButton>
            )}
            <ActionButton className="primary" type="submit">
              {step === 0
                ? companyLoading
                  ? "Загружаем сведения…"
                  : error
                    ? "Повторить загрузку"
                    : "Загрузить по ИНН"
                : savingCompany
                  ? "Сохраняем…"
                  : error
                    ? "Повторить сохранение"
                    : "Сохранить бизнес"}
              <Icon name="arrow" size={17} />
            </ActionButton>
            {step === 0 && (
              <button
                type="button"
                className="company-manual-fallback"
                onClick={() => {
                  if (!validInn(form.inn)) {
                    setError("Введите корректный ИНН.");
                    return;
                  }
                  setError("");
                  setStep(1);
                }}
              >
                Заполнить вручную
              </button>
            )}
          </div>
          {onRemove && <div className="business-removal">
            <button type="button" className="remove-business" onClick={onRemove}>Удалить бизнес</button>
          </div>}
        </fieldset>
      </form>
    </>
  );
}
