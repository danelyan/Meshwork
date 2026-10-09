'use client';

import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';

import { openConsultantStream } from '@/lib/api';
import { createSseParser } from '@/lib/sse';
import type { RestoredItem } from '@/server/agent/restore';
import type { AgentEvent } from '@/server/agent/types';

import { useCompanionVoice } from '../avatar/voice';
import { applyAgentEvent } from '../chat/stream-items';
import { FeedRows, type FeedItem } from '../EventFeed';

/** События консультанта в ответе на свободный вопрос: реплика (со стримом), ход работы, ошибка. */
const SHOWN = new Set<AgentEvent['type']>(['step', 'queue', 'message', 'delta', 'discard', 'error', 'recommendations']);

let seq = 0;
const nextId = () => `as${++seq}`;

/** Реплики свободных вопросов по шагам онбординга (stepId → лента). */
export type AsidesByStep = Record<string, FeedItem[]>;

/** Восстановленные после перезагрузки вопросы (RestoredItem со stepId) — по шагам. */
export function groupAsides(items: RestoredItem[]): AsidesByStep {
  const out: AsidesByStep = {};
  for (const it of items) {
    if (!it.stepId) continue;
    const { stepId, ...rest } = it;
    (out[stepId] ??= []).push(rest as FeedItem);
  }
  return out;
}

/**
 * Свободный вопрос посреди онбординга (решение владельца 09.10): текст, не совпавший с вариантом
 * шага, уходит карьерному консультанту (POST /api/consultant/messages с onboardingStep, SSE) в тот же
 * разговор, что после итога станет консультантом. Ответ — под текущим шагом; без модели (заглушка,
 * сбой) сервер отвечает заготовкой. `local` — заготовка без сервера (до роли «специалист»).
 */
export function useAsides(initial: AsidesByStep, conversation: MutableRefObject<string | undefined>, onConversation: (id: string) => void) {
  const [byStep, setByStep] = useState<AsidesByStep>(initial);
  const [asking, setAsking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const voice = useCompanionVoice();
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const push = useCallback((stepId: string, item: FeedItem) => setByStep((p) => ({ ...p, [stepId]: [...(p[stepId] ?? []), item] })), []);

  const apply = useCallback(
    (stepId: string, event: AgentEvent) => {
      if (event.type === 'conversation') {
        conversation.current = event.id;
        onConversation(event.id);
        return;
      }
      if (!SHOWN.has(event.type)) return;
      if (event.type === 'message') voiceRef.current?.speak(event.text);
      setByStep((p) => ({ ...p, [stepId]: applyAgentEvent(p[stepId] ?? [], event, nextId) as FeedItem[] }));
    },
    [conversation, onConversation],
  );

  const ask = useCallback(
    async (stepId: string, text: string) => {
      push(stepId, { id: nextId(), role: 'user', text });
      setAsking(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const stream = await openConsultantStream({ text, onboardingStep: stepId, ...(conversation.current ? { conversationId: conversation.current } : {}) }, ctrl.signal);
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const ev of parser.push(decoder.decode(value, { stream: true }))) apply(stepId, ev);
        }
        for (const ev of parser.push(decoder.decode())) apply(stepId, ev);
        for (const ev of parser.flush()) apply(stepId, ev);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          apply(stepId, { type: 'error', code: (e as { code?: string }).code ?? 'network', message: e instanceof Error ? e.message : 'Не получилось ответить. Повтори.' });
        }
      } finally {
        setAsking(false);
      }
    },
    [apply, conversation, push],
  );

  /** Заготовка без модели: вопрос остаётся в ленте, ответ — фиксированный текст (в БД не пишется). */
  const local = useCallback(
    (stepId: string, text: string, reply: string) => {
      push(stepId, { id: nextId(), role: 'user', text });
      push(stepId, { id: nextId(), role: 'agent', event: { type: 'message', text: reply } });
    },
    [push],
  );

  return { byStep, asking, ask, local };
}

export type Asides = ReturnType<typeof useAsides>;

/** Реплики свободных вопросов одного шага. */
export function AsideRows({ items, locked }: { items: FeedItem[] | undefined; locked: boolean }) {
  if (!items?.length) return null;
  return <FeedRows items={items} locked={locked} />;
}
