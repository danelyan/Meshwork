// Базовые компоненты по контракту (contract.md).
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

export function Button(props: ButtonProps) {
  void props;
  return <p>TODO: Button</p>;
}

export function Badge(props: BadgeProps) {
  void props;
  return <p>TODO: Badge</p>;
}

export function TextField(props: TextFieldProps) {
  void props;
  return <p>TODO: TextField</p>;
}
