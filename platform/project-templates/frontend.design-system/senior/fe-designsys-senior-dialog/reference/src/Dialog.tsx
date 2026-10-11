// Эталон: модальный Dialog по контракту.
import { createContext, useContext, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, MouseEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

/* ---------- стек открытых окон (на уровне модуля: окна могут быть из разных деревьев React) ---------- */

interface Entry {
  dialog: HTMLElement;
  lastFocus: HTMLElement | null;
  requestClose: () => void;
}

const stack: Entry[] = [];
let savedOverflow = '';

const TABBABLE = 'a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]';

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => {
    const ti = el.getAttribute('tabindex');
    if (ti !== null && Number.parseInt(ti, 10) < 0) return false;
    if (el.matches(':disabled')) return false;
    return el.closest('[hidden]') === null;
  });
}

const top = () => stack[stack.length - 1];

function onKeyDown(e: KeyboardEvent) {
  const t = top();
  if (!t) return;
  if (e.key === 'Escape') {
    t.requestClose();
    return;
  }
  if (e.key !== 'Tab') return;
  const items = tabbables(t.dialog);
  if (items.length === 0) {
    e.preventDefault();
    t.dialog.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (!active || !t.dialog.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && (active === t.dialog || active === first)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

function onFocusIn(e: FocusEvent) {
  const t = top();
  if (!t) return;
  const target = e.target as Node | null;
  if (target && t.dialog.contains(target)) {
    if (target !== t.dialog) t.lastFocus = target as HTMLElement;
    return;
  }
  const back = t.lastFocus && t.dialog.contains(t.lastFocus) ? t.lastFocus : t.dialog;
  back.focus();
}

function register(entry: Entry, overlay: HTMLElement): () => void {
  if (stack.length === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
  }
  stack.push(entry);
  const hidden: Array<[Element, string | null]> = [];
  for (const el of Array.from(document.body.children)) {
    if (el === overlay || el.getAttribute('aria-hidden') === 'true') continue;
    hidden.push([el, el.getAttribute('aria-hidden')]);
    el.setAttribute('aria-hidden', 'true');
  }
  return () => {
    const i = stack.indexOf(entry);
    if (i !== -1) stack.splice(i, 1);
    for (const [el, prev] of hidden) {
      if (prev === null) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', prev);
    }
    if (stack.length === 0) {
      document.body.style.overflow = savedOverflow;
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
    }
  };
}

/* ---------- компоненты ---------- */

interface Ctx {
  open: boolean;
  setOpen: (next: boolean) => void;
  dialogId: string;
  titleId: string;
  descId: string;
  hasTitle: boolean;
  hasDesc: boolean;
  setHasTitle: (v: boolean) => void;
  setHasDesc: (v: boolean) => void;
  openerRef: RefObject<HTMLElement | null>;
}

const DialogContext = createContext<Ctx | null>(null);

function useDialogCtx(part: string): Ctx {
  const c = useContext(DialogContext);
  if (!c) throw new Error(`Dialog.${part} must be used within <Dialog>`);
  return c;
}

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

function DialogRoot({ open, defaultOpen = false, onOpenChange, children }: DialogProps) {
  const uid = useId();
  const [inner, setInner] = useState(defaultOpen);
  const [hasTitle, setHasTitle] = useState(false);
  const [hasDesc, setHasDesc] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const isOpen = open !== undefined ? open : inner;
  const setOpen = (next: boolean) => {
    if (open === undefined) setInner(next);
    onOpenChange?.(next);
  };
  const value: Ctx = {
    open: isOpen,
    setOpen,
    dialogId: `${uid}-dialog`,
    titleId: `${uid}-title`,
    descId: `${uid}-desc`,
    hasTitle,
    hasDesc,
    setHasTitle,
    setHasDesc,
    openerRef,
  };
  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
}

function Trigger({ onClick, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const c = useDialogCtx('Trigger');
  return (
    <button
      {...rest}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={c.open ? 'true' : 'false'}
      aria-controls={c.open ? c.dialogId : undefined}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        c.openerRef.current = e.currentTarget;
        c.setOpen(true);
      }}
    />
  );
}

type ContentProps = HTMLAttributes<HTMLDivElement> & { role?: 'dialog' | 'alertdialog' };

function Content({ role = 'dialog', ...rest }: ContentProps) {
  const c = useDialogCtx('Content');
  if (!c.open) return null;
  return createPortal(<OpenContent c={c} role={role} rest={rest} />, document.body);
}

function OpenContent({ c, role, rest }: { c: Ctx; role: 'dialog' | 'alertdialog'; rest: HTMLAttributes<HTMLDivElement> }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(() => c.setOpen(false));
  closeRef.current = () => c.setOpen(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const overlay = overlayRef.current!;
    const prev = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const opener = c.openerRef.current;
    const unregister = register({ dialog, lastFocus: null, requestClose: () => closeRef.current() }, overlay);
    const auto = dialog.querySelector<HTMLElement>('[data-autofocus]');
    (auto ?? tabbables(dialog)[0] ?? dialog).focus();
    return () => {
      unregister();
      const back = prev && prev.isConnected ? prev : opener && opener.isConnected ? opener : null;
      back?.focus();
      c.openerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={overlayRef}
      data-dialog-overlay=""
      onClick={(e) => {
        if (e.target === e.currentTarget && role !== 'alertdialog') c.setOpen(false);
      }}
    >
      <div
        {...rest}
        ref={dialogRef}
        id={c.dialogId}
        role={role}
        aria-modal="true"
        aria-labelledby={c.hasTitle ? c.titleId : undefined}
        aria-describedby={c.hasDesc ? c.descId : undefined}
        tabIndex={-1}
      />
    </div>
  );
}

function Title(props: HTMLAttributes<HTMLHeadingElement>) {
  const c = useDialogCtx('Title');
  const { setHasTitle } = c;
  useLayoutEffect(() => {
    setHasTitle(true);
    return () => setHasTitle(false);
  }, [setHasTitle]);
  return <h2 {...props} id={c.titleId} />;
}

function Description(props: HTMLAttributes<HTMLParagraphElement>) {
  const c = useDialogCtx('Description');
  const { setHasDesc } = c;
  useLayoutEffect(() => {
    setHasDesc(true);
    return () => setHasDesc(false);
  }, [setHasDesc]);
  return <p {...props} id={c.descId} />;
}

function Close({ onClick, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const c = useDialogCtx('Close');
  return (
    <button
      {...rest}
      type="button"
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) c.setOpen(false);
      }}
    />
  );
}

export const Dialog = Object.assign(DialogRoot, { Trigger, Content, Title, Description, Close });

