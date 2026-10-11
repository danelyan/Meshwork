'use client';

import { useEffect, useRef, useState } from 'react';

/** Длина сегмента: отдельный MediaRecorder на каждый – каждый файл воспроизводим сам по себе (как видео кандидата). */
export const EMPLOYER_AUDIO_SEGMENT_MS = 60_000;
const AUDIO_BITRATE = 32_000;

export type EmployerRecState = 'off' | 'recording' | 'stopped' | 'unsupported';

function mimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm']) if (MediaRecorder.isTypeSupported(t)) return t;
  return undefined;
}

/**
 * Запись голоса работодателя в живой защите (ADR 0008 п. 3: пишутся обе стороны). Пишет тот же микрофон, что уходит
 * кандидату по P2P, сегментами WebM/Opus на `POST /api/employer/call/{id}/audio?startMs=`.
 * Любая ошибка записи или загрузки только логируется: звонок не падает и не прерывается. Сервер отказал
 * (`recording_consent_required`, `call_recording_off`, защита завершена) – запись останавливается до следующего входа.
 */
export function useEmployerRecorder(opts: { sessionId: string; stream: MediaStream | null; enabled: boolean; getStartedAt: () => number }): { state: EmployerRecState; error: string | null } {
  const [state, setState] = useState<EmployerRecState>('off');
  const [error, setError] = useState<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  /** Сервер запретил запись – не перезапускать до смены потока или нового входа. */
  const refused = useRef(false);

  const { stream, enabled, sessionId } = opts;

  useEffect(() => {
    if (!enabled) refused.current = false;
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !stream || refused.current) {
      setState((s) => (s === 'recording' ? 'stopped' : s));
      return;
    }
    if (typeof MediaRecorder === 'undefined' || stream.getAudioTracks().length === 0) {
      setState('unsupported');
      return;
    }
    let live = true;
    let rec: MediaRecorder | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Свой MediaStream с теми же треками: P2P-соединение и запись не делят объект потока.
    const recStream = new MediaStream(stream.getAudioTracks());

    const upload = async (blob: Blob, startMs: number) => {
      if (blob.size === 0) return;
      try {
        const res = await fetch(`/api/employer/call/${encodeURIComponent(sessionId)}/audio?startMs=${Math.max(0, Math.floor(startMs))}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'audio/webm' },
          body: blob,
        });
        if (res.status === 409 || res.status === 403 || res.status === 404) {
          const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string }; message?: string } | null;
          console.warn('[employer-audio] upload refused', res.status, body?.error?.code);
          refused.current = true;
          live = false;
          if (rec && rec.state !== 'inactive') rec.stop();
          setError(body?.error?.message ?? body?.message ?? 'Запись вашего голоса остановлена');
          setState('stopped');
        } else if (!res.ok) {
          console.warn('[employer-audio] upload failed', res.status);
        }
      } catch (err) {
        console.warn('[employer-audio] upload error', err);
      }
    };

    const recordSegment = () => {
      if (!live) return;
      const startMs = Date.now() - optsRef.current.getStartedAt();
      const chunks: Blob[] = [];
      let r: MediaRecorder;
      try {
        const mt = mimeType();
        r = new MediaRecorder(recStream, { ...(mt ? { mimeType: mt } : {}), audioBitsPerSecond: AUDIO_BITRATE });
      } catch (err) {
        console.warn('[employer-audio] recorder failed', err);
        setState('unsupported');
        return;
      }
      r.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      r.onerror = (e) => console.warn('[employer-audio] recorder error', e);
      // stop приходит и по stop(), и когда трек кончился (MDN: перед ним – последний dataavailable).
      r.onstop = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        void upload(new Blob(chunks, { type: 'audio/webm' }), startMs);
        if (live && recStream.getAudioTracks().some((t) => t.readyState === 'live')) recordSegment();
        else setState((s) => (s === 'recording' ? 'stopped' : s));
      };
      rec = r;
      try {
        r.start();
      } catch (err) {
        console.warn('[employer-audio] start failed', err);
        setState('unsupported');
        return;
      }
      setState('recording');
      timer = setTimeout(() => {
        if (r.state !== 'inactive') r.stop();
      }, EMPLOYER_AUDIO_SEGMENT_MS);
    };

    try {
      recordSegment();
    } catch (err) {
      console.warn('[employer-audio] failed', err);
    }
    return () => {
      // Выход/конец защиты: последний сегмент дописывается и уходит (onstop), новый не начинается.
      live = false;
      if (timer) clearTimeout(timer);
      try {
        if (rec && rec.state !== 'inactive') rec.stop();
      } catch {
        /* уже остановлен */
      }
    };
  }, [stream, enabled, sessionId]);

  return { state, error };
}
