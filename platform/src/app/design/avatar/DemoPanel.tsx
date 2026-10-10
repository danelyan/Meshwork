'use client';

import dynamic from 'next/dynamic';
import { useState, type KeyboardEvent, type PointerEvent } from 'react';

import type { MouthShape } from '@/components/avatar/lipsync';
import type { VoiceStatus } from '@/components/avatar/voice';
import { Field, Kicker } from '@/components/ui';

import { GlassHead } from './GlassHead';
import { GridFrame } from './GridFrame';
import { OrbitState } from './orbit';
import styles from './preview.module.css';
import { VARIANTS, variantById, type MouthBus, type Variant } from './variants';

const Head3D = dynamic(() => import('@/components/avatar/Head3D'), { ssr: false });

export interface PanelSpeech {
  status: VoiceStatus;
  getLevel: () => number;
  getMouth?: () => MouthShape;
}

/** Одна панель сравнения: селект варианта и сцена. Рендерится только выбранный вариант, остальные не создаются. */
export function DemoPanel({ index, variantId, onChange, speech, bus }: {
  index: number;
  variantId: string;
  onChange: (id: string) => void;
  speech: PanelSpeech;
  bus: MouthBus;
}) {
  const variant = variantById(variantId);
  return (
    <section className={styles.panel} aria-label={`Панель ${index + 1}`}>
      <Field label={`Вариант ${index + 1}`}>
        <select value={variantId} onChange={(e) => onChange(e.target.value)}>
          {VARIANTS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </Field>
      {/* ключ = вариант: смена варианта пересоздаёт сцену и сбрасывает углы вращения */}
      <Stage key={variant.id} variant={variant} speech={speech} bus={bus} />
      <Kicker>{variant.kind === 'three' ? 'губы · вращение' : variant.kind === 'glass' ? 'губы · вращение · слежение' : 'только слежение'}</Kicker>
      <p className={styles.hint}>{variant.hint}</p>
    </section>
  );
}

function Stage({ variant, speech, bus }: { variant: Variant; speech: PanelSpeech; bus: MouthBus }) {
  const [orbit] = useState(() => new OrbitState());
  const [getOrbit] = useState(() => () => orbit.read(performance.now()));
  const rotatable = variant.kind !== 'grid';

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    orbit.begin(e.clientX, e.clientY, performance.now());
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => orbit.drag(e.clientX, e.clientY, performance.now());
  const onUp = () => orbit.end(performance.now());
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 0.15;
    if (e.key === 'ArrowLeft') orbit.nudge(-step, 0);
    else if (e.key === 'ArrowRight') orbit.nudge(step, 0);
    else if (e.key === 'ArrowUp') orbit.nudge(0, -step);
    else if (e.key === 'ArrowDown') orbit.nudge(0, step);
    else if (e.key === 'Home') orbit.reset();
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={variant.kind === 'three' ? `${styles.stage} ${styles.stageDark}` : styles.stage}
      {...(rotatable
        ? {
            role: 'group',
            tabIndex: 0,
            'aria-label': 'Голова: перетащите мышью или стрелками, Home — сброс',
            onPointerDown: onDown,
            onPointerMove: onMove,
            onPointerUp: onUp,
            onPointerCancel: onUp,
            onDoubleClick: () => orbit.reset(),
            onKeyDown: onKey,
            'data-rotatable': '',
          }
        : {})}
    >
      {variant.kind === 'three' && <Head3D status={speech.status} getLevel={speech.getLevel} getMouth={speech.getMouth} style={variant.style} getOrbit={getOrbit} />}
      {variant.kind === 'glass' && <GlassHead orbit={orbit} bus={bus} />}
      {variant.kind === 'grid' && <GridFrame source={variant.source} title={variant.label} />}
    </div>
  );
}
