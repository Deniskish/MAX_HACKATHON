import type { ComponentProps } from 'react';
import { Icon } from './Icon';

type Props = { label: string; icon?: string } & (
  | { as: 'summary'; onClick?: ComponentProps<'summary'>['onClick'] }
  | { as?: 'button'; onClick: ComponentProps<'button'>['onClick']; expanded?: boolean; controls?: string }
);

/** One touch target; native summary keeps disclosure keyboard/expanded semantics. */
export function InfoDisclosureRow(props: Props) {
  const content = <><Icon name={props.icon ?? 'info'} size={18} /><span>{props.label}</span><Icon name="chevron" size={18} /></>;
  return props.as === 'summary'
    ? <summary className="info-disclosure-row" onClick={props.onClick}>{content}</summary>
    : <button type="button" className="info-disclosure-row" onClick={props.onClick} aria-expanded={props.expanded} aria-controls={props.controls}>{content}</button>;
}
