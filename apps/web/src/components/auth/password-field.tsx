'use client';

import { useState } from 'react';
import { TextField, type TextFieldProps } from '../ui/text-field';

/** Password input with an accessible show/hide toggle. */
export function PasswordField(props: Omit<TextFieldProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-ink underline-offset-2 hover:underline"
        >
          {visible ? 'Hide' : 'Show'}
          <span className="sr-only"> password</span>
        </button>
      }
    />
  );
}
