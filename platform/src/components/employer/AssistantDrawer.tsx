'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react';

import { COMPANION_NAME } from '@/lib/persona';


import { AssistantChat } from './AssistantChat';
import type { EmployerRestoredChat } from '@/server/agent/employer/restore';
import styles from './AssistantDrawer.module.css';

const STORAGE_KEY = 'employer-assistant-drawer';
const NEED_PATH = /^\/employer\/needs\/([^/]+)/;

export interface AssistantPageContext {
  path: string;
  vacancyId?: string | null;
}

/** Контекст страницы для помощницы: путь и id вакансии из /employer/needs/[id] (кроме /new). */
export function pageContext(pathname: string): AssistantPageContext {
  const m = NEED_PATH.exec(pathname);
  let vacancyId: string | null = null;
  const id = m?.[1];
  if (id && id !== 'new') {
    try {
      vacancyId = decodeURIComponent(id);
    } catch {
      vacancyId = id;
    }
  }
  return { path: pathname, vacancyId };
}

const VACANCY_CHIPS = ['Подбери под эту вакансию', 'Кто в базе под неё', 'Сделай проектное задание к ней'];
const COMMON_CHIPS = ['Что у меня в подборке', 'Поищи по базе', 'Дополни профиль компании'];

function readOpen(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Плавающая помощница «Кира» на экранах работодателя: кнопка-портрет и боковая панель с чатом. */
export function AssistantDrawer({ initial, demoNoLlm }: { initial?: EmployerRestoredChat; demoNoLlm?: boolean } = {}) {
  const pathname = usePathname() ?? '';
  const page = pageContext(pathname);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const userAction = useRef(false);

  useEffect(() => {
    if (readOpen()) {
      setOpen(true);
      setEverOpened(true);
    }
  }, []);

  const change = useCallback((next: boolean) => {
    userAction.current = true;
    setOpen(next);
    if (next) setEverOpened(true);
    try {
      sessionStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* приватный режим */
    }
  }, []);

  useEffect(() => {
    if (!userAction.current) return;
    (open ? closeRef.current : triggerRef.current)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') change(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, change]);

  /** Фокус не уходит из диалога по Tab. */
  const trap = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const nodes = panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!nodes?.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const chips = page.vacancyId ? VACANCY_CHIPS : COMMON_CHIPS;

  return (
    <>
      <button ref={triggerRef} type="button" className={styles.dock} onClick={() => change(true)} aria-haspopup="dialog" aria-expanded={open} aria-label="Спросить помощницу про подборку">
        <div className={styles.portrait}><Image src="/models/head-reference.png" alt="" fill sizes="210px" /></div>
        <span>Спросить про подборку <b aria-hidden="true">↗</b></span>
      </button>
      {everOpened && (
        <>
          <div className={styles.backdrop} hidden={!open} onClick={() => change(false)} aria-hidden="true" data-testid="assistant-backdrop" />
          <div ref={panelRef} className={styles.panel} hidden={!open} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trap}>
            <div className={styles.head}>
              <h2 id={titleId}>{COMPANION_NAME} <span>· помощница по подбору</span></h2>
              <div className={styles.actions}>
                <Link className={styles.full} href="/employer/assistant" onClick={() => change(false)}>Открыть на весь экран ↗</Link>
                <button ref={closeRef} type="button" className={styles.close} onClick={() => change(false)} aria-label="Закрыть помощницу">×</button>
              </div>
            </div>
            <div className={styles.body}>
              <AssistantChat initial={initial} demoNoLlm={demoNoLlm} page={page} quickPrompts={chips} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
