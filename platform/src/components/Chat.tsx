'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { type ClaimAction, claimAction, confirmClaimsBatchApi, fetchDemoResume, openConsultantStream, stopConsultantTurn } from '@/lib/api';
import { extractUrls } from '@/lib/links';
import type { CardClaim } from '@/lib/claims-view';
import { createSseParser } from '@/lib/sse';
import type { AgentEvent } from '@/server/agent/types';
import type { RestoredChat } from '@/server/agent/restore';
import type { ChatDemoContext } from '@/server/demo/context';

import { CompanionVoiceProvider, useCompanionVoice } from './avatar/voice';
import { useCallMode } from './call/CallContext';
import styles from './Chat.module.css';
import { useAttachments } from './chat/attachments';
import { useChatDraft } from './chat/draft';
import { Composer } from './chat/Composer';
import { useAsideRefresh } from './consultant/aside-refresh';
import { materialsMessage, useMaterialsHandler } from './consultant/materials';
import { applyAgentEvent } from './chat/stream-items';
import { diffItems, telemetryOn, track, trackFrame, trackVirtual, turnEnd, turnEvent, turnStart } from './chat/telemetry';
import { AssistantRow, QuickReplies, type QuickReply, Reply, Typing } from './chat/Thread';
import { scrollToEnd, useStickToBottom } from './chat/scroll';
import { EventFeed, type FeedItem } from './EventFeed';
import { Button, VisuallyHidden } from './ui';
import ui from './ui.module.css';

const GREETING =
  'Пришли резюме или ссылки - прикрепи файл скрепкой, перетащи его в ленту или просто вставь ссылку на GitHub, Codeforces, статьи, портфолио. Я найду в них утверждения о твоих навыках, покажу цитаты и спрошу, всё ли верно. Категорию (специализацию и грейд) даёт только тест.';

/** Приветствие после онбординга: та же лента, помощник становится консультантом. */
const CONTINUE_GREETING =
  'Дальше я - твой карьерный консультант. Пришли резюме или ссылки, спроси, что подтянуть до следующего грейда, - или выбери шаг ниже.';

export interface ChatEmbedded {
  /** Подсказки следующих шагов — чипами под приветствием, пока не начат разговор. */
  suggestions?: QuickReply[];
  onSuggestion?: (value: string) => void;
  /** Подсказка, которая остаётся над полем ввода и после начала разговора (анкета кандидата: «Дополнить профиль»). */
  pinned?: QuickReply;
  /** Перед первой отправкой (онбординг: завершить знакомство). */
  beforeSend?: () => Promise<void>;
}

/** Коды ошибок, при которых консультант недоступен и включается упрощённый режим. */
const SIMPLIFIED_CODES = new Set(['llm_unavailable', 'llm_rate_limited', 'rate_limited', 'daily_limit', 'network', 'budget_exceeded']);

let seq = 0;
const nextId = () => `i${++seq}`;

interface ChatProps {
  demo?: ChatDemoContext;
  initial?: RestoredChat;
  embedded?: ChatEmbedded;
  /** Класс корня — сцена может задать размер ленты (экран-видеозвонок). */
  className?: string;
}

/**
 * Карьерный консультант. Самостоятельно — страница /consultant; `embedded` — продолжение ленты
 * онбординга (без заголовка страницы, приветствие с подсказками). Лента — примитивы components/chat.
 * Голос и аватар компаньона: на странице — свои; во встроенном режиме — от онбординга (тот же провайдер).
 */
export function Chat(props: ChatProps) {
  // Свой провайдер голоса — только если снаружи его нет (сцены /design/consultant-* держат провайдер сами).
  const outer = useCompanionVoice();
  if (props.embedded || outer) return <ChatBody {...props} />;
  return (
    <CompanionVoiceProvider>
      <ChatBody {...props} />
    </CompanionVoiceProvider>
  );
}

function ChatBody({ demo, initial, embedded, className }: ChatProps) {
  const [items, setItems] = useState<FeedItem[]>(initial?.items ?? []);
  const [overrides, setOverrides] = useState<Record<string, Partial<CardClaim>>>({});
  const [text, setText] = useState('');
  const att = useAttachments();
  useChatDraft(initial?.conversationId, text, setText, att);
  const [busy, setBusy] = useState(false);
  // Чипы под приветствием — после того, как оно допечатано (в онбординге оно печатается).
  const [greetDone, setGreetDone] = useState(!embedded || (initial?.items.length ?? 0) > 0);
  const lastSent = useRef<{ message: string; uploadIds: string[]; urls: string[]; fileNames: string[] } | null>(null);
  const [simplified, setSimplified] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Разговор создаёт сервер на первом ходе (событие conversation); дальше шлём его id.
  const conversationRef = useRef<string | undefined>(initial?.conversationId ?? undefined);
  const endRef = useRef<HTMLDivElement>(null);

  const voice = useCompanionVoice();
  const callMode = useCallMode();
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const rootRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  // Внутри онбординга лентой и автоскроллом управляет OnboardingChat.
  useStickToBottom(feedRef, !embedded, paneRef);
  useEffect(() => () => abortRef.current?.abort(), []);
  const refreshAside = useAsideRefresh();
  const setThinking = voice?.setThinking;
  useEffect(() => {
    setThinking?.(busy);
  }, [busy, setThinking]);
  useEffect(() => {
    if (embedded) scrollToEnd(endRef.current);
  }, [items.length, embedded]);

  // Телеметрия (выключена — одна проверка флага): diff ленты по id, коммиты React за ход.
  const prevItemsRef = useRef(items);
  const reasonRef = useRef<string | undefined>(undefined);
  const rendersRef = useRef(0);
  useEffect(() => {
    if (telemetryOn()) rendersRef.current++;
  });
  useEffect(() => {
    if (telemetryOn()) diffItems(prevItemsRef.current, items, reasonRef.current);
    prevItemsRef.current = items;
  }, [items]);

  const pushEvent = useCallback((event: AgentEvent) => {
    if (event.type === 'conversation') {
      conversationRef.current = event.id;
      return;
    }
    if (event.type === 'done') return;
    reasonRef.current = event.type;
    if (event.type === 'discard') track({ k: 'flake', what: 'discard', id: event.id });
    // Завершённая реплика — авторитетный текст после дельт: её и озвучиваем (если включено).
    if (event.type === 'message') voiceRef.current?.speak(event.text, event.id);
    setItems((p) => applyAgentEvent(p, event, nextId));
    if (event.type === 'error' && SIMPLIFIED_CODES.has(event.code)) setSimplified(true);
  }, []);

  const send = useCallback(
    async (message: string, uploadIds: string[], urls: string[], fileNames: string[]) => {
      setBusy(true);
      lastSent.current = { message, uploadIds, urls, fileNames };
      setItems((p) => [...p, { id: nextId(), role: 'user', text: message, files: fileNames }]);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      // Ход дошёл до `done` без `error` — упрощённый режим снимаем (консультант снова отвечает).
      let sawDone = false;
      let sawError = false;
      rendersRef.current = 0;
      reasonRef.current = 'send';
      turnStart(conversationRef.current);
      const handle = (ev: AgentEvent) => {
        turnEvent(ev.type);
        if (ev.type === 'done') sawDone = true;
        if (ev.type === 'error') sawError = true;
        pushEvent(ev);
      };
      try {
        await embedded?.beforeSend?.();
        const stream = await openConsultantStream({ text: message, uploadIds, urls, conversationId: conversationRef.current }, ctrl.signal);
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser(undefined, telemetryOn() ? { onFrame: trackFrame } : undefined);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const ev of parser.push(decoder.decode(value, { stream: true }))) handle(ev);
        }
        for (const ev of parser.push(decoder.decode())) handle(ev);
        for (const ev of parser.flush()) handle(ev);
        if (sawDone && !sawError) setSimplified(false);
        turnEnd(sawError ? 'error' : 'done', sawDone ? undefined : 'без done', rendersRef.current);
      } catch (e) {
        if ((e as Error).name === 'AbortError') turnEnd('stop', 'abort', rendersRef.current);
        else {
          const code = (e as { code?: string }).code ?? 'network';
          turnEnd('error', code, rendersRef.current);
          pushEvent({ type: 'error', code, message: e instanceof Error ? e.message : 'Что-то пошло не так.' });
        }
      } finally {
        // Обрыв/ошибка посреди дельт: реплику закрываем (каретка гаснет, появляется «Озвучить»).
        setItems((p) => (p.some((it) => it.role === 'agent' && it.streaming) ? p.map((it) => (it.role === 'agent' && it.streaming ? { ...it, streaming: false } : it)) : p));
        if (abortRef.current === ctrl) abortRef.current = null;
        setBusy(false);
        refreshAside();
      }
    },
    [pushEvent, embedded, refreshAside],
  );

  // «Стоп»: сервер останавливает ход и отдаёт показанный кусок (`message` + `done`), затем — обрыв локального fetch.
  const stop = useCallback(async () => {
    const ctrl = abortRef.current;
    const id = conversationRef.current;
    turnEnd('stop', 'кнопка «Стоп»');
    if (id) await stopConsultantTurn(id);
    ctrl?.abort();
  }, []);

  // Файлы и ссылки из правой колонки (FilesCard) — тем же ходом, что вложения композера.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useMaterialsHandler((m) => {
    if (busyRef.current) return 'busy';
    busyRef.current = true;
    void send(materialsMessage(m), m.uploadIds, m.urls, m.names);
    return 'sent';
  });

  async function onSubmit() {
    if (busy) return;
    setFormError(null);
    if (att.uploading) {
      setFormError('Дождись окончания загрузки файлов.');
      return;
    }
    const urls = extractUrls(text);
    const done = att.ready;
    const message = text.trim() || (done.length ? 'Вот мои материалы.' : '');
    if (!message) {
      setFormError('Напиши сообщение или приложи резюме.');
      return;
    }
    setText('');
    att.clear();
    await send(message, done.map((f) => f.id), urls, done.map((f) => f.name));
  }

  async function loadDemoResume() {
    if (!demo?.resume) return;
    const { fileName, link } = demo.resume;
    setFormError(null);
    setText((t) => (t.includes(link) ? t : t ? `${t} ${link}` : link));
    try {
      att.add([await fetchDemoResume(fileName)]);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Не удалось загрузить демо-резюме.');
    }
  }

  const retry = () => {
    const l = lastSent.current;
    if (l && !busy) void send(l.message, l.uploadIds, l.urls, l.fileNames);
  };

  const onClaimAction = useCallback(async (claim: CardClaim, action: ClaimAction, statement?: string) => {
    await claimAction(claim.id, action, statement);
    refreshAside();
    setOverrides((p) => ({
      ...p,
      [claim.id]: {
        status: action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'edited',
        ...(action === 'edit' && statement ? { statement, wording: statement } : {}),
      },
    }));
  }, [refreshAside]);

  const onConfirmAll = useCallback(
    async (claims: CardClaim[]) => {
      const r = await confirmClaimsBatchApi(claims.map((c) => c.id));
      refreshAside();
      const done = new Set(r.confirmed);
      // уже подтверждённые ранее тоже отражаем как подтверждённые
      for (const s of r.skipped) if (s.reason === 'already_confirmed') done.add(s.id);
      setOverrides((p) => {
        const next = { ...p };
        for (const id of done) next[id] = { ...next[id], status: 'confirmed' };
        return next;
      });
      return r.confirmed.length;
    },
    [refreshAside],
  );

  const started = items.some((it) => it.role === 'user');
  const demoChip: QuickReply[] = demo?.resume ? [{ value: 'demo-resume', label: 'Загрузить демо-резюме', note: `${demo.resume.fileName} и ссылка` }] : [];
  const suggestions = [...(embedded?.suggestions ?? []), ...demoChip];
  const greeting = (
    <AssistantRow key="greeting" testId="chat-greeting">
      <Reply lines={[{ text: embedded ? CONTINUE_GREETING : GREETING }]} animate={Boolean(embedded) && items.length === 0} onDone={() => setGreetDone(true)} />
      {suggestions.length > 0 && !started && greetDone && (
        <QuickReplies
          label="Что дальше"
          items={suggestions}
          disabled={busy}
          onPick={(v) => (v === 'demo-resume' ? void loadDemoResume() : embedded?.onSuggestion?.(v))}
        />
      )}
    </AssistantRow>
  );
  // «Печатает» — пока в этом ходе не началась реплика (дальше её видно по стриму).
  const lastUser = items.findLastIndex((it) => it.role === 'user');
  const replying = items.slice(lastUser + 1).some((it) => it.role === 'agent' && it.event.type === 'message');
  const typingShown = busy && !replying;
  useEffect(() => {
    trackVirtual('typing', 'typing', typingShown);
  }, [typingShown]);

  return (
    <div ref={rootRef} className={[embedded ? styles.embedded : styles.chat, className].filter(Boolean).join(' ')}>
      {!embedded && (
        <header className={styles.intro}>
          <div className={styles.title}>
            <h1>Карьерный консультант</h1>
            <span className={styles.subtitle}>Ведёт по платформе</span>
          </div>
          <nav className={styles.routes} aria-label="Следующий шаг">
            <Button href="/profile" size="sm">Профиль</Button>
            <Button href="/test" size="sm">Тест</Button>
          </nav>
          {demo?.noLlm && (
            <p className={styles.demoNote} role="note">
              Демо-режим без языковой модели: ответы собираются по шаблонам из данных платформы, утверждения ищутся по словарю каталога.
            </p>
          )}
        </header>
      )}
      {embedded && demo?.noLlm && (
        <p className={styles.demoNote} role="note">
          Демо-режим без языковой модели: ответы собираются по шаблонам из данных платформы, утверждения ищутся по словарю каталога.
        </p>
      )}

      <div ref={paneRef} className={embedded ? undefined : styles.feedPane} role={embedded ? undefined : 'region'} aria-label={embedded ? undefined : 'История разговора'} tabIndex={embedded ? undefined : 0}>
      <div ref={feedRef} className={embedded ? undefined : styles.feedContent}>
      {simplified && (
        <div className={`${ui.notice} ${styles.simple}`} role="status">
          <strong>Упрощённый режим.</strong>
          <span>
            Консультант сейчас недоступен, но платформа работает: посмотри <Link href="/profile">профиль</Link>, уже подтверждённые
            утверждения не потеряны. Попробуй отправить сообщение ещё раз чуть позже.
          </span>
        </div>
      )}

      <EventFeed
        items={items}
        lead={greeting}
        claimOverrides={overrides}
        onClaimAction={onClaimAction}
        onConfirmAll={onConfirmAll}
        onAnswer={(t) => void send(t, [], [], [])}
        onRetry={retry}
        locked={busy}
      />
      {busy && !replying && (
        <div className={styles.working}>
          <Typing />
        </div>
      )}
      <VisuallyHidden role="status" aria-live="polite">
        {busy ? 'Консультант работает…' : ''}
      </VisuallyHidden>
      <div ref={endRef} className={styles.end} />
      </div>
      </div>

      <Composer
        label="Сообщение"
        value={text}
        onChange={setText}
        onSubmit={() => void onSubmit()}
        placeholder="Напиши, прикрепи резюме или вставь ссылку"
        sending={busy}
        onStop={() => void stop()}
        multiline
        voice
        onCall={callMode ? () => callMode.start() : undefined}
        callKind={callMode?.kind}
        callBlocked={callMode?.readiness?.ready === false ? callMode.readiness.reason : undefined}
        maxLength={8000}
        attachments={{ files: att.files, onAdd: att.add, onRemove: att.remove }}
        hint="Enter - отправить, Shift+Enter - новая строка"
        top={
          <>
            {embedded?.pinned && started && (
              <QuickReplies label="Анкета" items={[embedded.pinned]} disabled={busy} onPick={(v) => embedded.onSuggestion?.(v)} />
            )}
            {formError && (
              <p className={styles.warn} role="alert">
                {formError}
              </p>
            )}
          </>
        }
      />
    </div>
  );
}
