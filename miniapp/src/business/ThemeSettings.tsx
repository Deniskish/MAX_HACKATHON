import { setThemePreference, useThemePreference, type ThemePreference } from '../theme';
import { Icon } from './Icon';

const options: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Светлая' }, { value: 'dark', label: 'Тёмная' }, { value: 'system', label: 'Как на телефоне' },
];
export function ThemeSettings() {
  const preference = useThemePreference();
  return <fieldset className="theme-settings">
    <legend>Тема приложения</legend>
    <div className="theme-options">
      {options.map(option => <label key={option.value} className="theme-option">
        <input type="radio" name="app-theme" value={option.value} checked={preference === option.value} onChange={() => setThemePreference(option.value)} />
        <span className={`theme-preview theme-preview-${option.value}`} aria-hidden="true"><i /><i /><i /></span>
        <span className="theme-option-label">{option.label}</span>
        <span className="theme-option-check" aria-hidden="true">{preference === option.value && <Icon name="check" size={14} />}</span>
      </label>)}
    </div>
  </fieldset>;
}
