'use client';

import dynamic from 'next/dynamic';
import { Component, type ReactNode, useCallback, useEffect, useState } from 'react';

import styles from './avatar.module.css';
import { CHAT_HEAD_MOTION } from './head-motion';
import type { HeadStyle } from './head-styles';
import { MarkFallback } from './MarkFallback';
import type { CompanionVoice } from './voice';
import { hasWebGL, resetWebGLCache } from './webgl';

// three.js (~0.5 МБ) — только в браузере и только там, где есть аватар.
const Head3D = dynamic(() => import('./Head3D'), { ssr: false, loading: () => null });

/**
 * Граница ошибок вокруг `<Canvas>`: R3F не создаёт WebGL-контекст (лимит ~16 контекстов на вкладки
 * браузера, отключённый GPU) — бросает ошибку при рендере. Проп `fallback` у `<Canvas>` для этого
 * не годится: он вложен в сам `<canvas>` и виден только браузеру без поддержки элемента.
 */
class CanvasGuard extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Голова компаньона с запасным знаком: пробует WebGL при каждом монтировании (отрицательный результат
 * не кэшируется), ловит ошибку создания контекста и `webglcontextlost`, в запасном режиме даёт кнопку
 * «обновить» — повторная проба и новая голова. `onLive` сообщает, рисуется ли сейчас голова.
 */
export function HeadSurface({ voice, reduced, style, onLive }: { voice: CompanionVoice; reduced: boolean; style: HeadStyle; onLive?: (live: boolean) => void }) {
  // До монтирования (SSR и первый кадр) — знак: проба нужна браузеру, а разметка должна совпасть.
  const [mode, setMode] = useState<'pending' | 'gl' | 'mark'>('pending');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setMode(hasWebGL() ? 'gl' : 'mark');
  }, [attempt]);
  useEffect(() => {
    onLive?.(mode === 'gl');
  }, [mode, onLive]);
  const lost = useCallback(() => {
    resetWebGLCache();
    setMode('mark');
  }, []);
  const retry = () => {
    resetWebGLCache();
    setMode('pending');
    setAttempt((a) => a + 1);
  };
  if (mode === 'gl') {
    return (
      <CanvasGuard key={attempt} onError={lost}>
        <Head3D status={voice.status} getLevel={voice.getLevel} getMouth={voice.getMouth} reducedMotion={reduced} style={style} motion={CHAT_HEAD_MOTION} lighting="studio" onContextLost={lost} />
      </CanvasGuard>
    );
  }
  return (
    <>
      <MarkFallback status={voice.status} getLevel={voice.getLevel} />
      {mode === 'mark' && (
        <button type="button" className={styles.retry} onClick={retry} title="Не удалось включить 3D-голову (в браузере слишком много вкладок с графикой?)">
          обновить
        </button>
      )}
    </>
  );
}
