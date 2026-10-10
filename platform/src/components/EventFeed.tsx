'use client';

import Link from 'next/link';
import { type ReactNode, useState } from 'react';

import type { ClaimAction } from '@/lib/api';
import { type CardClaim, normalizeClaim } from '@/lib/claims-view';
import type { AgentEvent } from '@/server/agent/types';

import { ReplayButton } from './avatar/CompanionStage';
import type { AgentItem } from './chat/stream-items';
import { StreamingText } from './chat/StreamingText';
import { AssistantRow, Bubble, QuickReplies, Thread, UserBubble } from './chat/Thread';
import { ClaimCard } from './ClaimCard';
import styles from './EventFeed.module.css';
import { Recommendations } from './Recommendations';
import ui from './ui.module.css';

export type FeedItem =
  | { id: string; role: 'user'; text: string; files?: string[] }
  | ({ role: 'agent' } & AgentItem<AgentEvent>);

export interface EventFeedProps {
  items: FeedItem[];
  /** Актуальные поля утверждений, изменённые действиями (id → поля). */
  claimOverrides?: Record<string, Partial<CardClaim>>;
  onClaimAction?: (claim: CardClaim, action: ClaimAction, statement?: string) => Promise<void>;
  /** Возвращает число подтверждённых (для итога под кнопкой). */
  onConfirmAll?: (claims: CardClaim[]) => Promise<number | void>;
  /** Ответ на `ask` (клик по варианту). */
  onAnswer?: (text: string) => void;
  /** Нельзя отвечать: идёт ход агента. */
  locked?: boolean;
  /** Строки в начале ленты (приветствие помощника). */
  lead?: ReactNode;
  label?: string;
  /** «Повторить» под последней ошибкой (повтор последнего сообщения). */
  onRetry?: () => void;
}

type Block =
  | { kind: 'user'; item: Extract<FeedItem, { role: 'user' }> }
  | { kind: 'steps'; id: string; texts: string[] }
  | { kind: 'event'; id: string; event: AgentEvent; live?: boolean; streaming?: boolean };

/** Подряд идущие `step` склеиваем в один список; `queue` оставляем только последний; `done` не рисуем. */
export function toBlocks(items: FeedItem[]): Block[] {
  const blocks: Block[] = [];
  const lastQueue = (() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]!;
      if (it.role === 'agent' && it.event.type === 'queue') return it.id;
      if (it.role === 'agent' && it.event.type !== 'step') return null;
    }
    return null;
  })();
  for (const it of items) {
    if (it.role === 'user') {
      blocks.push({ kind: 'user', item: it });
      continue;
    }
    const ev = it.event;
    if (ev.type === 'done' || ev.type === 'delta' || ev.type === 'discard') continue;
    if (ev.type === 'queue' && it.id !== lastQueue) continue;
    if (ev.type === 'step') {
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === 'steps') prev.texts.push(ev.text);
      else blocks.push({ kind: 'steps', id: it.id, texts: [ev.text] });
      continue;
    }
    blocks.push({ kind: 'event', id: it.id, event: ev, live: it.live, streaming: it.streaming });
  }
  return blocks;
}

const REASON_TEXT: Record<string, (n: number) => string> = {
  no_quote: (n) => `${n} без цитаты в источнике - отброшено: утверждение без подтверждающей цитаты не предлагается.`,
  unknown_catalog_id: (n) => `${n} вне каталога утверждений - отброшено.`,
  hidden_text: (n) => `${n} из скрытого текста - отброшено.`,
  quote_too_short: (n) => `${n} со слишком короткой цитатой - отброшено.`,
};

/** Плашки по реальным причинам: дубли — не отказ, а слияние повторов. */
export function rejectNotesOf(event: Extract<AgentEvent, { type: 'claims' }>): string[] {
  const by = event.rejectedByReason;
  if (!by) return event.rejected > 0 ? [REASON_TEXT.no_quote!(event.rejected)] : [];
  const out: string[] = [];
  for (const [reason, n] of Object.entries(by)) {
    if (!n || reason === 'duplicate') continue;
    out.push(REASON_TEXT[reason]?.(n) ?? `${n} отброшено (${reason}).`);
  }
  if (by.duplicate) out.push(`Объединено повторов: ${by.duplicate} (одинаковые утверждения из разных источников показаны одной карточкой).`);
  return out;
}

function ClaimsBlock({
  event,
  overrides,
  onAction,
  onConfirmAll,
}: {
  event: Extract<AgentEvent, { type: 'claims' }>;
  overrides: Record<string, Partial<CardClaim>>;
  onAction?: EventFeedProps['onClaimAction'];
  onConfirmAll?: EventFeedProps['onConfirmAll'];
}) {
  const [bulk, setBulk] = useState(false);
  const [bulkDone, setBulkDone] = useState<number | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const claims = event.proposed
    .map(normalizeClaim)
    .filter((c): c is CardClaim => c !== null)
    .map((c) => ({ ...c, ...overrides[c.id] }));
  const open = claims.filter((c) => c.status === 'proposed');
  // «Со слов» — только self_reported: артефакты (код, README) кандидат подтверждает по одному.
  const bulkable = open.filter((c) => c.level === 'self_reported');

  const rejectNotes = rejectNotesOf(event);

  async function confirmAll() {
    if (!onConfirmAll) return;
    setBulk(true);
    setBulkError(null);
    try {
      const n = await onConfirmAll(bulkable);
      if (typeof n === 'number') setBulkDone(n);
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Не удалось подтвердить.');
    } finally {
      setBulk(false);
    }
  }

  return (
    <section className={styles.cards} aria-label="Найденные утверждения">
      <div className={styles.cardsHead}>
        <h3 className={styles.cardsTitle}>
          {claims.length > 0 ? (
            `Нашёл утверждений: ${claims.length}. Это про тебя?`
          ) : event.alreadyKnown ? (
            <>
              Новых утверждений нет: {event.alreadyKnown} уже в твоём профиле. <Link href="/profile">Открыть профиль</Link>
            </>
          ) : (
            'Подтверждённых цитатами утверждений не нашёл.'
          )}
        </h3>
        {bulkable.length > 1 && onConfirmAll && (
          <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => void confirmAll()} disabled={bulk}>
            Подтвердить все со слов ({bulkable.length})
          </button>
        )}
      </div>
      {event.hiddenText ? (
        <p className={ui.notice} role="note">
          В документе найден скрытый текст ({event.hiddenText}) - он проигнорирован и не попал в утверждения.
        </p>
      ) : null}
      {bulkDone !== null && (
        <p className={ui.notice} role="status">
          Подтверждено: {bulkDone}.
        </p>
      )}
      {rejectNotes.map((t) => (
        <p key={t} className={ui.notice} role="note">
          {t}
        </p>
      ))}
      {bulkError && (
        <p className={ui.notice + ' ' + ui.errorBox} role="alert">
          {bulkError}
        </p>
      )}
      {onAction &&
        claims.map((c) => <ClaimCard key={c.id} claim={c} onAction={onAction} busy={bulk} />)}
    </section>
  );
}

function AskBlock({ event, onAnswer, locked }: { event: Extract<AgentEvent, { type: 'ask' }>; onAnswer?: (t: string) => void; locked?: boolean }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <>
      <Bubble>{event.question}</Bubble>
      {event.options && event.options.length > 0 && (
        <QuickReplies
          items={event.options.map((o) => ({ value: o, label: o, pressed: picked === o }))}
          disabled={locked || picked !== null}
          onPick={(o) => {
            setPicked(o);
            onAnswer?.(o);
          }}
        />
      )}
    </>
  );
}

/** Лента консультанта на общих примитивах components/chat (тот же вид, что у онбординга). */
export function EventFeed({ lead, label = 'Переписка с консультантом', ...rest }: EventFeedProps) {
  return (
    <Thread label={label}>
      {lead}
      <FeedRows {...rest} />
    </Thread>
  );
}

/** Строки ленты без обёртки `Thread` — для вставки в чужую ленту (документы в онбординге). */
export function FeedRows({ items, claimOverrides = {}, onClaimAction, onConfirmAll, onAnswer, locked, onRetry }: Omit<EventFeedProps, 'lead' | 'label'>) {
  const blocks = toBlocks(items);
  const lastBlock = blocks.at(-1);
  return (
    <>
      {blocks.map((b) => {
        if (b.kind === 'user') {
          return (
            <UserBubble key={b.item.id} files={b.item.files}>
              {b.item.text}
            </UserBubble>
          );
        }
        if (b.kind === 'steps') {
          return (
            <AssistantRow key={b.id} mark={false}>
              <ul className={styles.steps} aria-live="polite" aria-label="Шаги консультанта">
                {b.texts.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </AssistantRow>
          );
        }
        const ev = b.event;
        const speaks = ev.type === 'message' || ev.type === 'ask';
        return (
          <AssistantRow key={b.id} mark={speaks}>
            {ev.type === 'queue' && (
              <p className={styles.queue} role="status">
                <span className={ui.spinner} aria-hidden="true" />
                {ev.position > 0 ? `Ты в очереди: ${ev.position}-й. Ответ придёт сам.` : 'Запрос обрабатывается.'}
              </p>
            )}
            {ev.type === 'message' && (
              <Bubble>
                <StreamingText text={ev.text} streaming={b.streaming} animate={Boolean(b.live)} />
                {!b.streaming && <ReplayButton text={ev.text} />}
              </Bubble>
            )}
            {ev.type === 'claims' && <ClaimsBlock event={ev} overrides={claimOverrides} onAction={onClaimAction} onConfirmAll={onConfirmAll} />}
            {ev.type === 'ask' && <AskBlock event={ev} onAnswer={onAnswer} locked={locked} />}
            {ev.type === 'recommendations' && <Recommendations items={ev.items} />}
            {ev.type === 'error' && (
              <Bubble tone="error">
                {ev.message}
                {ev.code ? <span className={ui.muted}> ({ev.code})</span> : null}
              </Bubble>
            )}
            {ev.type === 'error' && onRetry && b === lastBlock && (
              <QuickReplies label="Что сделать" items={[{ value: 'retry', label: 'Повторить' }]} disabled={locked} onPick={onRetry} />
            )}
          </AssistantRow>
        );
      })}
    </>
  );
}
