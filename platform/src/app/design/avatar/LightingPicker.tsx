'use client';

import { createContext, type ReactNode, useContext, useState } from 'react';

import { isLightingPreset, LIGHTING_PRESETS, type LightingPreset } from '@/components/avatar/lighting';
import { Field } from '@/components/ui';

/** Свет сцены – общий для всех панелей с нашей головой; на демо по умолчанию «Студия», чтобы сравнивать с референсом. */
const DEMO_DEFAULT: LightingPreset = 'studio';

const LightingContext = createContext<{
  lighting: LightingPreset;
  setLighting: (l: LightingPreset) => void;
}>({
  lighting: DEMO_DEFAULT,
  setLighting: () => {},
});

export function LightingProvider({ children }: { children: ReactNode }) {
  const [lighting, setLighting] = useState<LightingPreset>(DEMO_DEFAULT);
  return <LightingContext.Provider value={{ lighting, setLighting }}>{children}</LightingContext.Provider>;
}

export function useLighting(): LightingPreset {
  return useContext(LightingContext).lighting;
}

export function LightingPicker() {
  const { lighting, setLighting } = useContext(LightingContext);
  const info = LIGHTING_PRESETS.find((p) => p.id === lighting);
  return (
    <Field label="Свет (во всех панелях с нашей головой; в чате пока «Как сейчас»)" hint={info?.hint}>
      <select
        value={lighting}
        onChange={(e) => {
          if (isLightingPreset(e.target.value)) setLighting(e.target.value);
        }}
      >
        {LIGHTING_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
