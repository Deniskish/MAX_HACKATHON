import { ThemeSettings } from "./ThemeSettings";
import { AccountPanel, type useAccount } from "./AccountPanel";
import {
  SupportNotificationSettings,
  type useSupportNotifications,
} from "./SupportNotifications";
import type { Profile } from "./domain";

export function SettingsPage({
  account,
  companyProfile,
  profile,
  supportNotifications,
  onRestore,
  onSave,
  onRemove,
}: {
  account: ReturnType<typeof useAccount>;
  companyProfile: Profile | null;
  profile: Profile | null;
  supportNotifications: ReturnType<typeof useSupportNotifications>;
  onRestore: (profile: Profile) => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      {
        <div className="settings-page">
          <ThemeSettings />
          <AccountPanel
            state={account}
            hasCompany={!!companyProfile}
            onRestore={onRestore}
            onSave={onSave}
          />
          {profile && (
            <SupportNotificationSettings notifications={supportNotifications} />
          )}
          {profile && (
            <div className="business-removal">
              <button
                type="button"
                className="remove-business"
                onClick={onRemove}
              >
                Удалить бизнес
              </button>
            </div>
          )}
        </div>
      }
    </>
  );
}
