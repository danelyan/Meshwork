'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Длина сегмента видео: отдельный MediaRecorder на каждый — файлы воспроизводимы по одному. */
export const VIDEO_SEGMENT_MS = 60_000;
const VIDEO_BITRATE = 300_000;

export type CameraState = 'off' | 'starting' | 'on' | 'denied';

/**
 * Камера кандидата в комнате звонка: превью в плитке и запись сегментами WebM (без звука — звук пишет микрофон)
 * на `POST /api/call/{id}/video?startMs=`. По умолчанию выключена; включается кнопкой после согласия (пункт о камере).
 * Никакого анализа видео на клиенте нет: только запись как материал созвона.
 */
export function useCamera(opts: { getCallId: () => string | null; getStartedAt: () => number | null }) {
  const [state, setState] = useState<CameraState>('off');
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState(0);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const live = useRef(false);
  /** Поколение запуска: stop() обесценивает запрос разрешения, который ещё не вернулся. */
  const gen = useRef(0);
  /** Незавершённые загрузки сегментов — stop() ждёт их, чтобы последний сегмент не потерялся. */
  const uploads = useRef(new Set<Promise<void>>());

  const supported = typeof window !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined';

  const mimeType = () => {
    if (typeof MediaRecorder === 'undefined') return undefined;
    for (const t of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) if (MediaRecorder.isTypeSupported(t)) return t;
    return undefined;
  };

  const upload = useCallback((blob: Blob, startMs: number) => {
    const id = optsRef.current.getCallId();
    if (!id || blob.size === 0) return;
    const p = (async () => {
      try {
        const res = await fetch(`/api/call/${encodeURIComponent(id)}/video?startMs=${Math.max(0, Math.floor(startMs))}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'video/webm' },
          body: blob,
        });
        if (res.ok) setSegments((n) => n + 1);
      } catch {
        /* сегмент потерян — созвон не ломаем */
      }
    })().finally(() => uploads.current.delete(p));
    uploads.current.add(p);
  }, []);

  const recordSegment = useCallback(() => {
    const s = stream.current;
    if (!s || !live.current) return;
    const startedAt = optsRef.current.getStartedAt();
    const startMs = startedAt ? Date.now() - startedAt : 0;
    const chunks: Blob[] = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(s, { mimeType: mimeType(), videoBitsPerSecond: VIDEO_BITRATE });
    } catch {
      return;
    }
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      upload(new Blob(chunks, { type: 'video/webm' }), startMs);
      if (live.current) recordSegment();
    };
    recorder.current = rec;
    rec.start();
    timer.current = setTimeout(() => {
      if (rec.state !== 'inactive') rec.stop();
    }, VIDEO_SEGMENT_MS);
  }, [upload]);

  /** Выключить камеру и дождаться загрузки последнего сегмента (вызывать перед finish). */
  const stop = useCallback(async () => {
    live.current = false;
    gen.current += 1;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const rec = recorder.current;
    recorder.current = null;
    if (rec && rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        const prev = rec.onstop;
        rec.onstop = (e) => {
          prev?.call(rec, e);
          resolve();
        };
        rec.stop();
      });
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setState('off');
    await Promise.all([...uploads.current]);
  }, []);

  const start = useCallback(async () => {
    if (!supported) return;
    setError(null);
    setState('starting');
    const my = ++gen.current;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
      if (my !== gen.current) {
        // Пока ждали разрешение, комнату закрыли: камеру не включаем.
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        void video.current.play().catch(() => undefined);
      }
      live.current = true;
      setState('on');
      recordSegment();
    } catch {
      setError('Нет доступа к камере - разреши её в настройках браузера. Интервью идёт и без камеры.');
      setState('denied');
    }
  }, [supported, recordSegment]);

  /** Превью подключается, когда элемент появился уже после старта. */
  const attach = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    if (el && stream.current) {
      el.srcObject = stream.current;
      void el.play().catch(() => undefined);
    }
  }, []);

  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );

  /** Элемент превью — источник кадров для слежения за лицом. */
  const getVideo = useCallback(() => video.current, []);

  return { supported, state, error, segments, start, stop, attach, getVideo };
}
