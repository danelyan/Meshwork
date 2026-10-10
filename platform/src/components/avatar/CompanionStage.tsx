'use client';

import { type MouseEvent, useEffect, useState } from 'react';

import { cx } from '../ui';

import styles from './avatar.module.css';
import { DEFAULT_HEAD_STYLE, HEAD_STYLES, type HeadStyle, loadHeadStyle, saveHeadStyle } from './head-styles';
import { HeadSurface } from './HeadSurface';
import { type CompanionVoice, useCompanionVoice, type VoiceStatus } from './voice';

const STATE_LABEL: Record<VoiceStatus, string> = { idle: '', thinking: 'думает', loading: 'готовит голос', speaking: 'говорит' };

/**
 * Аватар компаньона у ленты: серебристая голова-сетка (WebGL) или знак ФСП (без WebGL) и
 * переключатель «Озвучивать ответы» (выключен по умолчанию; первый клик разблокирует звук).
 * ПКМ по голове — меню вида головы (head-styles.ts), выбор запоминается в localStorage.
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
  const [style, setStyle] = useState<HeadStyle>(DEFAULT_HEAD_STYLE);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    setReduced(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    setStyle(loadHeadStyle());
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);
  const { status, enabled, notice, available } = voice;
  const openMenu = (e: MouseEvent) => {
    if (!gl) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };
  const pick = (next: HeadStyle) => {
    setStyle(next);
    saveHeadStyle(next);
    setMenu(null);
  };

  return (
    <aside className={cx(styles.stage, className)} aria-label="Компаньон" data-testid="companion-stage">
      <div className={styles.screen} data-status={status} onContextMenu={openMenu} title={gl ? 'Правый клик — вид головы' : undefined}>
        <HeadSurface voice={voice} reduced={reduced} style={style} onLive={setGl} />
      </div>
      {menu && (
        <ul className={styles.menu} role="menu" aria-label="Вид головы" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          {HEAD_STYLES.map((s) => (
            <li key={s.id} role="none">
              <button type="button" role="menuitemradio" aria-checked={s.id === style} onClick={() => pick(s.id)} title={s.hint}>
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
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
export function ReplayButton({ text, speakKey }: { text: string; speakKey?: string }) {
  const voice = useCompanionVoice();
  if (!voice || voice.available === false || !text.trim()) return null;
  return (
    <button type="button" className={styles.replay} onClick={() => voice.replay(text, speakKey)} aria-label="Озвучить ответ">
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
