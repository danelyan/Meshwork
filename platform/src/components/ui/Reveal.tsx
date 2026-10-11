'use client';

import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { type ComponentPropsWithoutRef, type Ref } from 'react';

import { type MotionPreset, presets } from './motion';

export type RevealProps = Omit<ComponentPropsWithoutRef<'div'>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd'> & {
  /** Показан ли блок; при false он уходит с анимацией и удаляется из DOM. */
  open: boolean;
  preset?: MotionPreset;
  /** Не играть появление при первом рендере, если блок уже открыт (история ленты). */
  initialOpen?: boolean;
  ref?: Ref<HTMLDivElement>;
};

/**
 * Появление/исчезновение блока: `<AnimatePresence>` + `m.div` с пресетом из motion.ts.
 * className, id, role, aria-*, ref и прочие props уходят на сам div. Для `collapse` добавляется overflow: hidden.
 */
export function Reveal({ open, preset = 'fade', initialOpen = true, style, children, ref, ...rest }: RevealProps) {
  const p = presets[preset];
  return (
    <AnimatePresence initial={initialOpen}>
      {open && (
        <m.div ref={ref} {...rest} initial={p.initial} animate={p.animate} exit={p.exit} transition={p.transition} style={preset === 'collapse' ? { overflow: 'hidden', ...style } : style}>
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
}

/** Выпадающая панель (меню, уведомления): Reveal с пресетом popover. */
export function Popover(props: Omit<RevealProps, 'preset'>) {
  return <Reveal {...props} preset="popover" />;
}
