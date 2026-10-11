'use client';

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';

import type { useAttachments } from './attachments';

interface DraftFile {
  id: string;
  name: string;
  size: number;
}
interface Draft {
  text: string;
  files: DraftFile[];
}

const SAVE_DELAY_MS = 300;

/** Ключ черновика: по разговору; до первого хода разговора нет — «new». */
export const draftKey = (conversationId?: string | null) => `fsp:chat-draft:${conversationId ?? 'new'}`;

function read(key: string): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    const files = Array.isArray(d.files)
      ? d.files.filter((f): f is DraftFile => Boolean(f) && typeof f.id === 'string' && typeof f.name === 'string').map((f) => ({ id: f.id, name: f.name, size: Number(f.size) || 0 }))
      : [];
    return { text: typeof d.text === 'string' ? d.text : '', files };
  } catch {
    return null;
  }
}

function write(key: string, draft: Draft) {
  try {
    if (!draft.text && !draft.files.length) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // sessionStorage недоступен (приватный режим, запрет) - черновик просто не сохраняется.
  }
}

/**
 * Черновик композера в sessionStorage: уход на другую страницу и возврат не теряют набранное.
 * Читается в эффекте после монтирования (в начальном state нельзя: на сервере storage нет -
 * расхождение гидрации). Пустой черновик (в том числе после отправки) удаляется сразу,
 * непустой пишется с задержкой и дописывается при размонтировании. Вложения - только готовые.
 */
export function useChatDraft(conversationId: string | null | undefined, text: string, setText: Dispatch<SetStateAction<string>>, att: ReturnType<typeof useAttachments>) {
  const key = draftKey(conversationId);
  const [hydrated, setHydrated] = useState(false);
  const { restore } = att;

  useEffect(() => {
    const d = read(key);
    if (d) {
      if (d.text) setText((t) => t || d.text);
      if (d.files.length) restore(d.files);
    }
    setHydrated(true);
  }, [key, setText, restore]);

  const files: DraftFile[] = att.ready.map((f) => ({ id: f.id, name: f.name, size: f.size }));
  const snapshot = JSON.stringify({ text, files } satisfies Draft);

  const latest = useRef<Draft | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const draft = JSON.parse(snapshot) as Draft;
    latest.current = draft;
    if (!draft.text && !draft.files.length) {
      write(key, draft);
      return;
    }
    const t = window.setTimeout(() => write(key, draft), SAVE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [key, hydrated, snapshot]);

  // Размонтирование раньше задержки: дописываем сразу, иначе быстрый уход потеряет текст.
  useEffect(
    () => () => {
      if (latest.current) write(key, latest.current);
    },
    [key],
  );
}
