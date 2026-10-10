'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { Bubble } from '../chat/Thread';
import { cx } from '../ui';

import styles from './speaking.module.css';
import { phraseAt, splitPhrases } from './phrases';
import { type CompanionVoice, useCompanionVoice, type VoiceStatus } from './voice';

export const STATE_LABEL: Record<VoiceStatus, string> = { idle: '', thinking: 'думает', loading: 'готовит голос', speaking: 'говорит' };

/** Индекс звучащей фразы: опрос прогресса раз в кадр, state меняется только при смене фразы. */
function useActivePhrase(voice: CompanionVoice | null, phrases: readonly string[], on: boolean): number {
  const [active, setActive] = useState(-1);
  const getProgress = voice?.getProgress;
  useEffect(() => {
    if (!on || !getProgress || phrases.length === 0) {
      setActive(-1);
      return;
    }
    let raf = 0;
    const loop = () => {
      setActive(phraseAt(phrases, getProgress()));
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [on, getProgress, phrases]);
  return active;
}

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

/**
 * Пузырь реплики консультанта в ленте. Пока именно эта реплика звучит: пульс рамки, значок динамика
 * и полоска фраз (активная светлее). Вне провайдера голоса — обычный пузырь.
 */
export function SpeakingBubble({ text, children }: { text: string; children: React.ReactNode }) {
  const voice = useCompanionVoice();
  const mine = voice?.status === 'speaking' && voice.speakingText === text;
  const phrases = useMemo(() => (mine ? splitPhrases(text) : []), [mine, text]);
  const active = useActivePhrase(voice, phrases, mine);
  return (
    <Bubble speaking={mine}>
      {children}
      {mine && (
        <span className={styles.bubbleMeta} data-testid="speaking-meta">
          <span className={styles.speakerIcon}>
            <SpeakerIcon />
          </span>
          <span className={styles.strip} role="img" aria-label="Ход озвучки по фразам">
            {phrases.map((p, i) => (
              <i key={i} className={cx(i < active && styles.done, i === active && styles.now)} style={{ flexGrow: p.length }} />
            ))}
          </span>
        </span>
      )}
    </Bubble>
  );
}

/** Живые субтитры: фразы последней озвученной реплики, активная подсвечена, видно предыдущую и следующую. */
export function Subtitles({ className }: { className?: string }) {
  const voice = useCompanionVoice();
  const lastText = useRef('');
  if (voice?.speakingText) lastText.current = voice.speakingText;
  const text = voice?.speakingText ?? lastText.current;
  const phrases = useMemo(() => splitPhrases(text), [text]);
  const live = voice?.status === 'speaking';
  const polled = useActivePhrase(voice, phrases, live);
  const active = live ? polled : voice?.status === 'loading' ? -1 : phrases.length - 1;
  if (!voice || phrases.length === 0) return <div className={cx(styles.subtitles, className)} data-testid="subtitles" />;
  const from = Math.max(0, Math.min(active, phrases.length - 1) - 1);
  const shown = phrases.slice(from, from + 3);
  return (
    <div className={cx(styles.subtitles, className)} data-testid="subtitles" aria-hidden="true">
      {shown.map((p, k) => (
        <span key={`${from + k}-${p}`} className={cx(styles.phrase, from + k === active && styles.phraseActive)}>
          {p}{' '}
        </span>
      ))}
    </div>
  );
}

/** Чип состояния «думает / говорит». */
export function StateChip({ className }: { className?: string }) {
  const voice = useCompanionVoice();
  const status = voice?.status ?? 'idle';
  return (
    <span className={cx(styles.chip, className)} data-status={status} role="status" aria-live="polite" data-testid="state-chip">
      {STATE_LABEL[status] || 'слушает'}
    </span>
  );
}

/** Переключатель звука: «без звука» пока озвучка идёт, «включить звук» пока нет. */
export function MuteToggle({ className }: { className?: string }) {
  const voice = useCompanionVoice();
  if (!voice || voice.available === false) return null;
  return (
    <button type="button" data-voice-toggle className={cx(styles.mute, className)} aria-pressed={voice.enabled} onClick={voice.toggle}>
      {voice.enabled ? 'без звука' : 'включить звук'}
    </button>
  );
}

/** Кнопка «стоп» — только пока звучит. */
export function StopButton({ className }: { className?: string }) {
  const voice = useCompanionVoice();
  if (!voice || (voice.status !== 'speaking' && voice.status !== 'loading')) return null;
  return (
    <button type="button" className={cx(styles.stopBtn, className)} onClick={voice.stop}>
      стоп
    </button>
  );
}
