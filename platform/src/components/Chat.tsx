'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { type ClaimAction, claimAction, fetchDemoResume, openConsultantStream, parseUrls, uploadFile } from '@/lib/api';
import type { CardClaim } from '@/lib/claims-view';
import { createSseParser } from '@/lib/sse';
import type { AgentEvent } from '@/server/agent/types';
import type { ChatDemoContext } from '@/server/demo/context';

import styles from './Chat.module.css';
import { EventFeed, type FeedItem } from './EventFeed';
import { type UploadedFile, Uploader } from './Uploader';
import ui from './ui.module.css';

const GREETING =
  'Пришлите резюме или ссылки — GitHub, Codeforces, статьи, портфолио. Можно всё сразу. Я найду в них утверждения о ваших навыках, покажу цитаты и спрошу, всё ли верно. Категорию (специализацию и грейд) даёт только тест.';

/** Коды ошибок, при которых консультант недоступен и включается упрощённый режим. */
const SIMPLIFIED_CODES = new Set(['llm_unavailable', 'llm_rate_limited', 'rate_limited', 'daily_limit', 'network', 'budget_exceeded']);

let seq = 0;
const nextId = () => `i${++seq}`;

export function Chat({ demo }: { demo?: ChatDemoContext }) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Partial<CardClaim>>>({});
  const [text, setText] = useState('');
  const [urlsText, setUrlsText] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [simplified, setSimplified] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Разговор создаёт сервер на первом ходе (событие conversation); дальше шлём его id.
  const conversationRef = useRef<string | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);
  const textId = useId();
  const urlsId = useId();

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [items.length]);

  const pushEvent = useCallback((event: AgentEvent) => {
    if (event.type === 'conversation') {
      conversationRef.current = event.id;
      return;
    }
    setItems((p) => [...p, { id: nextId(), role: 'agent', event }]);
    if (event.type === 'error' && SIMPLIFIED_CODES.has(event.code)) setSimplified(true);
  }, []);

  const send = useCallback(
    async (message: string, uploadIds: string[], urls: string[], fileNames: string[]) => {
      setBusy(true);
      setItems((p) => [...p, { id: nextId(), role: 'user', text: message, files: [...fileNames, ...urls] }]);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const stream = await openConsultantStream({ text: message, uploadIds, urls, conversationId: conversationRef.current }, ctrl.signal);
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const ev of parser.push(decoder.decode(value, { stream: true }))) pushEvent(ev);
        }
        for (const ev of parser.push(decoder.decode())) pushEvent(ev);
        for (const ev of parser.flush()) pushEvent(ev);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          const code = (e as { code?: string }).code ?? 'network';
          pushEvent({ type: 'error', code, message: e instanceof Error ? e.message : 'Что-то пошло не так.' });
        }
      } finally {
        setBusy(false);
      }
    },
    [pushEvent],
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    const { urls, invalid } = parseUrls(urlsText);
    if (invalid.length) {
      setFormError(`Не похоже на ссылку: ${invalid.join(', ')}`);
      return;
    }
    if (files.some((f) => f.status === 'uploading')) {
      setFormError('Дождитесь окончания загрузки файлов.');
      return;
    }
    const done = files.filter((f) => f.status === 'done' && f.id);
    const message = text.trim() || (done.length || urls.length ? 'Вот мои материалы.' : '');
    if (!message) {
      setFormError('Напишите сообщение или приложите резюме и ссылки.');
      return;
    }
    const uploadIds = done.map((f) => f.id as string);
    const names = done.map((f) => f.name);
    setText('');
    setUrlsText('');
    setFiles([]);
    await send(message, uploadIds, urls, names);
  }

  async function loadDemoResume() {
    if (!demo?.resume) return;
    const { fileName, link } = demo.resume;
    const key = `demo-${fileName}`;
    setFormError(null);
    setFiles((p) => (p.some((f) => f.key === key) ? p : [...p, { key, name: fileName, status: 'uploading' }]));
    setUrlsText((t) => (t.includes(link) ? t : t ? `${t}\n${link}` : link));
    try {
      const r = await uploadFile(await fetchDemoResume(fileName));
      setFiles((p) => p.map((f) => (f.key === key ? { ...f, status: 'done', id: r.id } : f)));
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Не удалось загрузить демо-резюме.';
      setFiles((p) => p.map((f) => (f.key === key ? { ...f, status: 'error', error } : f)));
    }
  }

  const onClaimAction = useCallback(async (claim: CardClaim, action: ClaimAction, statement?: string) => {
    await claimAction(claim.id, action, statement);
    setOverrides((p) => ({
      ...p,
      [claim.id]: {
        status: action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'edited',
        ...(action === 'edit' && statement ? { statement } : {}),
      },
    }));
  }, []);

  const onConfirmAll = useCallback(
    async (claims: CardClaim[]) => {
      for (const c of claims) await onClaimAction(c, 'confirm');
    },
    [onClaimAction],
  );

  return (
    <div className={styles.chat}>
      <header className={styles.intro}>
        <h1>Карьерный консультант</h1>
        <p>{GREETING}</p>
        {demo?.noLlm && (
          <p className={styles.demoNote} role="note">
            Демо-режим без языковой модели: ответы собираются по шаблонам из данных платформы, утверждения ищутся по словарю каталога.
          </p>
        )}
      </header>

      {simplified && (
        <div className={`${ui.notice} ${styles.simple}`} role="status">
          <strong>Упрощённый режим.</strong>
          <span>
            Консультант сейчас недоступен, но платформа работает: посмотрите <Link href="/profile">профиль</Link>, уже подтверждённые
            утверждения не потеряны. Попробуйте отправить сообщение ещё раз чуть позже.
          </span>
        </div>
      )}

      <EventFeed
        items={items}
        claimOverrides={overrides}
        onClaimAction={onClaimAction}
        onConfirmAll={onConfirmAll}
        onAnswer={(t) => void send(t, [], [], [])}
        locked={busy}
      />
      {busy && (
        <p className={ui.muted} role="status" aria-live="polite">
          <span className={ui.spinner} aria-hidden="true" /> Консультант работает…
        </p>
      )}
      <div ref={endRef} />

      <form className={styles.composer} onSubmit={onSubmit} aria-label="Новое сообщение">
        <details className={styles.details} open={items.length === 0}>
          <summary>Файлы и ссылки</summary>
          <div>
            {demo?.resume && (
              <div className={styles.demoResume}>
                <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => void loadDemoResume()} disabled={busy}>
                  Загрузить демо-резюме
                </button>
                <span className={ui.muted}>
                  Подставит {demo.resume.fileName} и ссылку {demo.resume.link} — файлы искать не нужно.
                </span>
              </div>
            )}
            <Uploader files={files} onChange={(u) => setFiles(u)} disabled={busy} />
            <div className={styles.row}>
              <label htmlFor={urlsId} className={ui.label}>
                Ссылки (GitHub, Codeforces, статьи, портфолио) — через пробел или с новой строки
              </label>
              <textarea id={urlsId} value={urlsText} onChange={(e) => setUrlsText(e.target.value)} rows={2} placeholder="github.com/name" disabled={busy} />
            </div>
          </div>
        </details>
        <div className={styles.send}>
          <div className={styles.row} style={{ flex: 1 }}>
            <label htmlFor={textId} className={ui.label}>
              Сообщение
            </label>
            <textarea
              id={textId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Собери мне профиль"
              disabled={busy}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
              }}
            />
          </div>
          <button type="submit" className={`${ui.btn} ${ui.primary} ${styles.sendBtn}`} disabled={busy}>
            Отправить
          </button>
        </div>
        {formError && (
          <p className={styles.warn} role="alert">
            {formError}
          </p>
        )}
      </form>
    </div>
  );
}
