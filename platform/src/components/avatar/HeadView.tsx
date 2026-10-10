'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

import styles from './avatar.module.css';
import { CHAT_HEAD_MOTION } from './head-motion';
import { DEFAULT_HEAD_STYLE, type HeadStyle, loadHeadStyle } from './head-styles';
import { MarkFallback } from './MarkFallback';
import { useCompanionVoice } from './voice';
import { hasWebGL } from './webgl';

const Head3D = dynamic(() => import('./Head3D'), { ssr: false, loading: () => null });

/**
 * Голова компаньона без рамки и кнопок — для сцен, где вокруг свой интерфейс. Читает ближайший
 * `CompanionVoiceProvider`; без WebGL — знак ФСП. Заполняет родителя (родитель задаёт размер).
 */
export function HeadView({ style: fixedStyle }: { style?: HeadStyle } = {}) {
  const voice = useCompanionVoice();
  const [gl, setGl] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [style, setStyle] = useState<HeadStyle>(fixedStyle ?? DEFAULT_HEAD_STYLE);
  useEffect(() => {
    setGl(hasWebGL());
    setReduced(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    setStyle(fixedStyle ?? loadHeadStyle());
  }, [fixedStyle]);
  if (!voice) return null;
  return (
    <div className={styles.fill} data-status={voice.status} data-testid="head-view">
      {gl ? (
        <Head3D status={voice.status} getLevel={voice.getLevel} getMouth={voice.getMouth} reducedMotion={reduced} style={style} motion={CHAT_HEAD_MOTION} lighting="studio" />
      ) : (
        <MarkFallback status={voice.status} getLevel={voice.getLevel} />
      )}
    </div>
  );
}
