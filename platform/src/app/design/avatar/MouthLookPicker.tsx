'use client';

import { createContext, type ReactNode, useContext, useState } from 'react';

import { DEFAULT_MOUTH_LOOK, isMouthLook, MOUTH_LOOKS, type MouthLook } from '@/components/avatar/mouth-looks';
import { Field } from '@/components/ui';

/** Вид открытого рта — общий для всех панелей с нашей головой, выбирается одним select'ом под ползунком рта. */
const MouthLookContext = createContext<{ look: MouthLook; setLook: (look: MouthLook) => void }>({
  look: DEFAULT_MOUTH_LOOK,
  setLook: () => {},
});

export function MouthLookProvider({ children }: { children: ReactNode }) {
  const [look, setLook] = useState<MouthLook>(DEFAULT_MOUTH_LOOK);
  return <MouthLookContext.Provider value={{ look, setLook }}>{children}</MouthLookContext.Provider>;
}

export function useMouthLook(): MouthLook {
  return useContext(MouthLookContext).look;
}

export function MouthLookPicker() {
  const { look, setLook } = useContext(MouthLookContext);
  const info = MOUTH_LOOKS.find((l) => l.id === look);
  return (
    <Field label="Рот (вид внутри, когда открыт; во всех панелях с нашей головой)" hint={info?.hint}>
      <select
        value={look}
        onChange={(e) => {
          if (isMouthLook(e.target.value)) setLook(e.target.value);
        }}
      >
        {MOUTH_LOOKS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
