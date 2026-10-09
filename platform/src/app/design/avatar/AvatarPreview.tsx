'use client';

import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';

import { DEFAULT_HEAD_STYLE, HEAD_STYLES, type HeadStyle } from '@/components/avatar/head-styles';
import { MarkFallback } from '@/components/avatar/MarkFallback';
import type { VoiceStatus } from '@/components/avatar/voice';

import styles from './preview.module.css';

const Head3D = dynamic(() => import('@/components/avatar/Head3D'), { ssr: false });

export function AvatarPreview() {
  const [mouth, setMouth] = useState(0);
  const [status, setStatus] = useState<VoiceStatus>('speaking');
  const [style, setStyle] = useState<HeadStyle>(DEFAULT_HEAD_STYLE);
  const info = HEAD_STYLES.find((s) => s.id === style);
  const level = useRef(0);
  level.current = mouth;
  const getLevel = () => level.current;
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
          <Head3D status={status} getLevel={getLevel} style={style} />
        </div>
        <div className={styles.small}>
          <MarkFallback status={status} getLevel={getLevel} />
        </div>
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
