// Клиент API созвона (lane call). Ошибки — ApiError из lib/api.ts.
import type { CallEvent, CallKind, CallView, TranscriptEntry, TurnResult } from '@/server/call/types';

import { ApiError, postJson, readError, request } from './api';

export interface CallListResponse {
  /** mode (ADR 0005): audio — запись идёт; text — согласие на запись отозвано, созвон текстом; ask — спросить. */
  consent: { given: boolean; mode?: 'audio' | 'text' | 'ask'; version: string; text: string[] };
  calls: CallView[];
  /** Готовность к созвону по видам (server/call/readiness.ts); у старых ответов поля нет. */
  readiness?: Record<'qualifying' | 'interview', { ready: boolean; reason?: string; retryAt?: string }>;
}

export interface CallStartResponse {
  sessionId: string;
  resumed: boolean;
  webrtc: { iceServers: { urls: string[] }[] };
  call: CallView;
}

export const callApi = {
  list: (kind: CallKind = 'qualifying') => request<CallListResponse>(`/api/call?kind=${kind}`),
  consent: (version: string) => postJson<{ version: string; acceptedAt: string }>('/api/call/consent', { version }),
  start: (kind: CallKind = 'qualifying') => postJson<CallStartResponse>('/api/call/start', { kind }),
  get: (id: string) => request<CallView>(`/api/call/${encodeURIComponent(id)}`),
  turn: (id: string, body: { text?: string; audioRef?: string }) => postJson<TurnResult>(`/api/call/${encodeURIComponent(id)}/turn`, body),
  finish: (id: string) => postJson<CallView>(`/api/call/${encodeURIComponent(id)}/finish`, {}),
  /** Кандидат перебил реплику ИИ: сколько её предложений прозвучало. */
  interrupt: (id: string, body: { index: number; heardSentences: number }) => postJson<TranscriptEntry>(`/api/call/${encodeURIComponent(id)}/interrupt`, body),
  /** Сегмент голоса LPCM 16 кГц → сохранён на сервере; text — если распознал SpeechKit. */
  async audio(id: string, pcm: Uint8Array): Promise<{ audioRef: string; text: string | null }> {
    let res: Response;
    try {
      res = await fetch(`/api/call/${encodeURIComponent(id)}/audio`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'audio/l16; rate=16000' },
        body: pcm as unknown as BodyInit,
      });
    } catch {
      throw new ApiError('Нет связи с сервером. Проверьте сеть и повторите.', 0, 'network');
    }
    if (!res.ok) throw await readError(res);
    return (await res.json()) as { audioRef: string; text: string | null };
  },
  recordingUrl: (id: string) => `/api/call/${encodeURIComponent(id)}/recording`,
};

/** Подписка на события созвона (EventSource, именованные события). Возвращает «отписаться». */
export function subscribeCallEvents(id: string, onEvent: (e: CallEvent) => void): () => void {
  if (typeof window === 'undefined' || typeof window.EventSource !== 'function') return () => {};
  const es = new EventSource(`/api/call/${encodeURIComponent(id)}/events`, { withCredentials: true });
  const types: CallEvent['type'][] = ['snapshot', 'status', 'utterance', 'ai_state', 'participant', 'mute', 'question', 'verdict', 'signal', 'error'];
  const handler = (m: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(m.data) as CallEvent);
    } catch {
      /* чужой кадр */
    }
  };
  for (const t of types) es.addEventListener(t, handler as EventListener);
  return () => es.close();
}
