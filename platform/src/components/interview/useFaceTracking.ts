'use client';

import { useEffect, useRef, useState } from 'react';

import { type FaceReading, type GazeState, INITIAL_GAZE, lookTargetFrom, readFace, settleGaze } from '@/lib/face-gaze';

import { clearLookTarget, setLookTarget } from '../avatar/look-target';

type Landmarker = { detectForVideo(video: HTMLVideoElement, ts: number): { faceLandmarks: { x: number; y: number }[][] }; close(): void };

const ASSETS = '/mediapipe';
const INTERVAL_MS = 100;

/**
 * Слежение за лицом по видеопотоку камеры (MediaPipe Face Landmarker, WASM в браузере, ресурсы – public/mediapipe,
 * scripts/mediapipe-assets.mjs). Даёт состояние взгляда для значка и двигает цель взгляда головы ИИ
 * (components/avatar/look-target.ts). Никуда не отправляется: только экран кандидата.
 */
export function useFaceTracking(getVideo: () => HTMLVideoElement | null, enabled: boolean) {
  const [gaze, setGaze] = useState<GazeState | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [face, setFace] = useState<FaceReading | null>(null);
  const getVideoRef = useRef(getVideo);
  getVideoRef.current = getVideo;

  useEffect(() => {
    if (!enabled) {
      setGaze(null);
      setFace(null);
      clearLookTarget();
      return;
    }
    let alive = true;
    let lm: Landmarker | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let settled = INITIAL_GAZE;
    let lastTs = -1;
    (async () => {
      try {
        const head = await fetch(`${ASSETS}/face_landmarker.task`, { method: 'HEAD' });
        if (!head.ok) throw new Error('модель не загружена');
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
        const fileset = await FilesetResolver.forVisionTasks(`${ASSETS}/wasm`);
        const created = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: `${ASSETS}/face_landmarker.task`, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });
        if (!alive) {
          created.close();
          return;
        }
        lm = created as unknown as Landmarker;
        setAvailable(true);
        timer = setInterval(() => {
          const v = getVideoRef.current();
          if (!lm || !v || v.readyState < 2 || v.videoWidth === 0) return;
          const ts = performance.now();
          if (ts <= lastTs) return;
          lastTs = ts;
          let res: ReturnType<Landmarker['detectForVideo']>;
          try {
            res = lm.detectForVideo(v, ts);
          } catch {
            return;
          }
          const reading = readFace(res.faceLandmarks[0]);
          const now = Date.now();
          settled = settleGaze(settled, reading?.gaze ?? 'none', now);
          setGaze(settled.state);
          setFace(reading);
          if (reading) {
            const [x, y] = lookTargetFrom(reading, true);
            setLookTarget(x, y, now);
          }
        }, INTERVAL_MS);
      } catch (err) {
        console.warn('[face] слежение недоступно:', err instanceof Error ? err.message : err);
        if (alive) setAvailable(false);
      }
    })();
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      lm?.close();
      clearLookTarget();
    };
  }, [enabled]);

  return { gaze, face, available };
}
