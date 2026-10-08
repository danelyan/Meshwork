'use client';

import { useState } from 'react';

import type { ClaimAction } from '@/lib/api';
import { type CardClaim, normalizeClaim } from '@/lib/claims-view';
import type { AgentEvent } from '@/server/agent/types';

import { ClaimCard } from './ClaimCard';
import styles from './EventFeed.module.css';
import { Recommendations } from './Recommendations';
import ui from './ui.module.css';

export type FeedItem =
  | { id: string; role: 'user'; text: string; files?: string[] }
  | { id: string; role: 'agent'; event: AgentEvent };

export interface EventFeedProps {
  items: FeedItem[];
  /** Актуальные поля утверждений, изменённые действиями (id → поля). */
  claimOverrides?: Record<string, Partial<CardClaim>>;
  onClaimAction?: (claim: CardClaim, action: ClaimAction, statement?: string) => Promise<void>;
  onConfirmAll?: (claims: CardClaim[]) => Promise<void>;
  /** Ответ на `ask` (клик по варианту). */
  onAnswer?: (text: string) => void;
  /** Нельзя отвечать: идёт ход агента. */
  locked?: boolean;
}

type Block =
  | { kind: 'user'; item: Extract<FeedItem, { role: 'user' }> }
  | { kind: 'steps'; id: string; texts: string[] }
  | { kind: 'event'; id: string; event: AgentEvent };

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
    if (ev.type === 'done') continue;
    if (ev.type === 'queue' && it.id !== lastQueue) continue;
    if (ev.type === 'step') {
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === 'steps') prev.texts.push(ev.text);
      else blocks.push({ kind: 'steps', id: it.id, texts: [ev.text] });
      continue;
    }
    blocks.push({ kind: 'event', id: it.id, event: ev });
  }
  return blocks;
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
  const [bulkError, setBulkError] = useState<string | null>(null);
  const claims = event.proposed
    .map(normalizeClaim)
    .filter((c): c is CardClaim => c !== null)
    .map((c) => ({ ...c, ...overrides[c.id] }));
  const open = claims.filter((c) => c.status === 'proposed');

  async function confirmAll() {
    if (!onConfirmAll) return;
    setBulk(true);
    setBulkError(null);
    try {
      await onConfirmAll(open);
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
          {claims.length > 0 ? `Нашёл утверждений: ${claims.length}. Это про вас?` : 'Подтверждённых цитатами утверждений не нашёл.'}
        </h3>
        {open.length > 1 && onConfirmAll && (
          <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => void confirmAll()} disabled={bulk}>
            Подтвердить все со слов ({open.length})
          </button>
        )}
      </div>
      {event.hiddenText ? (
        <p className={ui.notice} role="note">
          В документе найден скрытый текст ({event.hiddenText}) — он проигнорирован и не попал в утверждения.
        </p>
      ) : null}
      {event.rejected > 0 && (
        <p className={ui.notice} role="note">
          {event.rejected} без цитаты в источнике — отброшено: утверждение без подтверждающей цитаты не предлагается.
        </p>
      )}
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
    <section className={`${ui.panel} ${styles.ask}`} aria-label="Вопрос консультанта">
      <p className={styles.askQ}>{event.question}</p>
      {event.options && event.options.length > 0 && (
        <div className={styles.options} role="group" aria-label="Варианты ответа">
          {event.options.map((o) => (
            <button
              key={o}
              type="button"
              className={`${ui.btn} ${ui.small} ${picked === o ? ui.primary : ''}`}
              disabled={locked || picked !== null}
              aria-pressed={picked === o}
              onClick={() => {
                setPicked(o);
                onAnswer?.(o);
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function EventFeed({ items, claimOverrides = {}, onClaimAction, onConfirmAll, onAnswer, locked }: EventFeedProps) {
  const blocks = toBlocks(items);
  return (
    <ol className={styles.feed} aria-label="Переписка с консультантом">
      {blocks.map((b) => {
        if (b.kind === 'user') {
          return (
            <li key={b.item.id} className={styles.row}>
              <div className={styles.user}>
                {b.item.text}
                {b.item.files && b.item.files.length > 0 && (
                  <ul className={styles.files} aria-label="Приложенные файлы">
                    {b.item.files.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        }
        if (b.kind === 'steps') {
          return (
            <li key={b.id} className={styles.row}>
              <ul className={styles.steps} aria-live="polite" aria-label="Шаги консультанта">
                {b.texts.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </li>
          );
        }
        const ev = b.event;
        return (
          <li key={b.id} className={styles.row}>
            {ev.type === 'queue' && (
              <p className={styles.queue} role="status">
                <span className={ui.spinner} aria-hidden="true" />
                {ev.position > 0 ? `Вы в очереди: ${ev.position}-й. Ответ придёт сам.` : 'Запрос обрабатывается.'}
              </p>
            )}
            {ev.type === 'message' && <div className={styles.agent}>{ev.text}</div>}
            {ev.type === 'claims' && <ClaimsBlock event={ev} overrides={claimOverrides} onAction={onClaimAction} onConfirmAll={onConfirmAll} />}
            {ev.type === 'ask' && <AskBlock event={ev} onAnswer={onAnswer} locked={locked} />}
            {ev.type === 'recommendations' && <Recommendations items={ev.items} />}
            {ev.type === 'error' && (
              <p className={`${ui.notice} ${ui.errorBox}`} role="alert">
                {ev.message}
                {ev.code ? <span className={ui.muted}> ({ev.code})</span> : null}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
