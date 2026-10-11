'use client';

import { useCallback, useRef, useState } from 'react';

import { MAX_UPLOAD_BYTES, uploadFile, validateUploadFile } from '@/lib/api';

/** Вложения композера: PDF/DOCX/MD/TXT/CSV до 5 МБ, не больше 10 за сообщение (лимит POST /api/consultant/messages). */
export const MAX_ATTACHMENTS = 10;
export const ATTACH_ACCEPT = '.pdf,.docx,.md,.markdown,.txt,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/csv';
export const ATTACH_LIMITS = `PDF, DOCX, MD, TXT, CSV · до ${MAX_UPLOAD_BYTES / 1024 / 1024} МБ · до ${MAX_ATTACHMENTS} файлов`;

export interface Attachment {
  key: string;
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'error';
  /** id из POST /api/uploads. */
  id?: string;
  error?: string;
}

let seq = 0;

/**
 * Состояние вложений: файл сразу уходит в POST /api/uploads (сервер разбирает его и хранит
 * только текст), чип показывает «загружаю / готово / ошибку». Отправка сообщения ждёт, пока
 * все загрузки закончатся. `add` принимает и выбор из диалога, и drag-n-drop, и вставку.
 */
export function useAttachments() {
  const [files, setFiles] = useState<Attachment[]>([]);
  const filesRef = useRef(files);
  filesRef.current = files;

  const add = useCallback((list: File[] | FileList) => {
    // Загрузки запускаются вне updater'а setState: StrictMode вызывает updater дважды.
    let room = MAX_ATTACHMENTS - filesRef.current.filter((f) => f.status !== 'error').length;
    const added: Attachment[] = [];
    for (const file of Array.from(list)) {
      const key = `a${++seq}`;
      const problem = room <= 0 ? `«${file.name}»: за раз - не больше ${MAX_ATTACHMENTS} файлов.` : validateUploadFile(file);
      if (problem) {
        added.push({ key, name: file.name, size: file.size, status: 'error', error: problem });
        continue;
      }
      room--;
      added.push({ key, name: file.name, size: file.size, status: 'uploading' });
      uploadFile(file).then(
        (r) => setFiles((p) => p.map((f) => (f.key === key ? { ...f, status: 'done', id: r.id } : f))),
        (e: unknown) =>
          setFiles((p) => p.map((f) => (f.key === key ? { ...f, status: 'error', error: e instanceof Error ? e.message : 'Не удалось загрузить.' } : f))),
      );
    }
    filesRef.current = [...filesRef.current, ...added];
    setFiles((p) => [...p, ...added]);
  }, []);

  const remove = useCallback((key: string) => setFiles((p) => p.filter((f) => f.key !== key)), []);
  const clear = useCallback(() => setFiles([]), []);
  /** Подстановка уже загруженных файлов (черновик после возврата на страницу): сразу «готово». */
  const restore = useCallback((list: { id: string; name: string; size: number }[]) => {
    const restored: Attachment[] = list.map((f) => ({ key: `a${++seq}`, name: f.name, size: f.size, status: 'done', id: f.id }));
    setFiles((p) => (p.length ? p : restored));
  }, []);

  return {
    files,
    add,
    remove,
    clear,
    restore,
    uploading: files.some((f) => f.status === 'uploading'),
    ready: files.filter((f): f is Attachment & { id: string } => f.status === 'done' && Boolean(f.id)),
  };
}

/** «1,2 МБ» / «340 КБ». */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}
