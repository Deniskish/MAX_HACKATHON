import { ActionButton } from './MaxControls';

export function SupportIntroduction({ onBusiness, onProject }: { onBusiness: () => void; onProject: () => void }) {
  return <section className="support-introduction" aria-label="С чего начать">
    <h2>С чего начать</h2>
    <ol>
      <li>Есть бизнес — добавьте его по ИНН.</li>
      <li>Компании ещё нет — опишите проект или идею.</li>
      <li>После этого Опора покажет подходящие меры поддержки.</li>
    </ol>
    <div className="support-introduction-actions">
      <ActionButton className="primary" onClick={onBusiness}>Добавить бизнес по ИНН</ActionButton>
      <ActionButton className="secondary" onClick={onProject}>У меня пока нет компании</ActionButton>
    </div>
  </section>;
}
