'use client';

import { useCallback, useRef } from 'react';

import { speechText } from '@/lib/speech-text';

/**
 * Второй голос (TTS_VOICE_EMPLOYER): реплики работодателя кандидату, когда P2P-аудио не поднялось.
 * Очередь по одной реплике; озвучка выключена на стенде — молча остаётся текст.
 */
export function useEmployerVoice() {
  const queue = useRef<Promise<void>>(Promise.resolve());
  return useCallback((raw: string) => {
    const text = speechText(raw);
    if (!text) return;
    queue.current = queue.current.then(async () => {
      try {
        const res = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: 'employer', realtime: true }) });
        if (!res.ok) return;
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          void audio.play().catch(() => resolve());
        });
        URL.revokeObjectURL(url);
      } catch {
        /* озвучка недоступна — текст остаётся */
      }
    });
  }, []);
}
