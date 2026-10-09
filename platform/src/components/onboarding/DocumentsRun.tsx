'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { type ClaimAction, claimAction, confirmClaimsBatchApi, openConsultantStream } from '@/lib/api';
import type { CardClaim } from '@/lib/claims-view';
import { createSseParser } from '@/lib/sse';
import type { AgentEvent } from '@/server/agent/types';

import { applyAgentEvent } from '../chat/stream-items';

import { FeedRows, type FeedItem } from '../EventFeed';

/** События консультанта, которые показываем в онбординге: ход разбора, карточки, итог, ошибка. */
const SHOWN = new Set<AgentEvent['type']>(['step', 'queue', 'claims', 'message', 'delta', 'discard', 'error']);

/** Текст хода, если человек прислал только вложения. */
export const DOCS_PROMPT = 'Разбери мои материалы и предложи утверждения для профиля.';

let seq = 0;
const nextId = () => `ob${++seq}`;

export interface DocumentsTotals {
  uploadIds: string[];
  urls: string[];
  claims: number;
}

interface Sent {
  text: string;
  uploadIds: string[];
  urls: string[];
  fileNames: string[];
}

/**
 * Шаг «Документы» прямо в ленте онбординга (R-C-01): человек прикладывает файлы и пишет ссылки в
 * общем композере, разбор — тот же конвейер консультанта (POST /api/consultant/messages, SSE),
 * карточки утверждений с «Да / Нет / Поправить» — в ленте. Можно прислать ещё раз; итог шага —
 * все файлы, ссылки и число найденных утверждений.
 */
export function useDocumentsRun() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Partial<CardClaim>>>({});
  const [running, setRunning] = useState(false);
  const [totals, setTotals] = useState<DocumentsTotals>({ uploadIds: [], urls: [], claims: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const convRef = useRef<string | undefined>(undefined);
  const lastRef = useRef<Sent | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const push = useCallback((event: AgentEvent) => {
    if (event.type === 'conversation') {
      convRef.current = event.id;
      return;
    }
    if (!SHOWN.has(event.type)) return;
    if (event.type === 'claims') setTotals((t) => ({ ...t, claims: t.claims + event.proposed.length }));
    setItems((p) => applyAgentEvent(p, event, nextId));
  }, []);

  const send = useCallback(
    async (sent: Sent, opts: { echo?: boolean } = {}) => {
      lastRef.current = sent;
      setRunning(true);
      if (opts.echo !== false) setItems((p) => [...p, { id: nextId(), role: 'user', text: sent.text, files: sent.fileNames }]);
      setTotals((t) => ({
        ...t,
        uploadIds: [...new Set([...t.uploadIds, ...sent.uploadIds])],
        urls: [...new Set([...t.urls, ...sent.urls])],
      }));
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const stream = await openConsultantStream(
          { text: sent.text || DOCS_PROMPT, uploadIds: sent.uploadIds, urls: sent.urls, ...(convRef.current ? { conversationId: convRef.current } : {}) },
          ctrl.signal,
        );
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const ev of parser.push(decoder.decode(value, { stream: true }))) push(ev);
        }
        for (const ev of parser.push(decoder.decode())) push(ev);
        for (const ev of parser.flush()) push(ev);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          push({ type: 'error', code: (e as { code?: string }).code ?? 'network', message: e instanceof Error ? e.message : 'Не удалось разобрать материалы.' });
        }
      } finally {
        setRunning(false);
      }
    },
    [push],
  );

  const retry = useCallback(() => {
    if (lastRef.current) void send(lastRef.current, { echo: false });
  }, [send]);

  const onClaimAction = useCallback(async (claim: CardClaim, action: ClaimAction, statement?: string) => {
    await claimAction(claim.id, action, statement);
    setOverrides((p) => ({
      ...p,
      [claim.id]: { status: action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'edited', ...(action === 'edit' && statement ? { statement } : {}) },
    }));
  }, []);

  const onConfirmAll = useCallback(async (claims: CardClaim[]) => {
    const r = await confirmClaimsBatchApi(claims.map((c) => c.id));
    const ok = new Set(r.confirmed);
    for (const s of r.skipped) if (s.reason === 'already_confirmed') ok.add(s.id);
    setOverrides((p) => {
      const next = { ...p };
      for (const id of ok) next[id] = { ...next[id], status: 'confirmed' };
      return next;
    });
    return r.confirmed.length;
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setItems([]);
    setTotals({ uploadIds: [], urls: [], claims: 0 });
  }, []);

  return { items, overrides, running, totals, send, retry, reset, onClaimAction, onConfirmAll, started: items.length > 0 };
}

export type DocumentsRun = ReturnType<typeof useDocumentsRun>;

/** Строки разбора в ленте онбординга: пузыри человека, шаги, карточки утверждений, реплика итога. */
export function DocumentsRows({ run }: { run: DocumentsRun }) {
  return (
    <FeedRows
      items={run.items}
      claimOverrides={run.overrides}
      onClaimAction={run.onClaimAction}
      onConfirmAll={run.onConfirmAll}
      onRetry={run.retry}
      locked={run.running}
    />
  );
}

