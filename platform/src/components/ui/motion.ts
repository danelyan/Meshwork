import type { Transition } from 'motion/react';

/** Длительности в секундах; зеркало CSS-токенов --motion-fast/base/slow в styles/tokens.css. */
export const DURATION = { fast: 0.12, base: 0.18, slow: 0.26 } as const;
/** Та же кривая, что --ease. */
export const EASE = [0.65, 0, 0.25, 1] as const;

const t = (duration: number): Transition => ({ duration, ease: [...EASE] });

/** Пресеты появления/исчезновения для `<m.div {...preset}>` внутри AnimatePresence. */
export const presets = {
  /** Выпадашка/поповер: лёгкий сдвиг вниз и масштаб. */
  popover: {
    initial: { opacity: 0, y: -4, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -4, scale: 0.98 },
    transition: t(0.16),
  },
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: t(DURATION.base),
  },
  /** Сворачиваемый блок: высота 0 ↔ auto (overflow задаёт Reveal). */
  collapse: {
    initial: { height: 0, opacity: 0 },
    animate: { height: 'auto', opacity: 1 },
    exit: { height: 0, opacity: 0 },
    transition: t(DURATION.slow),
  },
  /** Новое сообщение в ленте. */
  listItem: {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0 },
    transition: t(DURATION.base),
  },
} as const;

export type MotionPreset = keyof typeof presets;
