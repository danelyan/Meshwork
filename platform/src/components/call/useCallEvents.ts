'use client';

import { useEffect, useRef, useState } from 'react';

import type { CallEvent, CallSnapshot, SignalPayload, TranscriptEntry } from '@/server/defense-room/types';

/**
 * SSE звонка защиты (`GET /api/defense-room/{id}/events`, EventSource сам переподключается).
 * Держит снимок: транскрипт без дублей (по seq), участники, mute, вердикт. Сигналы WebRTC
 * отдаёт колбэку `onSignal` — их не хранит.
 */
export const CALL_EVENTS = ['turn', 'participant_joined', 'participant_left', 'ai_muted', 'employer_question', 'status', 'signal'] as const;

export function mergeEntries(list: TranscriptEntry[], add: TranscriptEntry[]): TranscriptEntry[] {
  const seen = new Set(list.map((e) => e.seq));
  const out = [...list];
  for (const e of add) if (!seen.has(e.seq)) out.push(e);
  return out.sort((a, b) => a.seq - b.seq);
}

export interface CallEventsState {
  snapshot: CallSnapshot | null;
  connected: boolean;
  /** Новые реплики в порядке прихода — чтобы озвучить только свежие. */
  lastEntry: TranscriptEntry | null;
}

export function useCallEvents(sessionId: string, initial: CallSnapshot | null, onSignal?: (from: string, payload: SignalPayload) => void): CallEventsState {
  const [snapshot, setSnapshot] = useState<CallSnapshot | null>(initial);
  const [connected, setConnected] = useState(false);
  const [lastEntry, setLastEntry] = useState<TranscriptEntry | null>(null);
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
        case 'status':
          setSnapshot((prev) => ({ ...e.snapshot, transcript: mergeEntries(prev?.transcript ?? [], e.snapshot.transcript) }));
          break;
        case 'turn':
          setSnapshot((prev) => (prev ? { ...prev, transcript: mergeEntries(prev.transcript, [e.entry]) } : prev));
          setLastEntry(e.entry);
          break;
        case 'participant_joined':
          setSnapshot((prev) =>
            prev && !prev.participants.some((p) => p.userId === e.userId)
              ? { ...prev, participants: [...prev.participants, { userId: e.userId, companyId: e.companyId, companyName: e.companyName, aiMuted: false }] }
              : prev,
          );
          break;
        case 'participant_left':
          setSnapshot((prev) => (prev ? { ...prev, participants: prev.participants.filter((p) => p.userId !== e.userId) } : prev));
          break;
        case 'ai_muted':
          setSnapshot((prev) => (prev ? { ...prev, aiMuted: e.muted } : prev));
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

  return { snapshot, connected, lastEntry };
}
