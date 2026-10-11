'use client';

import { useEffect, useState } from 'react';

import styles from './avatar.module.css';
import { DEFAULT_HEAD_STYLE, type HeadStyle, loadHeadStyle } from './head-styles';
import { HeadSurface } from './HeadSurface';
import { useCompanionVoice } from './voice';

/**
 * Голова компаньона без рамки и кнопок – для сцен, где вокруг свой интерфейс. Читает ближайший
 * `CompanionVoiceProvider`; без WebGL – знак ФСП. Заполняет родителя (родитель задаёт размер).
 */
export function HeadView({ style: fixedStyle }: { style?: HeadStyle } = {}) {
  const voice = useCompanionVoice();
  const [reduced, setReduced] = useState(false);
  const [style, setStyle] = useState<HeadStyle>(fixedStyle ?? DEFAULT_HEAD_STYLE);
  useEffect(() => {
    setReduced(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    setStyle(fixedStyle ?? loadHeadStyle());
  }, [fixedStyle]);
  if (!voice) return null;
  return (
    <div className={styles.fill} data-status={voice.status} data-testid="head-view">
      <HeadSurface voice={voice} reduced={reduced} style={style} />
    </div>
  );
}
