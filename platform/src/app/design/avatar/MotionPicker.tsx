'use client';

import { createContext, type ReactNode, useContext, useState } from 'react';

import { HEAD_MOTION_MODES, type HeadMotionMode, isHeadMotionMode } from '@/components/avatar/head-motion';
import { Field } from '@/components/ui';

/** Движение наших голов — общее для всех панелей; по умолчанию то же, что в чате (слежение включено). */
const DEMO_DEFAULT: HeadMotionMode = 'alive';

const MotionContext = createContext<{ motion: HeadMotionMode; setMotion: (m: HeadMotionMode) => void }>({
  motion: DEMO_DEFAULT,
  setMotion: () => {},
});

export function MotionProvider({ children }: { children: ReactNode }) {
  const [motion, setMotion] = useState<HeadMotionMode>(DEMO_DEFAULT);
  return <MotionContext.Provider value={{ motion, setMotion }}>{children}</MotionContext.Provider>;
}

export function useHeadMotionMode(): HeadMotionMode {
  return useContext(MotionContext).motion;
}

export function MotionPicker() {
  const { motion, setMotion } = useContext(MotionContext);
  const info = HEAD_MOTION_MODES.find((m) => m.id === motion);
  return (
    <Field label="Движение (во всех панелях с нашей головой; drag складывается со слежением)" hint={info?.hint}>
      <select
        value={motion}
        onChange={(e) => {
          if (isHeadMotionMode(e.target.value)) setMotion(e.target.value);
        }}
      >
        {HEAD_MOTION_MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
