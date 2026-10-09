'use client';

import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';

import { MarkFallback } from '@/components/avatar/MarkFallback';
import type { VoiceStatus } from '@/components/avatar/voice';

import styles from './preview.module.css';

const Head3D = dynamic(() => import('@/components/avatar/Head3D'), { ssr: false });

export function AvatarPreview() {
  const [mouth, setMouth] = useState(0);
  const [status, setStatus] = useState<VoiceStatus>('speaking');
  const level = useRef(0);
  level.current = mouth;
  const getLevel = () => level.current;
  return (
    <main className={styles.page}>
      <h1>Аватар компаньона</h1>
      <div className={styles.row}>
        <div className={styles.big}>
          <Head3D status={status} getLevel={getLevel} />
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
