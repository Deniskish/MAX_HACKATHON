import React, { type ReactNode } from 'react';
import { Icon } from './Icon';
import { ModalSheet } from './ModalSheet';

export function ContextHelp({ title, children }: { title: string; children: ReactNode }) {
  return <details className="context-help"><summary><span className="help-symbol" aria-hidden="true">i</span>{title}<Icon name="chevron" size={14} /></summary><div className="context-help-content">{children}</div></details>;
}

export function AIDataHelp({ children }: { children: ReactNode }) {
  return <ContextHelp title="Какие данные получает AI"><p>{children}</p><p>Известные реквизиты скрываются. Не добавляйте лишние персональные данные.</p></ContextHelp>;
}

type GuideTopic = 'funding' | 'documents';
const guides = {
  funding: {
    title: 'Как подобрать поддержку',
    steps: [
      { title: 'Укажите задачу', text: 'Выберите цель. Если знаете сумму и срок — добавьте их. Собственные средства укажите отдельно от суммы, которую хотите привлечь.', icon: 'compass', labels: ['Цель', 'Сумма', 'Срок'] },
      { title: 'Сравните варианты', text: 'Откройте условия программы. «Нужно уточнить» означает, что данных недостаточно; «Почти подходит» — что часть требований ещё не выполнена.', icon: 'search', labels: ['Условия', 'Соответствие', 'Документы'] },
      { title: 'Перейдите к подготовке', text: 'Сохраните подходящую программу или нажмите «Начать подготовку» в её карточке. Черновик появится в разделе «Заявки».', icon: 'file', labels: ['Программа', 'Подготовка', 'Заявки'] },
    ],
    note: 'Подбор сравнивает данные с условиями каталога. Решение принимает оператор программы; перед подачей проверьте условия в официальном источнике.',
  },
  documents: {
    title: 'Как подготовить заявку',
    steps: [
      { title: 'Соберите документы', text: 'Раскройте нужный документ: там указано, где его получить и что включить. Загрузите файл или вставьте текст. Галочка отмечает вашу готовность, а не результат проверки.', icon: 'file', labels: ['Файл', 'Текст', 'Проверка'] },
      { title: 'Опишите проект', text: 'Укажите, что планируете сделать, ожидаемый результат и бюджет. Выберите тип документа и сформируйте черновик. Его можно редактировать и скачать.', icon: 'edit', labels: ['Проект', 'Бюджет', 'Черновик'] },
      { title: 'Проверьте и подайте', text: 'Откройте «AI-проверка заявки» и запустите проверку. Исправьте замечания, сверьте комплект с требованиями оператора и подайте заявку на его сайте.', icon: 'check', labels: ['AI-проверка', 'Правки', 'Оператор'] },
    ],
    note: 'Опора готовит черновики и помогает с проверкой. Заявка не отправляется автоматически. Если AI недоступен, подготовку можно продолжить вручную.',
  },
};

// Lightweight vector diagrams illustrate the workflow without loading new bitmap assets.
function StepIllustration({ icon, labels }: { icon: string; labels: string[] }) {
  return <div className="guide-illustration" role="img" aria-label={labels.join(' → ')}>
    <div className="guide-preview" aria-hidden="true"><Icon name={icon} size={30} /><div><i /><i /><i /></div><Icon name="check" size={18} /></div>
    <div className="guide-flow" aria-hidden="true">{labels.map((label, index) => <span key={label}>{index > 0 && <Icon name="chevron" size={12} />}<b>{label}</b></span>)}</div>
  </div>;
}

export function GuideLink({ topic }: { topic: GuideTopic }) {
  const [open, setOpen] = React.useState(false);
  const guide = guides[topic];
  return <>
    <button type="button" className="guide-link" onClick={() => setOpen(true)}><span className="help-symbol" aria-hidden="true">?</span>{guide.title}<Icon name="chevron" size={14} /></button>
    {open && <ModalSheet title={guide.title} onClose={() => setOpen(false)}>
      <div className="help-guide"><ol>{guide.steps.map((step, index) => <li key={step.title}>
        <StepIllustration icon={step.icon} labels={step.labels} />
        <h2><span>{index + 1}</span>{step.title}</h2><p>{step.text}</p>
      </li>)}</ol><p className="guide-note">{guide.note}</p><button type="button" className="guide-done" onClick={() => setOpen(false)}>Вернуться к работе <Icon name="arrow" size={18} /></button></div>
    </ModalSheet>}
  </>;
}
