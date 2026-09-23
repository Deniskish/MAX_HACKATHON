// Обёртки над MAX UI: общая тема без привязки к внутренним классам библиотеки.
import {
  Button,
  Input,
  Textarea,
  type InputProps,
  type TextareaProps,
} from '@maxhub/max-ui';

import React from 'react';

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
export function BusinessInput(props: InputProps) {
  return (
    <Input
      {...props}
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
