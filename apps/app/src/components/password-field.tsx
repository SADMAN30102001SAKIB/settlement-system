import { useId, useState } from 'react';
import type { InputHTMLAttributes } from 'react';

export function PasswordField({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
>) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <span className="password-control">
        <input
          {...props}
          id={id}
          aria-describedby={hint ? id + '-hint' : undefined}
          type={visible ? 'text' : 'password'}
        />
        <button
          type="button"
          className="secondary compact"
          disabled={props.disabled}
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => {
            setVisible(!visible);
          }}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </span>
      {hint ? <small id={id + '-hint'}>{hint}</small> : null}
    </div>
  );
}
