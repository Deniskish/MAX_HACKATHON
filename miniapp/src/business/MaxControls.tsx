// Обёртки над MAX UI: общая тема без привязки к внутренним классам библиотеки.
import {
  Button,
  Input,
  Textarea,
  type InputProps,
  type TextareaProps,
} from '@maxhub/max-ui';

import React from 'react';

/** Pointer focus is not keyboard focus; keep the latter available after Tab/keyboard activation. */
export function IconButton({ className = '', type = 'button', onPointerDown, onKeyDown, onBlur,
  ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type={type} className={`opora-icon-action ${className}`}
    onPointerDown={event => { event.currentTarget.dataset.pointerFocus = 'true'; onPointerDown?.(event); }}
    onKeyDown={event => { delete event.currentTarget.dataset.pointerFocus; onKeyDown?.(event); }}
    onBlur={event => { delete event.currentTarget.dataset.pointerFocus; onBlur?.(event); }} />;
}

// Настраиваем MAX UI через публичные свойства, чтобы обновления не ломали тему.
export function ActionButton({ className = '', type = 'button', ...props }: React.ComponentProps<typeof Button>) {
  const variant =
    className.includes('primary') || className.includes('lime-button')
      ? 'primary'
      : className.includes('secondary')
        ? 'secondary'
        : 'ghost';
  return (
    <Button
      {...props}
      type={type}
      variant={variant}
      size="small"
      className={`opora-action ${className}`}
      innerClassNames={{ content: 'opora-action-content' }}
    />
  );
}
export function BusinessInput({ className = '', ...props }: InputProps) {
  return (
    <Input
      {...props}
      className={`opora-input-control ${className}`}
      size="medium"
      withClearButton={false}
      innerClassNames={{
        container: 'opora-input',
        body: 'opora-input-body',
        input: 'opora-native-input',
      }}
    />
  );
}
export function BusinessTextarea(props: TextareaProps) {
  return (
    <Textarea
      {...props}
      className="opora-textarea"
      innerClassNames={{ textarea: 'opora-native-textarea' }}
    />
  );
}
