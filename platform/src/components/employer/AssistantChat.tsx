'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { openEmployerAssistantStream } from '@/lib/employer-api';
import { COMPANION_NAME } from '@/lib/persona';
import { createSseParser } from '@/lib/sse';
import type { EmployerAgentEvent, InvitationDraft, NeedDraft } from '@/server/agent/employer/types';
import type { EmployerRestoredChat, EmployerRestoredItem } from '@/server/agent/employer/restore';

import chatStyles from '../Chat.module.css';
import { type AgentItem, applyAgentEvent } from '../chat/stream-items';
import { useAsideRefresh } from '../consultant/aside-refresh';
import { StreamingText } from '../chat/StreamingText';
import { AssistantRow, Bubble, Composer, MessageCard, QuickReplies, type QuickReply, Reply, Thread, Typing, UserBubble } from '../chat/Thread';
import { scrollToEnd, useStickToBottom } from '../chat/scroll';
import { Button, Notice, VisuallyHidden } from '../ui';

import { AssistantCandidateCard } from './AssistantCandidateCard';
import styles from './Employer.module.css';
import { InviteForm } from './InviteForm';
import { GRADE_LABEL, SPEC_LABEL } from './labels';

type Item = { id: string; role: 'user'; text: string } | AgentItem<EmployerAgentEvent>;

const GREETING =
  `Я ${COMPANION_NAME}, помощница работодателя. От тебя нужно немного: описать вакансию - направление, грейд, стек и вилку зарплаты. По ней я подберу кандидатов и объясню, почему каждый на своём месте; подходящему ты отправишь приглашение с зарплатой, а кандидат сам решит, открыть ли контакты. Отправляешь и сохраняешь ты - кнопками.`;
const CONTINUE_GREETING = 'Дальше я - твоя помощница по подбору. Опиши вакансию (направление, грейд, стек, вилка зарплаты) - подберу кандидатов и подготовлю приглашение. Или выбери шаг ниже.';

export const EMPLOYER_SUGGESTIONS: QuickReply[] = [
  { value: 'Подбери под мою потребность', label: 'Подбери под вакансию' },
  { value: 'Найди по базе Frontend с ФСП', label: 'Найти по базе' },
  { value: 'Создай потребность: нужен Backend Middle на Go и Kafka, 200–260 тыс', label: 'Описать вакансию словами' },
];

export interface AssistantEmbedded {
  /** Подсказки под приветствием до первого сообщения (онбординг: «Открыть подборку» и т. п.). */
  suggestions?: QuickReply[];
  onSuggestion?: (value: string) => boolean | void;
  beforeSend?: () => Promise<void>;
}

/** Типы событий потока помощника (server/agent/employer/types.ts) — остальное парсер отбрасывает. */
const EMPLOYER_EVENT_TYPES: ReadonlySet<EmployerAgentEvent['type']> = new Set([
  'conversation', 'step', 'queue', 'ask', 'candidates', 'invitation_draft', 'need_draft', 'message', 'delta', 'discard', 'error', 'done',
] as const);

let seq = 0;
const nextId = () => `e${++seq}`;

/**
 * Помощник работодателя (решение владельца 09.10): лента на примитивах components/chat.
 * Самостоятельно — страница /employer/assistant; `embedded` — продолжение онбординга
 * работодателя. Карточки кандидатов — компактные, с кнопкой «Пригласить»: отправляет человек.
 */
export function AssistantChat({ initial, embedded, demoNoLlm }: { initial?: EmployerRestoredChat; embedded?: AssistantEmbedded; demoNoLlm?: boolean }) {
  const refreshAside = useAsideRefresh();
  const [items, setItems] = useState<Item[]>(initial?.items ?? []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const lastSent = useRef<string | null>(null);
  const [greetDone, setGreetDone] = useState(!embedded || (initial?.items.length ?? 0) > 0);
  const conversationRef = useRef<string | undefined>(initial?.conversationId ?? undefined);
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useStickToBottom(rootRef, !embedded);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    scrollToEnd(endRef.current);
  }, [items.length]);

  const push = useCallback((event: EmployerAgentEvent) => {
    if (event.type === 'conversation') {
      conversationRef.current = event.id;
      return;
    }
    if (event.type === 'done') return;
    setItems((p) => applyAgentEvent(p, event, nextId));
  }, []);

  const send = useCallback(
    async (message: string) => {
      const msg = message.trim();
      if (!msg || busy) return;
      setBusy(true);
      lastSent.current = msg;
      setItems((p) => [...p, { id: nextId(), role: 'user', text: msg }]);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        await embedded?.beforeSend?.();
        const stream = await openEmployerAssistantStream({ text: msg, conversationId: conversationRef.current }, ctrl.signal);
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser<EmployerAgentEvent>(EMPLOYER_EVENT_TYPES);
        const emit = (evs: EmployerAgentEvent[]) => evs.forEach(push);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          emit(parser.push(decoder.decode(value, { stream: true })));
        }
        emit(parser.push(decoder.decode()));
        emit(parser.flush());
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          push({ type: 'error', code: (e as { code?: string }).code ?? 'network', message: e instanceof Error ? e.message : 'Что-то пошло не так.' });
        }
      } finally {
        setBusy(false);
        refreshAside();
      }
    },
    [busy, embedded, push, refreshAside],
  );

  const started = items.some((it) => it.role === 'user');
  const suggestions = embedded?.suggestions ?? EMPLOYER_SUGGESTIONS;
  const lastUser = items.findLastIndex((it) => it.role === 'user');
  const replying = items.slice(lastUser + 1).some((it) => it.role === 'agent' && it.event.type === 'message');
  const lastItem = items.at(-1);
  const failed = !busy && lastItem?.role === 'agent' && lastItem.event.type === 'error' && lastSent.current !== null;
  const lastAsk = (() => {
    const last = items.at(-1);
    return last?.role === 'agent' && last.event.type === 'ask' ? last.event : null;
  })();

  return (
    <div ref={rootRef} className={embedded ? chatStyles.embedded : chatStyles.chat}>
      {!embedded && (
        <header className={chatStyles.intro}>
          <h1>Помощник по подбору</h1>
        </header>
      )}
      {demoNoLlm && (
        <p className={chatStyles.demoNote} role="note">
          Демо-режим без языковой модели: помощник выбирает действие по ключевым словам, подборка и карточки - настоящие данные платформы.
        </p>
      )}
      <Thread label="Переписка с помощником работодателя">
        <AssistantRow testId="assistant-greeting">
          <Reply lines={[{ text: embedded ? CONTINUE_GREETING : GREETING }]} animate={Boolean(embedded) && items.length === 0} onDone={() => setGreetDone(true)} />
          {!started && greetDone && (
            <QuickReplies
              label="С чего начать"
              items={suggestions}
              disabled={busy}
              onPick={(v) => {
                if (embedded?.onSuggestion?.(v)) return;
                void send(v);
              }}
            />
          )}
        </AssistantRow>
        {items.map((it) => (it.role === 'user' ? <UserBubble key={it.id}>{it.text}</UserBubble> : <EventRow key={it.id} item={it} />))}
        {busy && !replying && (
          <AssistantRow>
            <Typing />
          </AssistantRow>
        )}
        {failed && (
          <AssistantRow mark={false}>
            <QuickReplies label="Что сделать" items={[{ value: 'retry', label: 'Повторить' }]} onPick={() => void send(lastSent.current ?? '')} />
          </AssistantRow>
        )}
        {lastAsk?.options && !busy && (
          <AssistantRow mark={false}>
            <QuickReplies items={lastAsk.options.map((o) => ({ value: o, label: o }))} onPick={(v) => void send(v)} />
          </AssistantRow>
        )}
      </Thread>
      <VisuallyHidden role="status" aria-live="polite">
        {busy ? 'Помощник работает…' : ''}
      </VisuallyHidden>
      <div ref={endRef} className={chatStyles.end} />
      <Composer
        label="Сообщение помощнику"
        value={text}
        onChange={setText}
        onSubmit={() => {
          const v = text;
          setText('');
          void send(v);
        }}
        placeholder="Подбери под мою вакансию Backend Middle"
        sending={busy}
        voice
        multiline
        maxLength={4000}
        hint="Enter - отправить, Shift+Enter - новая строка"
      />
    </div>
  );
}

/**
 * Реплики помощника из паузы знакомства под своим шагом ленты онбординга (решение владельца 10.10):
 * вопрос работодателя и ответ помощника (текст, карточки) - только чтение, без стрима.
 */
export function EmployerAsideRows({ items }: { items: EmployerRestoredItem[] | undefined }) {
  if (!items?.length) return null;
  return (
    <>
      {items.map((it) => (it.role === 'user' ? <UserBubble key={it.id}>{it.text}</UserBubble> : <EventRow key={it.id} item={it} />))}
    </>
  );
}

function EventRow({ item }: { item: AgentItem<EmployerAgentEvent> }) {
  const event = item.event;
  switch (event.type) {
    case 'message':
      return (
        <AssistantRow>
          <Bubble>
            <StreamingText text={event.text} streaming={item.streaming} animate={Boolean(item.live)} />
          </Bubble>
        </AssistantRow>
      );
    case 'step':
      return (
        <AssistantRow mark={false}>
          <Reply lines={[{ text: event.text, secondary: true }]} />
        </AssistantRow>
      );
    case 'queue':
      return (
        <AssistantRow mark={false}>
          <Reply lines={[{ text: `В очереди к модели: ${event.position}`, secondary: true }]} />
        </AssistantRow>
      );
    case 'ask':
      return (
        <AssistantRow>
          <Reply lines={[{ text: event.question }]} />
        </AssistantRow>
      );
    case 'error':
      return (
        <AssistantRow mark={false}>
          <Bubble tone="error">{event.message}</Bubble>
        </AssistantRow>
      );
    case 'candidates': {
      const b = event.block;
      return (
        <AssistantRow mark={false} testId="assistant-candidates">
          <MessageCard label={b.vacancy ? `Подборка: ${b.vacancy.title}` : 'Поиск по базе'}>
            <p className={styles.meta}>
              {b.vacancy ? `Подборка «${b.vacancy.title}»` : 'Поиск по базе'}: показано {b.items.length} из {b.total}.{' '}
              {b.vacancy && <a href={`/employer/needs/${encodeURIComponent(b.vacancy.id)}`}>Вся подборка</a>}
            </p>
            {b.items.length > 0 && (
              <ul className={styles.list}>
                {b.items.map((c) => (
                  <AssistantCandidateCard key={c.candidateId} c={c} vacancyId={b.vacancy?.id ?? null} defaultSalary={b.vacancy ? { from: b.vacancy.salaryFrom, to: b.vacancy.salaryTo } : undefined} />
                ))}
              </ul>
            )}
          </MessageCard>
        </AssistantRow>
      );
    }
    case 'invitation_draft':
      return <InvitationDraftRow draft={event.draft} />;
    case 'need_draft':
      return <NeedDraftRow draft={event.draft} />;
    default:
      return null;
  }
}

function InvitationDraftRow({ draft }: { draft: InvitationDraft }) {
  return (
    <AssistantRow mark={false} testId="assistant-invitation-draft">
      <MessageCard label={`Черновик приглашения: ${draft.alias}`}>
        <p className={styles.meta}>
          Черновик для {draft.alias}
          {draft.vacancyTitle ? ` · «${draft.vacancyTitle}»` : ''} · осталось {draft.limit.left} из {draft.limit.limit} на сутки
        </p>
        {draft.blocked ? (
          <Notice>{draft.blocked === 'daily_limit' ? 'Лимит приглашений на сутки исчерпан.' : 'Кандидат ещё не ответил на прошлое приглашение компании.'}</Notice>
        ) : (
          <InviteForm
            candidateId={draft.candidateId}
            candidateName={draft.alias}
            vacancyId={draft.vacancyId}
            defaultSalaryFrom={draft.salaryFrom ?? undefined}
            defaultSalaryTo={draft.salaryTo ?? undefined}
            initialMessage={draft.message}
            defaultOpen
          />
        )}
      </MessageCard>
    </AssistantRow>
  );
}

function NeedDraftRow({ draft }: { draft: NeedDraft }) {
  return (
    <AssistantRow mark={false} testId="assistant-need-draft">
      <MessageCard label={`Черновик вакансии: ${draft.title}`}>
        <h3 className={styles.sectionTitle}>{draft.title}</h3>
        <p className={styles.meta}>
          {SPEC_LABEL[draft.specialization]} · {GRADE_LABEL[draft.grade]}
          {draft.stack.length > 0 && ` · ${draft.stack.join(', ')}`}
          {draft.salaryFrom ? ` · от ${draft.salaryFrom.toLocaleString('ru-RU')} ₽` : ''}
        </p>
        <ul className={styles.why} aria-label="Требования из каталога">
          {draft.needs.map((n) => (
            <li key={n.catalogId}>{n.statement}</li>
          ))}
        </ul>
        <div className={styles.actions}>
          <Button variant="cta" size="sm" href={draft.formHref}>
            Открыть форму и сохранить
          </Button>
        </div>
      </MessageCard>
    </AssistantRow>
  );
}
