'use client';

import { type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode, type Ref, useEffect, useId, useRef, useState } from 'react';

import { Spinner, VisuallyHidden, cx } from '../ui';

import { AttachmentChip, AttachmentLimitsHint } from './AttachmentChip';
import { ATTACH_ACCEPT, ATTACH_LIMITS, type Attachment } from './attachments';
import styles from './thread.module.css';
import { VoiceButton } from './VoiceButton';

export interface ComposerAttachments {
  files: Attachment[];
  onAdd: (files: File[]) => void;
  onRemove: (key: string) => void;
}

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  label: string;
  placeholder?: string;
  /** Поле недоступно (идёт ход агента, выбор чипом). */
  disabled?: boolean;
  /** Сообщение отправляется: кнопка показывает спиннер, не меняя размера. */
  sending?: boolean;
  multiline?: boolean;
  maxLength?: number;
  inputMode?: 'numeric' | 'text';
  sendLabel?: string;
  aside?: ReactNode;
  hint?: ReactNode;
  /** Над полем: ошибки, пояснения. */
  top?: ReactNode;
  inputRef?: Ref<HTMLTextAreaElement>;
  /** Кнопка активна и при пустом поле (можно отправить одни вложения). */
  allowEmpty?: boolean;
  /** Вложения: скрепка, чипы, drag-n-drop на всю ленту, вставка файла. */
  attachments?: ComposerAttachments;
  /** Кнопка микрофона: надиктовать текст в поле (VoiceButton; режим — GET /api/stt). */
  voice?: boolean;
  /** Кнопка «Созвониться» (lane call): открыть режим звонка в сцене. Нет — кнопки нет. */
  onCall?: () => void;
}

/**
 * Единый композер ленты (онбординг, консультант, помощник работодателя): текст (Enter —
 * отправить, Shift+Enter — перенос), скрепка и чипы вложений, drag-n-drop файла на всю
 * ленту с подсветкой «брось сюда», вставка файла из буфера; ссылки пишутся прямо в тексте.
 * Поле растёт по содержимому до 180 px. docs/design-system.md, «Композер».
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  label,
  placeholder,
  disabled,
  sending,
  multiline,
  maxLength,
  inputMode,
  sendLabel = 'Отправить',
  aside,
  hint,
  top,
  inputRef,
  allowEmpty,
  attachments,
  voice,
  onCall,
}: ComposerProps) {
  const id = useId();
  const limitsId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const dragging = useWindowFileDrop(attachments && !disabled ? attachments.onAdd : undefined);
  const files = attachments?.files ?? [];
  const hasFiles = files.some((f) => f.status !== 'error');
  const blocked = disabled || sending;
  const canSend = !blocked && (allowEmpty || hasFiles || value.trim().length > 0);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Пустое поле — одна строка: длинный плейсхолдер на узком экране не раздувает высоту.
    if (value) el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (canSend) onSubmit();
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (multiline && e.shiftKey) return;
    e.preventDefault();
    if (canSend) onSubmit();
  }
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (!attachments || disabled) return;
    const pasted = Array.from(e.clipboardData?.files ?? []);
    if (!pasted.length) return;
    e.preventDefault();
    attachments.onAdd(pasted);
  }
  const setArea = (el: HTMLTextAreaElement | null) => {
    areaRef.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef) (inputRef as { current: HTMLTextAreaElement | null }).current = el;
  };

  return (
    <form className={styles.composer} onSubmit={submit} aria-label="Новое сообщение" data-testid="composer">
      {top}
      {files.length > 0 && (
        <ul className={styles.attachList} aria-label="Вложения">
          {files.map((f) => (
            <AttachmentChip key={f.key} file={f} onRemove={() => attachments?.onRemove(f.key)} disabled={sending} />
          ))}
        </ul>
      )}
      <div className={cx(styles.composerBox, blocked && styles.composerOff)}>
        {attachments && (
          <span className={styles.clipWrap}>
            <input
              ref={fileRef}
              className={styles.hiddenInput}
              type="file"
              multiple
              accept={ATTACH_ACCEPT}
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                if (e.target.files?.length) attachments.onAdd(Array.from(e.target.files));
                e.target.value = '';
              }}
            />
            <button type="button" className={styles.iconBtn} onClick={() => fileRef.current?.click()} disabled={disabled} aria-label="Прикрепить файл" aria-describedby={limitsId}>
              <ClipIcon />
            </button>
            <span className={styles.clipTip} aria-hidden="true">
              {ATTACH_LIMITS}
            </span>
          </span>
        )}
        <VisuallyHidden>
          <label htmlFor={id}>{label}</label>
        </VisuallyHidden>
        <textarea
          id={id}
          ref={setArea}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          rows={1}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          inputMode={inputMode}
          autoComplete="off"
        />
        {voice && <VoiceButton value={value} onChange={onChange} disabled={disabled} />}
        {onCall && (
          <button type="button" className={styles.iconBtn} onClick={onCall} disabled={disabled} aria-label="Созвониться" title="Созвониться с ИИ-интервьюером: 4–6 вопросов голосом, карта глубины в профиле" data-testid="call-button">
            <PhoneIcon />
          </button>
        )}
        <button type="submit" className={styles.send} disabled={!canSend} aria-busy={sending || undefined} data-sending={sending || undefined}>
          <span>{sendLabel}</span>
          {sending && (
            <span className={styles.sendSpin} aria-hidden="true">
              <Spinner />
            </span>
          )}
        </button>
      </div>
      {attachments && (
        <VisuallyHidden>
          <AttachmentLimitsHint id={limitsId} text={ATTACH_LIMITS} />
        </VisuallyHidden>
      )}
      {(aside || hint) && (
        <div className={styles.composerMeta}>
          <span>{aside}</span>
          {hint && <span className={styles.composerHint}>{hint}</span>}
        </div>
      )}
      {dragging && (
        <div className={styles.dropOverlay} role="status">
          <div>
            <strong>Брось файлы сюда</strong>
            <span>{ATTACH_LIMITS}</span>
          </div>
        </div>
      )}
    </form>
  );
}

/** Файл тащат над окном: подсветка «брось сюда» на всю ленту; drop — в onAdd. Без onAdd — выключено. */
function useWindowFileDrop(onAdd?: (files: File[]) => void): boolean {
  const [over, setOver] = useState(false);
  const cb = useRef(onAdd);
  cb.current = onAdd;
  const enabled = Boolean(onAdd);
  useEffect(() => {
    if (!enabled) {
      setOver(false);
      return;
    }
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const overFn = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Файл уже принят своей зоной (FilesCard в колонке) — в композер не добавлять.
      const taken = e.defaultPrevented;
      e.preventDefault();
      depth = 0;
      setOver(false);
      if (taken) return;
      const list = Array.from(e.dataTransfer?.files ?? []);
      if (list.length) cb.current?.(list);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overFn);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [enabled]);
  return over;
}

function PhoneIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function ClipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" aria-hidden="true">
      <path d="M20 11.5 12.2 19.3a5 5 0 0 1-7.1-7.1l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
    </svg>
  );
}
