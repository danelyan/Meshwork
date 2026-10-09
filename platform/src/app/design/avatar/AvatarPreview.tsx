'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';

import { DEFAULT_HEAD_STYLE, HEAD_STYLES, type HeadStyle } from '@/components/avatar/head-styles';
import { MarkFallback } from '@/components/avatar/MarkFallback';
import { CompanionVoiceProvider, useCompanionVoice, type VoiceStatus } from '@/components/avatar/voice';

import styles from './preview.module.css';

const Head3D = dynamic(() => import('@/components/avatar/Head3D'), { ssr: false });

const SAMPLE = 'Привет! Я компаньон платформы ФСП. Помогу пройти тест, собрать профиль и попасть в подборку работодателя.';

export function AvatarPreview() {
  return (
    <CompanionVoiceProvider>
      <Preview />
    </CompanionVoiceProvider>
  );
}

function Preview() {
  const voice = useCompanionVoice();
  const [text, setText] = useState(SAMPLE);
  const [mouth, setMouth] = useState(0);
  const [status, setStatus] = useState<VoiceStatus>('speaking');
  const [style, setStyle] = useState<HeadStyle>(DEFAULT_HEAD_STYLE);
  const info = HEAD_STYLES.find((s) => s.id === style);
  const level = useRef(0);
  level.current = mouth;
  // пока звучит озвучка — громкость и состояние берём у голоса, иначе — ручные ползунок и select
  const live = voice?.status !== 'idle';
  const getLevel = live ? voice!.getLevel : () => level.current;
  const shown = live ? voice!.status : status;
  // текущая висема — для калибровки липсинка (обновляется ~20 раз в секунду, пока звучит)
  const [viseme, setViseme] = useState('sil');
  const bandsRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (voice?.status !== 'speaking') return;
    const id = window.setInterval(() => {
      setViseme(voice.getViseme());
      const f = voice.getFeatures();
      bandsRef.current?.setAttribute('data-bands', f ? [...f.bands, f.volume, f.centroid].map((v) => v.toFixed(3)).join(' ') : '');
    }, 50);
    return () => window.clearInterval(id);
  }, [voice]);
  return (
    <main className={styles.page}>
      <h1>Аватар компаньона</h1>
      <div className={styles.styles} role="radiogroup" aria-label="Вид головы">
        {HEAD_STYLES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={s.id === style}
            className={styles.styleBtn}
            onClick={() => setStyle(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className={styles.hint}>{info?.hint}</p>
      <div className={styles.row}>
        <div className={styles.big}>
          <Head3D status={shown} getLevel={getLevel} getMouth={live ? voice?.getMouth : undefined} style={style} />
        </div>
        <div className={styles.small}>
          <MarkFallback status={shown} getLevel={getLevel} />
        </div>
      </div>
      <label className={styles.ctrl}>
        Текст для озвучки (SpeechKit, как в чате)
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className={styles.row}>
        <button type="button" className={styles.styleBtn} onClick={() => voice?.replay(text)} disabled={!text.trim()}>
          Проговорить
        </button>
        <button type="button" className={styles.styleBtn} onClick={() => voice?.stop()} disabled={!live}>
          Остановить
        </button>
        <span className={styles.hint} data-testid="viseme" ref={bandsRef}>
          {voice?.notice ?? (live ? `${voice?.status} · висема ${viseme}` : '')}
        </span>
      </div>
      <label className={styles.ctrl}>
        Громкость (RMS) {mouth.toFixed(2)}
        <input type="range" min={0} max={0.3} step={0.01} value={mouth} onChange={(e) => setMouth(Number(e.target.value))} />
      </label>
      <label className={styles.ctrl}>
        Состояние
        <select value={status} onChange={(e) => setStatus(e.target.value as VoiceStatus)}>
          <option value="idle">idle</option>
          <option value="thinking">thinking</option>
          <option value="speaking">speaking</option>
        </select>
      </label>
    </main>
  );
}
