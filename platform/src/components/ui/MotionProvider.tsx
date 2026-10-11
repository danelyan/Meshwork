'use client';

import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * Один раз в корне клиентской части: компоненты `m.*` подгружают набор domAnimation (~5 КБ), а
 * prefers-reduced-motion отключает transform/layout-анимации (opacity остаётся) через reducedMotion="user".
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
