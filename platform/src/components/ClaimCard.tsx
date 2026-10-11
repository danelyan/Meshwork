'use client';

import { useId, useState } from 'react';
import { stripLimitsPrefix } from '@/lib/plural';

import { shownWording, type CardClaim } from '@/lib/claims-view';
import type { ClaimAction } from '@/lib/api';

import styles from './ClaimCard.module.css';
import { LevelBadge } from './LevelBadge';
import ui from './ui.module.css';

export interface ClaimCardProps {
  claim: CardClaim;
  /** Выполняет действие на сервере и обновляет claim у родителя; бросает ошибку с понятным текстом. */
  onAction: (claim: CardClaim, action: ClaimAction, statement?: string) => Promise<void>;
  /** Блокировка снаружи (например, идёт «подтвердить все»). */
  busy?: boolean;
}

/** Формулировка из цитаты совпадает с ней — цитату второй раз не повторяем. */
function norm(s: string): string {
  return s.toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const STATE_TEXT = { confirmed: 'Подтверждено', edited: 'Исправлено и подтверждено', rejected: 'Отклонено' } as const;

export function ClaimCard({ claim, onAction, busy = false }: ClaimCardProps) {
  const { status } = claim;
  // Крупно — формулировка под цитату (в роде кандидата); каталожная — мелко, как тема созвона.
  const statement = shownWording(claim);
  const catalogNote = claim.wording && claim.statement !== statement && status !== 'edited' ? claim.statement : '';
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
      await onAction(claim, action, text);
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
        {catalogNote && (
          <span className={styles.catalog}>
            <b>Проверим на созвоне:</b> {catalogNote}
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
          <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => { setDraft(statement); setEditing(true); }} disabled={disabled}>
            Поправить
          </button>
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
