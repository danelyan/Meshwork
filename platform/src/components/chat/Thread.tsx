'use client';

import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react';

import { Button, Chip, Skeleton, VisuallyHidden, cx } from '../ui';

import { useTypewriter } from './motion';
import styles from './thread.module.css';

/**
 * Примитивы ленты помощника ФСП Карьеры: одна визуальная сущность для онбординга и консультанта
 * (docs/design-system.md, «Лента чата»). Помощник — знак ФСП без имени; пользователь — синий пузырь справа.
 */

export function Thread({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <ol className={cx(styles.thread, className)} aria-label={label}>
      {children}
    </ol>
  );
}

/** Знак помощника (логотип ФСП из шапки). Декоративный: смысл — в тексте реплики. */
export function AssistantMark() {
  return (
    <span className={styles.mark} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/fsp-mark.svg" alt="" />
    </span>
  );
}

/**
 * Строка помощника. `bare` — содержимое без пузыря (карточки, шаги разбора) в той же колонке;
 * `mark = false` — без знака (продолжение предыдущей реплики).
 */
export function AssistantRow({ children, mark = true, testId }: { children: ReactNode; mark?: boolean; testId?: string }) {
  return (
    <li className={styles.assistant} data-testid={testId}>
      {mark ? <AssistantMark /> : <span className={styles.markGap} aria-hidden="true" />}
      <div className={styles.body}>{children}</div>
    </li>
  );
}

/** Пузырь помощника со статичным текстом. */
export function Bubble({ children, tone, onClick }: { children: ReactNode; tone?: 'error'; onClick?: () => void }) {
  return (
    <div className={cx(styles.bubble, tone === 'error' && styles.bubbleError)} onClick={onClick} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </div>
  );
}

/** Карточка внутри сообщения (загрузка документов, ползунки, сводка). */
export function MessageCard({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <section className={styles.card} aria-label={label}>
      {children}
    </section>
  );
}

export interface ReplyLine {
  text: string;
  id?: string;
  /** Второстепенная строка (пояснение): серым, мельче. */
  secondary?: boolean;
}

/**
 * Реплика помощника с появлением: «печатает» 400–700 мс → посимвольно (короткие) → целиком.
 * Тап по реплике показывает её сразу; prefers-reduced-motion — без анимации.
 * `extra` (детали в пузыре) и `onDone` — только когда текст показан целиком.
 */
export function Reply({
  lines,
  animate = false,
  onDone,
  extra,
}: {
  lines: ReplyLine[];
  animate?: boolean;
  onDone?: () => void;
  extra?: ReactNode;
}) {
  const visible = lines.filter((l) => l.text);
  const total = visible.reduce((n, l) => n + l.text.length, 0);
  const { phase, shown, finish } = useTypewriter(total, animate);
  const doneCb = useRef(onDone);
  doneCb.current = onDone;
  useEffect(() => {
    if (phase === 'done') doneCb.current?.();
  }, [phase]);

  if (phase === 'typing') return <Typing onClick={finish} />;

  let left = shown;
  const writing = phase === 'writing';
  return (
    <Bubble onClick={writing ? finish : undefined}>
      {writing && <VisuallyHidden>{visible.map((l) => l.text).join(' ')}</VisuallyHidden>}
      {visible.map((l, i) => {
        const part = l.text.slice(0, Math.max(0, left));
        left -= l.text.length;
        if (writing && !part) return null;
        const last = writing && left <= 0 && part.length > 0 && left > -l.text.length;
        return (
          <p key={i} id={l.id} className={cx(l.secondary && styles.secondary, last && styles.caret)} aria-hidden={writing || undefined}>
            {part}
          </p>
        );
      })}
      {phase === 'done' && extra}
    </Bubble>
  );
}

/** «Помощник печатает»: три точки; для скринридера — текст. */
export function Typing({ onClick }: { onClick?: () => void }) {
  return (
    <div className={styles.typing} role="status" onClick={onClick} data-testid="typing">
      <i />
      <i />
      <i />
      <VisuallyHidden>Помощник печатает…</VisuallyHidden>
    </div>
  );
}

/**
 * Ожидание ответа сервера: на месте будущей реплики — пузырь-скелет из двух строк.
 * Дальше приходит настоящая реплика (`Reply`: «печатает…» → текст).
 */
export function ReplySkeleton({ label = 'Помощник готовит ответ…' }: { label?: string }) {
  return (
    <div className={styles.skeletonBubble} role="status" data-testid="reply-skeleton">
      <Skeleton width="80%" />
      <Skeleton width="55%" />
      <VisuallyHidden>{label}</VisuallyHidden>
    </div>
  );
}

/** Скелет карточки в сообщении (документы, сводка, карточки кандидатов). */
export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className={styles.skeletonCard} aria-hidden="true" data-testid="card-skeleton">
      <Skeleton width="40%" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={`${90 - i * 15}%`} />
      ))}
    </div>
  );
}

/** Первая загрузка ленты (loading.tsx): знак помощника и два пузыря-скелета. */
export function ThreadSkeleton() {
  return (
    <div className={styles.threadSkeleton} aria-busy="true" role="status">
      <VisuallyHidden>Загружаю переписку…</VisuallyHidden>
      <div className={styles.assistant}>
        <Skeleton shape="circle" />
        <div className={styles.body}>
          <div className={styles.skeletonBubble} aria-hidden="true">
            <Skeleton width="85%" />
            <Skeleton width="60%" />
          </div>
          <div className={styles.skeletonBubble} aria-hidden="true">
            <Skeleton width="70%" />
            <Skeleton width="40%" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Ответ пользователя справа. `quiet` — пропуск («пропущу»); `action` — «изменить». */
export function UserBubble({
  children,
  quiet,
  action,
  files,
}: {
  children: ReactNode;
  quiet?: boolean;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  files?: string[];
}) {
  return (
    <li className={styles.user}>
      <div className={styles.userBubble} data-quiet={quiet ? 'true' : undefined}>
        {children}
        {files && files.length > 0 && (
          <ul className={styles.files} aria-label="Приложенные файлы">
            {files.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </div>
      {action && (
        <button type="button" className={styles.userAction} onClick={action.onClick} disabled={action.disabled}>
          {action.label}
        </button>
      )}
    </li>
  );
}

export interface QuickReply {
  value: string;
  label: string;
  note?: string;
  disabled?: boolean;
  pressed?: boolean;
}

/** Быстрые ответы — чипы под последней репликой. */
export function QuickReplies({
  items,
  onPick,
  disabled,
  label = 'Варианты ответа',
  after,
}: {
  items: QuickReply[];
  onPick: (value: string) => void;
  disabled?: boolean;
  label?: string;
  after?: ReactNode;
}) {
  return (
    <div className={styles.replies} role="group" aria-label={label} data-testid="quick-replies">
      {items.map((o, i) => (
        <Chip key={o.value} style={{ '--i': Math.min(i, 12) } as React.CSSProperties} className={cx(styles.chipIn, o.note && styles.chipNote)} pressed={Boolean(o.pressed)} disabled={disabled || o.disabled} onClick={() => onPick(o.value)}>
          {o.label}
          {o.note && <small>{o.note}</small>}
        </Chip>
      ))}
      {after}
    </div>
  );
}

/** Тихое «Готово» для мультивыбора и карточек. */
export function DoneLink({ children = 'Готово', disabled, onClick }: { children?: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.done} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * Поле ввода внизу ленты: Enter отправляет (Shift+Enter — перенос в многострочном),
 * `aside` — тихие ссылки слева под полем («Пропустить»), `hint` — справа.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  label,
  placeholder,
  disabled,
  multiline,
  maxLength,
  inputMode,
  sendLabel = 'Отправить',
  aside,
  hint,
  top,
  inputRef,
  allowEmpty,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  multiline?: boolean;
  maxLength?: number;
  inputMode?: 'numeric' | 'text';
  sendLabel?: string;
  aside?: ReactNode;
  hint?: ReactNode;
  /** Над полем: вложения, ошибки. */
  top?: ReactNode;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  /** Кнопка активна и при пустом поле (у консультанта можно отправить одни вложения). */
  allowEmpty?: boolean;
}) {
  const id = useId();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!disabled) onSubmit();
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (multiline && e.shiftKey) return;
    e.preventDefault();
    if (!disabled) onSubmit();
  }
  return (
    <form className={styles.composer} onSubmit={submit} aria-label="Новое сообщение" data-testid="composer">
      {top}
      <div className={styles.composerRow}>
        <VisuallyHidden>
          <label htmlFor={id}>{label}</label>
        </VisuallyHidden>
        <textarea
          id={id}
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          rows={multiline ? 2 : 1}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          inputMode={inputMode}
          autoComplete="off"
        />
        <Button type="submit" variant="cta" disabled={disabled || (!allowEmpty && !value.trim())}>
          {sendLabel}
        </Button>
      </div>
      {(aside || hint) && (
        <div className={styles.composerMeta}>
          <span>{aside}</span>
          {hint && <span className={styles.composerHint}>{hint}</span>}
        </div>
      )}
    </form>
  );
}

/** Тихая ссылка-действие рядом с полем ввода («Пропустить»). */
export function QuietAction({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={styles.quiet} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** Тонкая полоса прогресса без цифр (число — для скринридера). */
export function ProgressLine({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.round((Math.min(value, max) / max) * 100) : 0;
  return (
    <div className={styles.progress} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
