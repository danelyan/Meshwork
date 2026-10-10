'use client';

import { useEffect, useRef, useState } from 'react';

import type { CallEvent, CallSnapshot, SignalPayload, TranscriptEntry } from '@/server/defense-room/types';

/**
 * SSE звонка защиты (`GET /api/defense-room/{id}/events`, EventSource сам переподключается).
 * Имена событий — как у лейна call. Держит снимок: транскрипт без дублей (по index), участники, mute, вердикт. Сигналы WebRTC
 * отдаёт колбэку `onSignal` — их не хранит.
 */
export const CALL_EVENTS = ['snapshot', 'status', 'utterance', 'ai_state', 'participant', 'mute', 'question', 'verdict', 'signal', 'error'] as const;

export function mergeEntries(list: TranscriptEntry[], add: TranscriptEntry[]): TranscriptEntry[] {
  const seen = new Set(list.map((e) => e.index));
  const out = [...list];
  for (const e of add) if (!seen.has(e.index)) out.push(e);
  return out.sort((a, b) => a.index - b.index);
}

export interface CallEventsState {
  snapshot: CallSnapshot | null;
  connected: boolean;
  /** Новые реплики в порядке прихода — чтобы озвучить только свежие. */
  lastEntry: TranscriptEntry | null;
  /** ИИ готовит реплику (`ai_state`). */
  aiThinking: boolean;
}

export function useCallEvents(sessionId: string, initial: CallSnapshot | null, onSignal?: (from: string, payload: SignalPayload) => void): CallEventsState {
  const [snapshot, setSnapshot] = useState<CallSnapshot | null>(initial);
  const [connected, setConnected] = useState(false);
  const [lastEntry, setLastEntry] = useState<TranscriptEntry | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const signalRef = useRef(onSignal);
  signalRef.current = onSignal;

  useEffect(() => {
    const es = new EventSource(`/api/defense-room/${encodeURIComponent(sessionId)}/events`);
    const handle = (raw: MessageEvent<string>) => {
      let e: CallEvent;
      try {
        e = JSON.parse(raw.data) as CallEvent;
      } catch {
        return;
      }
      switch (e.type) {
        case 'snapshot':
          setSnapshot((prev) => ({ ...e.call, transcript: mergeEntries(prev?.transcript ?? [], e.call.transcript) }));
          break;
        case 'status':
          setSnapshot((prev) => (prev ? { ...prev, status: e.status } : prev));
          break;
        case 'verdict':
          setSnapshot((prev) => (prev ? { ...prev, verdict: e.verdict } : prev));
          break;
        case 'utterance':
          setSnapshot((prev) => (prev ? { ...prev, transcript: mergeEntries(prev.transcript, [e.entry]) } : prev));
          setLastEntry(e.entry);
          break;
        case 'ai_state':
          setAiThinking(e.state === 'thinking');
          break;
        case 'participant':
          setSnapshot((prev) => {
            if (!prev) return prev;
            const rest = prev.participants.filter((p) => p.userId !== e.userId);
            return { ...prev, participants: e.action === 'joined' ? [...rest, { userId: e.userId, companyId: e.companyId, companyName: e.companyName, aiMuted: false }] : rest };
          });
          break;
        case 'mute':
          setSnapshot((prev) => (prev ? { ...prev, aiMuted: e.aiMuted } : prev));
          break;
        case 'signal':
          signalRef.current?.(e.from, e.payload);
          break;
        default:
          break;
      }
    };
    for (const name of CALL_EVENTS) es.addEventListener(name, handle as EventListener);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [sessionId]);

  return { snapshot, connected, lastEntry, aiThinking };
}
