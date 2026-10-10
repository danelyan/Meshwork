'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Озвучка реплик интервьюера через `/api/tts` (SpeechKit): каскад «текст → речь» без аватара. Звук
 * разрешается жестом (кнопка «Начать»), дальше новые реплики играют сами; «Повторить вопрос» — replay.
 * Озвучка выключена на стенде (`mode: off`) — реплики остаются текстом.
 */
export function useSpeech() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/tts', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { mode?: string } | null) => alive && setAvailable(j?.mode === 'yandex'))
      .catch(() => alive && setAvailable(false));
    return () => {
      alive = false;
    };
  }, []);

  const stop = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setSpeaking(false);
  }, []);

  const say = useCallback(
    async (text: string) => {
      if (!available || typeof window === 'undefined') return;
      stop();
      try {
        const res = await fetch('/api/tts', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
        if (!res.ok) return;
        const blob = await res.blob();
        const src = URL.createObjectURL(blob);
        url.current = src;
        const a = new Audio(src);
        audio.current = a;
        a.onended = () => setSpeaking(false);
        a.onerror = () => setSpeaking(false);
        setSpeaking(true);
        await a.play().catch(() => setSpeaking(false));
      } catch {
        setSpeaking(false);
      }
    },
    [available, stop],
  );

  /** Новая реплика: озвучить, если озвучка включена. */
  const speak = useCallback((text: string) => (enabled ? say(text) : Promise.resolve()), [enabled, say]);

  useEffect(() => stop, [stop]);

  return { available, enabled, speaking, toggle: () => setEnabled((v) => !v), speak, replay: say, stop };
}
