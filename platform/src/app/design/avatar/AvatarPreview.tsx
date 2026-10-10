'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_HEAD_STYLE } from '@/components/avatar/head-styles';
import { CLOSED, type MouthShape } from '@/components/avatar/lipsync';
import { mouthOpen } from '@/components/avatar/level';
import { MarkFallback } from '@/components/avatar/MarkFallback';
import { CompanionVoiceProvider, useCompanionVoice, type VoiceStatus } from '@/components/avatar/voice';
import { Button, Chip, Field, Kicker } from '@/components/ui';

import { DemoPanel } from './DemoPanel';
import { MotionPicker, MotionProvider } from './MotionPicker';
import { MouthLookPicker, MouthLookProvider } from './MouthLookPicker';
import styles from './preview.module.css';
import type { MouthBus, MouthSink } from './variants';

const SAMPLE = 'Привет! Я компаньон платформы ФСП. Помогу пройти тест, собрать профиль и попасть в подборку работодателя.';
const MAX_PANELS = 4;
/** По умолчанию: основное «Плетение» рядом с его версиями (на экране сейчас только они, см. variants.ts). */
const DEFAULT_VARIANTS = [`three-${DEFAULT_HEAD_STYLE}`, 'three-weave9'];

export function AvatarPreview() {
  return (
    <CompanionVoiceProvider>
      <MouthLookProvider>
        <MotionProvider>
          <Preview />
        </MotionProvider>
      </MouthLookProvider>
    </CompanionVoiceProvider>
  );
}

function Preview() {
  const voice = useCompanionVoice();
  const [text, setText] = useState(SAMPLE);
  const [mouth, setMouth] = useState(0);
  const [status, setStatus] = useState<VoiceStatus>('speaking');
  const [count, setCount] = useState(2);
  const [variants, setVariants] = useState<string[]>(DEFAULT_VARIANTS);
  const level = useRef(0);
  level.current = mouth;
  // пока звучит озвучка — громкость и состояние берём у голоса, иначе — ручные ползунок и select
  const live = voice != null && voice.status !== 'idle';
  const getLevel = live ? voice.getLevel : () => level.current;
  const shown: VoiceStatus = live ? voice.status : status;
  const getMouth = live ? voice.getMouth : undefined;

  // Один источник формы рта на все панели, которым нужен «толчок» (стеклянная голова): наши Head3D тянут сами.
  const sinks = useRef(new Set<MouthSink>());
  const bus = useMemo<MouthBus>(() => ({ subscribe: (sink) => { sinks.current.add(sink); return () => { sinks.current.delete(sink); }; } }), []);
  const sourceRef = useRef({ live, shown, voice, getMouth });
  sourceRef.current = { live, shown, voice, getMouth };
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const src = sourceRef.current;
      if (sinks.current.size > 0) {
        let shape: MouthShape = CLOSED;
        if (src.shown === 'speaking') shape = src.live && src.getMouth ? src.getMouth() : { ...CLOSED, open: mouthOpen(level.current) };
        sinks.current.forEach((sink) => sink(shape));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

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

  const speech = { status: shown, getLevel, getMouth };
  return (
    <main id="main" className={styles.page}>
      <h1>Аватар компаньона: сравнение вариантов</h1>
      <p className={styles.hint}>Тяните голову мышью, чтобы повернуть (двойной клик или Home — сброс). «Проговорить» запускает озвучку один раз, губы двигаются во всех панелях, где они есть.</p>
      <div className={styles.row} role="group" aria-label="Число панелей">
        <Kicker>Панелей</Kicker>
        {Array.from({ length: MAX_PANELS }, (_, i) => i + 1).map((n) => (
          <Chip key={n} pressed={n === count} onClick={() => setCount(n)}>
            {n}
          </Chip>
        ))}
      </div>
      <div className={styles.panels} style={{ '--cols': count === 3 ? 3 : Math.min(count, 2) } as React.CSSProperties} data-count={count}>
        {variants.slice(0, count).map((id, i) => (
          <DemoPanel
            key={i}
            index={i}
            variantId={id}
            onChange={(next) => setVariants((prev) => prev.map((v, j) => (j === i ? next : v)))}
            speech={speech}
            bus={bus}
          />
        ))}
      </div>
      <div className={styles.controls}>
        <Field label="Текст для озвучки (SpeechKit, как в чате)">
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        <div className={styles.row}>
          <Button variant="primary" onClick={() => voice?.replay(text)} disabled={!text.trim() || !voice}>
            Проговорить
          </Button>
          <Button onClick={() => voice?.stop()} disabled={!live}>
            Остановить
          </Button>
          <span className={styles.hint} data-testid="viseme" ref={bandsRef}>
            {voice?.notice ?? (live ? `${voice?.status} · висема ${viseme}` : '')}
          </span>
        </div>
        <Field label={`Громкость (RMS) ${mouth.toFixed(2)} — вручную, когда озвучка молчит или недоступна`}>
          <input type="range" min={0} max={0.3} step={0.01} value={mouth} onChange={(e) => setMouth(Number(e.target.value))} />
        </Field>
        <MouthLookPicker />
        <MotionPicker />
        <Field label="Состояние (влияет на наши головы; у Карины статуса нет)">
          <select value={status} onChange={(e) => setStatus(e.target.value as VoiceStatus)}>
            <option value="idle">idle</option>
            <option value="thinking">thinking</option>
            <option value="speaking">speaking</option>
          </select>
        </Field>
        <div className={styles.small}>
          <MarkFallback status={shown} getLevel={getLevel} />
        </div>
      </div>
    </main>
  );
}
