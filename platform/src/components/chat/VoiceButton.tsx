'use client';

import { useState } from 'react';

import { MIC_HINT } from '../mic/micMode';
import micStyles from '../mic/mic.module.css';
import { MicGear, MicSettings } from '../mic/MicSettings';
import { useMicPress } from '../mic/useMicPress';
import { Spinner, cx } from '../ui';

import styles from './thread.module.css';
import { useVoiceInput } from './voice';

const PROVIDER_NOTE = {
  yandex: 'Распознаёт Yandex SpeechKit. Запись уходит на распознавание и не сохраняется.',
  browser: 'Распознаёт браузер (в Chrome - сервис Google). Мы запись не получаем и не храним.',
} as const;

const CONSENT_KEY = 'fsp.voice.ok';
function consentGiven(): boolean {
  try {
    return window.localStorage.getItem(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
}
function rememberConsent() {
  try {
    window.localStorage.setItem(CONSENT_KEY, '1');
  } catch {
    /* приватный режим — спросим ещё раз */
  }
}

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Кнопка микрофона в композере: первый клик — объяснение, зачем микрофон и кто распознаёт;
 * дальше запись (уровень сигнала кольцом, таймер), стоп → распознанный текст дописывается в поле
 * для правки. Сама не отправляет.
 */
export function VoiceButton({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  const [base, setBase] = useState('');
  const v = useVoiceInput((text, final) => {
    const joined = base ? `${base} ${text}` : text;
    onChange(final ? `${joined} `.trimStart() : joined);
  });
  const recording = v.state === 'recording';
  const begin = () => {
    setAsking(false);
    rememberConsent();
    setBase(value.trimEnd());
    v.start();
  };
  const press = useMicPress({
    recording,
    onStart: () => {
      v.clearError();
      if (!consentGiven()) return setAsking((a) => !a);
      begin();
    },
    onStop: () => {
      v.clearError();
      v.stop();
    },
  });
  if (!v.ready || v.hidden) return null;

  if (v.mode === 'off') {
    return (
      <button type="button" className={styles.iconBtn} disabled aria-label="Голосовой ввод недоступен" title={v.reason}>
        <MicIcon />
      </button>
    );
  }

  const note = PROVIDER_NOTE[v.mode];

  return (
    <span className={styles.voiceWrap}>
      <button
        type="button"
        className={cx(styles.iconBtn, micStyles.pressable, recording && styles.recording)}
        {...press.buttonProps}
        disabled={(disabled && !recording) || v.state === 'processing'}
        aria-pressed={recording}
        aria-label={recording ? 'Остановить запись' : 'Надиктовать голосом'}
        title={recording ? 'Остановить запись' : `${MIC_HINT[press.mode]}. ${note} Правая кнопка мыши — настройки.`}
        style={v.level !== null ? ({ '--level': v.level.toFixed(2) } as React.CSSProperties) : undefined}
        data-testid="voice-button"
      >
        {v.state === 'processing' ? <Spinner /> : recording ? <StopIcon /> : <MicIcon />}
      </button>
      <MicGear onClick={press.openMenu} />
      {press.menuOpen && <MicSettings onClose={press.closeMenu} />}
      {asking && (
        <span className={styles.voicePop} role="dialog" aria-label="Голосовой ввод">
          <span>Микрофон нужен, чтобы надиктовать сообщение: текст появится в поле, ты его поправишь и отправишь сам.</span>
          <small>{note}</small>
          <span className={styles.voiceActions}>
            <button type="button" className={styles.voiceGo} onClick={begin}>
              Начать запись
            </button>
            <button type="button" className={styles.quiet} onClick={() => setAsking(false)}>
              Не сейчас
            </button>
          </span>
        </span>
      )}
      {(recording || v.state === 'processing' || v.error) && (
        <span className={cx(styles.voiceStatus, v.error && styles.voiceError)} role={v.error ? 'alert' : 'status'}>
          {v.error ?? (recording ? `Запись ${mmss(v.elapsed)} · ${v.mode === 'browser' ? 'распознаёт браузер' : 'Yandex SpeechKit'} · ${press.mode === 'hold' ? 'отпусти, чтобы закончить' : 'нажми ещё раз, чтобы закончить'}` : 'Распознаю…')}
        </span>
      )}
    </span>
  );
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="square" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="3" width="10" height="10" fill="currentColor" />
    </svg>
  );
}
