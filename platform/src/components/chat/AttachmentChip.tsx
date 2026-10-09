'use client';

import { Spinner } from '../ui';

import { type Attachment, formatSize } from './attachments';
import styles from './thread.module.css';

/** Имя длиннее — с многоточием посередине: видно и начало, и расширение. */
const NAME_MAX = 28;
export function shortName(name: string): string {
  if (name.length <= NAME_MAX) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  return `${name.slice(0, NAME_MAX - ext.length - 1)}…${ext}`;
}

/** Вложение в композере: имя, размер, состояние загрузки, «убрать». Ошибка — текстом в чипе. */
export function AttachmentChip({ file, onRemove, disabled }: { file: Attachment; onRemove?: () => void; disabled?: boolean }) {
  return (
    <li className={styles.attach} data-status={file.status} title={file.error ?? file.name}>
      <span className={styles.attachIcon} aria-hidden="true">
        {file.status === 'uploading' ? <Spinner /> : file.status === 'error' ? '!' : file.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOC'}
      </span>
      <span className={styles.attachText}>
        <span className={styles.attachName}>{shortName(file.name)}</span>
        <small>{file.status === 'error' ? file.error : file.status === 'uploading' ? 'загружаю…' : formatSize(file.size)}</small>
      </span>
      {onRemove && (
        <button type="button" className={styles.attachRemove} onClick={onRemove} disabled={disabled} aria-label={`Убрать ${file.name}`}>
          ×
        </button>
      )}
    </li>
  );
}

/** Что можно прикрепить — подсказка у скрепки (наведение / фокус) и под чипами. */
export function AttachmentLimitsHint({ id, text }: { id?: string; text: string }) {
  return (
    <span id={id} className={styles.limits} role="note">
      {text}. Можно перетащить файлы в ленту или вставить из буфера; ссылки - просто текстом.
    </span>
  );
}
