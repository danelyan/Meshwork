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
  /** Поколение запроса: stop() и новый say() обесценивают синтез, который ещё не вернулся. */
  const gen = useRef(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/tts', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { mode?: string } | null) => alive && setAvailable((j?.mode === 'yandex' || j?.mode === 'elevenlabs')))
      .catch(() => alive && setAvailable(false));
    return () => {
      alive = false;
    };
  }, []);

  const stop = useCallback(() => {
    gen.current += 1;
    abort.current?.abort();
    abort.current = null;
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
      const my = gen.current;
      const ac = new AbortController();
      abort.current = ac;
      try {
        const res = await fetch('/api/tts', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }), signal: ac.signal });
        if (!res.ok || my !== gen.current) return;
        const blob = await res.blob();
        // Пока грузили — остановили или заказали другую реплику: этот звук не играет.
        if (my !== gen.current) return;
        const src = URL.createObjectURL(blob);
        url.current = src;
        const a = new Audio(src);
        audio.current = a;
        a.onended = () => setSpeaking(false);
        a.onerror = () => setSpeaking(false);
        setSpeaking(true);
        await a.play().catch(() => setSpeaking(false));
      } catch {
        if (my === gen.current) setSpeaking(false);
      }
    },
    [available, stop],
  );

  /** Новая реплика: озвучить, если озвучка включена. */
  const speak = useCallback((text: string) => (enabled ? say(text) : Promise.resolve()), [enabled, say]);

  useEffect(() => stop, [stop]);

  return { available, enabled, speaking, toggle: () => setEnabled((v) => !v), speak, replay: say, stop };
}
