/**
 * Лицо и взгляд по 478 точкам MediaPipe Face Landmarker – чистые функции (тесты без камеры и WASM).
 * Только показ на экране собеседнику: в транскрипт, вердикт и работодателю не уходит (docs/competency-model.md § 4.1).
 * Грубая эвристика: поворот головы – нос относительно середины между висками; взгляд – зрачок относительно
 * уголков глаза. Калибровки на людях нет – это индикатор, не измерение.
 */
export interface Point {
  x: number;
  y: number;
}

/** Индексы канонической сетки лица MediaPipe. */
export const LM = {
  noseTip: 1,
  leftTemple: 234,
  rightTemple: 454,
  chin: 152,
  forehead: 10,
  leftEyeOuter: 33,
  leftEyeInner: 133,
  rightEyeInner: 362,
  rightEyeOuter: 263,
  leftEyeTop: 159,
  leftEyeBottom: 145,
  rightEyeTop: 386,
  rightEyeBottom: 374,
  leftIris: 468,
  rightIris: 473,
} as const;

export const GAZE_STATES = ['screen', 'away', 'none'] as const;
export type GazeState = (typeof GAZE_STATES)[number];

export const GAZE_LABEL: Record<GazeState, string> = { screen: 'взгляд на экран', away: 'взгляд в сторону', none: 'лица не видно' };

/** ПРЕДЛОЖЕНИЕ: пороги «в сторону» – поворот головы и смещение зрачка; на людях не калиброваны. */
export const GAZE_THRESHOLDS = { headYaw: 0.35, headPitch: 0.45, iris: 0.18, eyesClosed: 0.08 } as const;

export interface FaceReading {
  /** Центр лица в кадре, 0…1 (как в исходном кадре, без зеркала). */
  center: Point;
  /** Поворот головы: −1…1 влево/вправо (по кадру) и вверх/вниз. */
  yaw: number;
  pitch: number;
  /** Смещение зрачков от центра глаза: −1…1 по горизонтали и вертикали. */
  iris: Point;
  gaze: GazeState;
}

const clamp1 = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

/** Чтение лица из точек; меньше 478 точек – лица нет. */
export function readFace(landmarks: readonly Point[] | null | undefined): FaceReading | null {
  if (!landmarks || landmarks.length < 478) return null;
  const p = (i: number) => landmarks[i]!;
  const lt = p(LM.leftTemple);
  const rt = p(LM.rightTemple);
  const nose = p(LM.noseTip);
  const chin = p(LM.chin);
  const forehead = p(LM.forehead);
  const midX = (lt.x + rt.x) / 2;
  const halfW = Math.max(1e-6, Math.abs(rt.x - lt.x) / 2);
  const midY = (forehead.y + chin.y) / 2;
  const halfH = Math.max(1e-6, Math.abs(chin.y - forehead.y) / 2);
  const yaw = clamp1((nose.x - midX) / halfW);
  // Нос в покое чуть ниже середины лица: вычитаем типичное смещение.
  const pitch = clamp1((nose.y - midY) / halfH - 0.15);

  const irisOf = (outer: number, inner: number, top: number, bottom: number, iris: number) => {
    const o = p(outer);
    const i = p(inner);
    const t = p(top);
    const b = p(bottom);
    const c = p(iris);
    const w = Math.max(1e-6, Math.abs(i.x - o.x));
    const h = Math.max(1e-6, Math.abs(b.y - t.y));
    return { x: ((c.x - (o.x + i.x) / 2) / w) * 2, y: ((c.y - (t.y + b.y) / 2) / h) * 2, open: h / w };
  };
  const l = irisOf(LM.leftEyeOuter, LM.leftEyeInner, LM.leftEyeTop, LM.leftEyeBottom, LM.leftIris);
  const r = irisOf(LM.rightEyeInner, LM.rightEyeOuter, LM.rightEyeTop, LM.rightEyeBottom, LM.rightIris);
  const iris = { x: clamp1((l.x + r.x) / 2), y: clamp1((l.y + r.y) / 2) };
  const eyesClosed = (l.open + r.open) / 2 < GAZE_THRESHOLDS.eyesClosed;
  const away = Math.abs(yaw) > GAZE_THRESHOLDS.headYaw || Math.abs(pitch) > GAZE_THRESHOLDS.headPitch || Math.abs(iris.x) > GAZE_THRESHOLDS.iris || Math.abs(iris.y) > GAZE_THRESHOLDS.iris || eyesClosed;
  let sx = 0;
  let sy = 0;
  for (const q of landmarks) {
    sx += q.x;
    sy += q.y;
  }
  return { center: { x: sx / landmarks.length, y: sy / landmarks.length }, yaw, pitch, iris, gaze: away ? 'away' : 'screen' };
}

/**
 * Куда голове ИИ смотреть: цель −1…1, как у курсора (`trackPointer`: X вправо, Y вверх). Превью камеры
 * зеркальное, и «я сдвинулся влево» на экране – влево; X инвертируем, чтобы голова повернулась туда же.
 */
export function lookTargetFrom(face: FaceReading, mirrored = true): [number, number] {
  const x = (face.center.x - 0.5) * 2;
  const y = (0.5 - face.center.y) * 2;
  return [clamp1(mirrored ? -x : x), clamp1(y)];
}

export interface SettledGaze {
  state: GazeState;
  /** Новое показание, которое ещё не продержалось holdMs, и с какого момента оно держится. */
  pending: GazeState | null;
  pendingSince: number;
}

export const INITIAL_GAZE: SettledGaze = { state: 'none', pending: null, pendingSince: 0 };

/**
 * Сглаживание значка: «в сторону» и «нет лица» показываются, только если новое показание держится непрерывно
 * holdMs (моргание и потеря лица на кадр – не отвод взгляда); возврат «на экран» – сразу.
 */
export function settleGaze(prev: SettledGaze, next: GazeState, now: number, holdMs = 700): SettledGaze {
  if (next === prev.state) return prev.pending === null ? prev : { ...prev, pending: null };
  if (next === 'screen') return { state: 'screen', pending: null, pendingSince: 0 };
  if (prev.pending !== next) return { ...prev, pending: next, pendingSince: now };
  if (now - prev.pendingSince >= holdMs) return { state: next, pending: null, pendingSince: 0 };
  return prev;
}
