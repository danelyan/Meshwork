/**
 * Движение головы компаньона «как у Карины» (components/head/motion.ts, pointer.ts) на нашей модели.
 * Чистые функции Карины берём импортом; здесь только то, что отличается у нашей модели:
 * она уже смотрит в +Z (компенсация −0.54 рад не нужна), высоты шеи и челюсти — в наших координатах
 * (высота 0…1 от основания шеи до макушки, низ подбородка 0.27, челюсть 0.33–0.43).
 */
import { headMotion, headPose } from "../head/motion";
import { headPointer } from "../head/pointer";

export { headMotion, headPointer };

/** Режим движения: прежнее покачивание группы, анимация Карины, Карина + живые скулы и глаза. */
export type HeadMotionMode = "classic" | "karina" | "alive";

export const HEAD_MOTION_MODES: readonly {
  id: HeadMotionMode;
  label: string;
  hint: string;
}[] = [
  {
    id: "classic",
    label: "Как было",
    hint: "Покачивание всей головы вместе с шеей, моргание раз в 2.5–6 с, без слежения.",
  },
  {
    id: "karina",
    label: "Как у Карины",
    hint: "Слежение за курсором по всей странице, поворачивается шея (основание на месте), дыхание, два моргания за 9 с.",
  },
  {
    id: "alive",
    label: "Карина + живые скулы и глаза",
    hint: "То же + щёки поднимаются при улыбке и речи, глазницы и веки чуть ведут за курсором, брови — когда думает.",
  },
];

export const DEFAULT_HEAD_MOTION: HeadMotionMode = "classic";
/** В чате слежение за курсором включено. */
export const CHAT_HEAD_MOTION: HeadMotionMode = "alive";

export function isHeadMotionMode(v: string): v is HeadMotionMode {
  return HEAD_MOTION_MODES.some((m) => m.id === v);
}

/**
 * Шея в координатах модели. Вес поворота 0 у основания (плечи/воротник на месте) → 1 под подбородком,
 * чтобы челюсть (0.33–0.43) и всё лицо поворачивались жёстко. Pivot — середина шеи по глубине
 * (сечение y 0.10–0.20: z от −0.12 до 0.27), как у Карины — внутри шеи ниже подбородка.
 */
export const NECK = {
  from: 0.03,
  to: 0.29,
  pivotY: 0.18,
  pivotZ: 0.06,
} as const;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Вес поворота шеи по высоте — та же формула, что в вершинном шейдере (NECK_GLSL). */
export function neckWeight(y: number, n = NECK): number {
  const t = clamp01((y - n.from) / (n.to - n.from));
  return t * t * (3 - 2 * t);
}

/** Смещение компенсации из headPose Карины: её модель смотрит на 31° вправо, наша — прямо. */
const KARINA_YAW_OFFSET = headPose(0, 0)[0];

/** Усиление слежения против её `headPose` (±0.24 рад ≈ ±14°): владелец 10.10 — до ±30° (≈ ±0.52 рад). */
export const TRACK_GAIN = 2.2;
/**
 * Наклон за курсором по вертикали, рад: вниз до ≈22°, вверх до ≈9°. У Карины ±0.07 (×TRACK_GAIN ≈ ±9°)
 * — голова почти не опускалась, когда курсор под ней (владелец 10.10: «должна смотреть вниз»).
 */
export const PITCH_DOWN = 0.38;
export const PITCH_UP = 0.15;

const clampUnit = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

/**
 * Курсор → −1…1 относительно головы. По X — как `headPointer` Карины. По Y — отдельно вверх и вниз:
 * расстояние до края окна с той стороны. Голова стоит в верхней трети экрана, и у Карины
 * (деление на всю высоту) курсор прямо под подбородком давал почти ноль — теперь низ окна = −1.
 */
export function trackPointer(x: number, y: number, width: number, height: number, centerX: number, centerY: number): [number, number] {
  const [px] = headPointer(x, y, width, height, centerX, centerY);
  const py = y <= centerY ? (centerY - y) / Math.max(1, centerY) : -(y - centerY) / Math.max(1, height - centerY);
  return [px, clampUnit(py)];
}

/**
 * Поза за курсором (pointer — нормированный −1…1, как trackPointer): yaw ±0.53 — её `headPose` ×
 * TRACK_GAIN; pitch — вокруг её центра, вниз PITCH_DOWN, вверх PITCH_UP (плюс — голова опускается).
 */
export function trackPose(
  pointerX: number,
  pointerY: number,
): [number, number] {
  const [yaw] = headPose(pointerX, pointerY);
  const [, pitch0] = headPose(0, 0);
  const py = clampUnit(pointerY);
  return [(yaw - KARINA_YAW_OFFSET) * TRACK_GAIN, pitch0 - py * (py < 0 ? PITCH_DOWN : PITCH_UP)];
}

export type PointerBehavior = 'follow' | 'avoid';

/** На 404 лицо отворачивается от курсора, с более заметным, но ограниченным поворотом. */
export function pointerPose(x: number, y: number, behavior: PointerBehavior = 'follow'): [number, number] {
  if (behavior === 'follow') return trackPose(x, y);
  const pose = trackPose(-clampUnit(x), -clampUnit(y));
  return [pose[0] * 1.65, pose[1]];
}

/** Её сглаживание слежения: экспоненциальное приближение со скоростью 5.2/с, не зависит от FPS. */
export function easeToward(
  current: number,
  target: number,
  dt: number,
  rate = 5.2,
): number {
  const k = 1 - Math.exp(-Math.max(0, Math.min(0.1, dt)) * rate);
  return current + (target - current) * k;
}

/**
 * Основание шеи (плечи) развёрнуто чуть в сторону, как у Карины (−0.66 против −0.54 у лица):
 * при курсоре в центре лицо смотрит в камеру, а шея — на 0.12 рад левее.
 */
export const BASE_YAW = -0.12;
/** Наклон всей сцены под камеру ниже уровня глаз (как в прежнем режиме). */
export const BASE_PITCH = -0.1;

export interface NeckInput {
  /** Сглаженная поза за курсором. */
  pose: [number, number];
  /** Время анимации, с (идёт только пока кадр рисуется). */
  time: number;
  thinking: boolean;
  /** Громкость речи 0…1 (сглаженная). */
  level: number;
}

/** Повороты шеи (yaw, pitch, roll) и дыхание — в uniform `uNeck`. Знаки как у Object3D.rotation. */
export function neckPose({
  pose,
  time,
  thinking,
  level,
}: NeckInput): [number, number, number, number] {
  const m = headMotion(time);
  const think = thinking ? 1 : 0;
  // «думает»: взгляд чуть вниз-в-сторону и наклон головы; говорит — лёгкие кивки по громкости
  const yaw = -BASE_YAW + pose[0] + m.yaw + think * Math.sin(time * 0.9) * 0.05;
  const pitch = pose[1] + m.pitch + think * 0.06 + level * 0.12;
  const roll = think * 0.05;
  return [yaw, pitch, roll, m.breath];
}

export interface LiveInput {
  /** Нормированный курсор −1…1 (сглаженный). */
  gaze: [number, number];
  smile: number;
  /** Раскрытие рта 0…1. */
  open: number;
  thinking: boolean;
}

/**
 * «Живость» лица (uniform `uLive`): взгляд — сдвиг зоны глаз (−1…1 → доли от 6 мм модели в шейдере),
 * подъём щёк от улыбки и речи, брови при «думает». Всё ограничено, чтобы не скатиться в карикатуру.
 */
export function livePose({
  gaze,
  smile,
  open,
  thinking,
}: LiveInput): [number, number, number, number] {
  const c = (x: number) => Math.max(-1, Math.min(1, x));
  return [
    c(gaze[0]),
    c(gaze[1]),
    clamp01(smile * 1.4 + open * 0.6),
    thinking ? 1 : clamp01(open * 0.4),
  ];
}
