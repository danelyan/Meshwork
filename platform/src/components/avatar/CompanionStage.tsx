'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

import { cx } from '../ui';

import styles from './avatar.module.css';
import { MarkFallback } from './MarkFallback';
import { type CompanionVoice, useCompanionVoice, type VoiceStatus } from './voice';
import { hasWebGL } from './webgl';

// three.js (~0.5 МБ) — только в браузере и только там, где есть аватар.
const Head3D = dynamic(() => import('./Head3D'), { ssr: false, loading: () => null });

const STATE_LABEL: Record<VoiceStatus, string> = { idle: '', thinking: 'думает', loading: 'готовит голос', speaking: 'говорит' };

/**
 * Аватар компаньона у ленты: серебристая голова-сетка (WebGL) или знак ФСП (без WebGL) и
 * переключатель «Озвучивать ответы» (выключен по умолчанию; первый клик разблокирует звук).
 * `dock` — на широком экране закреплён слева от колонки ленты, на узком стоит в потоке над лентой.
 * Без провайдера голоса (`CompanionVoiceProvider`) ничего не рисует.
 */
export function CompanionStage({ dock = true, className }: { dock?: boolean; className?: string }) {
  const voice = useCompanionVoice();
  if (!voice) return null;
  return <Stage voice={voice} className={cx(dock && styles.dock, className)} />;
}

function Stage({ voice, className }: { voice: CompanionVoice; className?: string }) {
  // До монтирования (SSR и первый кадр) — знак: детектор WebGL нужен браузеру, а разметка должна совпасть.
  const [gl, setGl] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setGl(hasWebGL());
    setReduced(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);
  const { status, enabled, notice, available } = voice;

  return (
    <aside className={cx(styles.stage, className)} aria-label="Компаньон" data-testid="companion-stage">
      <div className={styles.screen} data-status={status}>
        {gl ? <Head3D status={status} getLevel={voice.getLevel} reducedMotion={reduced} /> : <MarkFallback status={status} getLevel={voice.getLevel} />}
      </div>
      <div className={styles.controls}>
        <button type="button" className={styles.toggle} aria-pressed={enabled} onClick={voice.toggle} disabled={available === false}>
          <SpeakerIcon muted={!enabled} />
          Озвучивать ответы
        </button>
        <span className={styles.state} role="status" aria-live="polite">
          {STATE_LABEL[status]}
        </span>
        {status === 'speaking' && (
          <button type="button" className={styles.stop} onClick={voice.stop}>
            Остановить
          </button>
        )}
        {notice && <p className={styles.notice}>{notice}</p>}
      </div>
    </aside>
  );
}

/** «Озвучить» у реплики компаньона: повтор по клику, работает и при выключенной автоозвучке. */
export function ReplayButton({ text }: { text: string }) {
  const voice = useCompanionVoice();
  if (!voice || voice.available === false || !text.trim()) return null;
  return (
    <button type="button" className={styles.replay} onClick={() => voice.replay(text)} aria-label="Озвучить ответ">
      <SpeakerIcon />
      озвучить
    </button>
  );
}

function SpeakerIcon({ muted }: { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      {muted ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19.5 5.5a9 9 0 0 1 0 13" />}
    </svg>
  );
}
