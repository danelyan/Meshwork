// Dialog по контракту (contract.md). Заготовка: части ничего не рендерят.
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

function DialogRoot({ children }: DialogProps) {
  // TODO: состояние (контролируемое / неконтролируемое), контекст, стек окон
  return <>{children}</>;
}

function Trigger(_props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return null;
}

function Content(_props: HTMLAttributes<HTMLDivElement> & { role?: 'dialog' | 'alertdialog' }) {
  return null;
}

function Title(_props: HTMLAttributes<HTMLHeadingElement>) {
  return null;
}

function Description(_props: HTMLAttributes<HTMLParagraphElement>) {
  return null;
}

function Close(_props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return null;
}

export const Dialog = Object.assign(DialogRoot, { Trigger, Content, Title, Description, Close });
