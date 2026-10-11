'use client';

import { useId, useState } from 'react';
import { stripLimitsPrefix } from '@/lib/plural';

import { claimTopics, normText } from '@/lib/claim-topics';
import { shownWording, type CardClaim } from '@/lib/claims-view';
import type { ClaimAction } from '@/lib/api';

import styles from './ClaimCard.module.css';
import { LevelBadge } from './LevelBadge';
import ui from './ui.module.css';

export interface ClaimCardProps {
  claim: CardClaim;
  /**
   * Склеенная карточка: все утверждения группы с одной цитатой и статусом (claim — первое).
   * «Да/Нет» применяются ко всем; «Поправить» скрыто (одна формулировка не заменит несколько).
   */
  group?: CardClaim[];
  /** Выполняет действие на сервере и обновляет claim у родителя; бросает ошибку с понятным текстом. */
  onAction: (claim: CardClaim, action: ClaimAction, statement?: string) => Promise<void>;
  /** Блокировка снаружи (например, идёт «подтвердить все»). */
  busy?: boolean;
}

const norm = normText;

const STATE_TEXT = { confirmed: 'Подтверждено', edited: 'Исправлено и подтверждено', rejected: 'Отклонено' } as const;

export function ClaimCard({ claim, group, onAction, busy = false }: ClaimCardProps) {
  const { status } = claim;
  // Крупно — формулировка под цитату (в роде кандидата); каталожная — мелко, как тема созвона.
  const statement = shownWording(claim);
  const all = group && group.length > 1 ? group : [claim];
  const merged = all.length > 1;
  // Темы созвона: каталожные утверждения без глагола в роде; у исправленных вручную — не показываем.
  const topics = status === 'edited' ? '' : claimTopics(all.filter((c) => c.wording && c.statement !== shownWording(c)).map((c) => ({ statement: c.statement, quote: claim.quote })));
  const sameAsQuote = norm(statement) === norm(claim.quote);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(statement);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editId = useId();

  async function run(action: ClaimAction, text?: string) {
    setPending(true);
    setError(null);
    try {
      // По одному, последовательно: при сбое уже применённые обновят статус у родителя, остальные останутся открытыми.
      for (const c of all) await onAction(c, action, text);
      if (action === 'edit') setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось выполнить действие.');
    } finally {
      setPending(false);
    }
  }

  const disabled = pending || busy;
  const done = status !== 'proposed';

  return (
    <article className={`${ui.panel} ${styles.card} ${status === 'rejected' ? styles.rejected : ''}`} data-status={status} aria-label={`Утверждение: ${statement}`}>
      <div className={styles.head}>
        <p className={styles.statement}>{statement}</p>
        <LevelBadge level={claim.level} />
      </div>
      {claim.quote && !sameAsQuote && (
        <blockquote className={styles.quote}>
          «{claim.quote}»
        </blockquote>
      )}
      <div className={styles.meta}>
        {sameAsQuote && <span>Дословно из вашего документа</span>}
        {claim.sourceRef && <span>Источник: {claim.sourceRef}</span>}
        {topics && (
          <span className={styles.catalog}>
            <b>На созвоне спросим про:</b> {topics}
          </span>
        )}
        {claim.limits && (
          <span className={styles.limits}>
            <b>Не доказывает:</b> {stripLimitsPrefix(claim.limits)}
          </span>
        )}
      </div>

      {editing && (
        <form
          className={styles.editor}
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) void run('edit', draft.trim());
          }}
        >
          <label htmlFor={editId} className={ui.label}>
            Поправьте формулировку
          </label>
          <textarea id={editId} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} />
          <div className={styles.actions}>
            <button type="submit" className={`${ui.btn} ${ui.primary} ${ui.small}`} disabled={disabled || !draft.trim()}>
              Сохранить
            </button>
            <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => setEditing(false)} disabled={disabled}>
              Отмена
            </button>
          </div>
        </form>
      )}

      {!done && !editing && (
        <div className={styles.actions} role="group" aria-label="Это про вас?">
          <button type="button" className={`${ui.btn} ${ui.primary} ${ui.small}`} onClick={() => void run('confirm')} disabled={disabled}>
            Да
          </button>
          {!merged && (
            <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => { setDraft(statement); setEditing(true); }} disabled={disabled}>
              Поправить
            </button>
          )}
          <button type="button" className={`${ui.btn} ${ui.danger} ${ui.small}`} onClick={() => void run('reject')} disabled={disabled}>
            Нет
          </button>
        </div>
      )}
      {done && (
        <p className={styles.state} role="status">
          {STATE_TEXT[status as keyof typeof STATE_TEXT]}
        </p>
      )}
      {error && (
        <p className={styles.err} role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
