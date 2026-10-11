// Эталон: базовые компоненты по контракту.
import { useId } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

export interface BadgeProps {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  count?: number;
  max?: number;
  hideZero?: boolean;
  children?: ReactNode;
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password' | 'search';
  id?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

export function Button({ variant = 'primary', loading = false, type = 'button', disabled, onClick, children, ...rest }: ButtonProps) {
  const busy = loading && !disabled;
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      data-variant={variant}
      aria-busy={busy ? 'true' : undefined}
      aria-disabled={busy ? 'true' : undefined}
      onClick={(e) => {
        if (disabled || busy) return;
        onClick?.(e);
      }}
    >
      {busy ? <span aria-hidden="true" data-spinner="" /> : null}
      {children}
    </button>
  );
}

export function Badge({ tone = 'neutral', count, max = 99, hideZero = false, children }: BadgeProps) {
  let content: ReactNode = children;
  if (content === undefined || content === null) {
    if (count === undefined) return null;
    const n = Math.max(0, count);
    if (hideZero && n === 0) return null;
    content = n > max ? `${max}+` : String(n);
  }
  return <span data-tone={tone}>{content}</span>;
}

export function TextField({ label, value, onChange, type = 'text', id, hint, error, required, disabled }: TextFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const described = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type={type}
        value={value}
        required={required}
        disabled={disabled}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={described || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <p id={hintId}>{hint}</p> : null}
      {error ? <p id={errorId} role="alert">{error}</p> : null}
    </div>
  );
}
