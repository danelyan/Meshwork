'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';

import styles from './telemetry.module.css';
import {
  clear,
  events,
  getVersion,
  isPaused,
  itemSpans,
  setPaused,
  setTelemetryEnabled,
  type Stamped,
  subscribe,
  type TelemetryEvent,
  turnStats,
} from './telemetry';

type Kind = TelemetryEvent['k'];
const KINDS: Kind[] = ['turn', 'sse', 'item', 'stream', 'anim', 'layout', 'longtask', 'render', 'scroll', 'flake'];
const LABEL: Record<Kind, string> = {
  turn: 'ход',
  sse: 'sse',
  item: 'лента',
  stream: 'стрим',
  anim: 'анимация',
  layout: 'сдвиг',
  longtask: 'long task',
  render: 'рендер',
  scroll: 'скролл',
  flake: 'флейк',
};
const ROWS = 200;

const ms = (v?: number) => (v === undefined ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)}с` : `${Math.round(v)}мс`);

function describe(e: Stamped): string {
  switch (e.k) {
    case 'sse':
      return e.hb ? `heartbeat · +${e.gap}мс` : `${e.ev} · ${e.bytes} зн · +${e.gap}мс`;
    case 'turn':
      return [e.phase, e.ms !== undefined ? ms(e.ms) : '', e.note ?? '', e.conv ? `conv ${e.conv.slice(0, 8)}` : ''].filter(Boolean).join(' · ');
    case 'item':
      return `${e.op} ${e.kind} ${e.id}${e.reason ? ` · ${e.reason}` : ''}`;
    case 'stream':
      return `${e.id} · ${e.shown}/${e.acc} зн · lag ${e.lag} зн ≈ ${ms(e.lagMs)} · показ ${e.showCps} зн/с · приход ${e.inCps} зн/с`;
    case 'anim':
      return `${e.what}${e.ms !== undefined ? ` · ${ms(e.ms)}` : ''}${e.id ? ` · ${e.id}` : ''}`;
    case 'layout':
      return `CLS +${e.value}${e.sources ? ` · ${e.sources}` : ''}`;
    case 'longtask':
      return `${e.ms}мс главный поток занят`;
    case 'render':
      return `${e.n} коммитов Chat за ход`;
    case 'scroll':
      return e.what === 'auto' ? 'автоскролл вниз' : e.what === 'away' ? 'человек ушёл от низа' : 'снова внизу';
    case 'flake':
      return `${e.what}${e.id ? ` ${e.id}` : ''}${e.detail ? ` · ${e.detail}` : ''}`;
  }
}

/** Плавающая панель телеметрии чата: сводка хода, живая лента событий, таймлайн элементов. */
export function TelemetryPanel() {
  useSyncExternalStore(subscribe, getVersion, () => 0);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<'events' | 'items'>('events');
  const [hidden, setHidden] = useState<Set<Kind>>(() => new Set<Kind>(['scroll']));
  const [copied, setCopied] = useState(false);
  const s = turnStats();
  const all = events();
  const turnStarts = useMemo(() => new Map<number, number>(), []);
  for (const e of all) if (e.k === 'turn' && e.phase === 'start') turnStarts.set(e.turn, e.t);
  const rows = all.filter((e) => !hidden.has(e.k)).slice(-ROWS).reverse();
  const spans = itemSpans().slice(-60).reverse();
  const paused = isPaused();

  const toggle = (k: Kind) =>
    setHidden((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const copy = async () => {
    const json = JSON.stringify({ stats: s, items: itemSpans(), events: all }, null, 1);
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      console.info('[telemetry]', json);
    }
  };

  const chip = (
    <>
      <span className={styles.dot} data-live={s.status === 'running' || undefined} aria-hidden="true" />
      <span>TTFT {ms(s.ttft)}</span>
      <span>{s.showCps} зн/с</span>
      <span>lag {s.maxLag}</span>
      <span>CLS {s.cls.toFixed(3)}</span>
      <span className={s.flakes ? styles.bad : undefined}>флейки {s.flakes}</span>
    </>
  );

  if (!open) {
    return (
      <div className={styles.dock} data-telemetry-panel>
        <button type="button" className={styles.chip} onClick={() => setOpen(true)} aria-label="Развернуть телеметрию чата">
          {chip}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.dock} data-telemetry-panel>
      <section className={styles.panel} aria-label="Телеметрия чата">
        <header className={styles.head}>
          <span className={styles.title}>
            <span className={styles.dot} data-live={s.status === 'running' || undefined} aria-hidden="true" />
            Телеметрия · ход {s.turn || '—'} · {s.status === 'running' ? 'идёт' : s.status}
          </span>
          <span className={styles.actions}>
            <button type="button" onClick={() => setPaused(!paused)} aria-pressed={paused}>
              {paused ? 'дальше' : 'пауза'}
            </button>
            <button type="button" onClick={clear}>очистить</button>
            <button type="button" onClick={() => void copy()}>{copied ? 'скопировано' : 'json'}</button>
            <button type="button" onClick={() => setOpen(false)} aria-label="Свернуть">—</button>
            <button type="button" onClick={() => setTelemetryEnabled(false)} aria-label="Выключить телеметрию">×</button>
          </span>
        </header>

        <dl className={styles.stats}>
          <Stat k="TTFT" v={ms(s.ttft)} />
          <Stat k="до done" v={ms(s.doneMs)} />
          <Stat k="приход" v={`${s.inCps} зн/с`} />
          <Stat k="показ" v={`${s.showCps} зн/с`} />
          <Stat k="max lag" v={`${s.maxLag} зн · ${ms(s.maxLagMs)}`} />
          <Stat k="кадры" v={`${s.frames} · hb ${s.heartbeats}`} />
          <Stat k="дельты" v={`${s.deltas} · discard ${s.discards}`} />
          <Stat k="CLS хода" v={s.cls.toFixed(4)} bad={s.cls > 0.05} />
          <Stat k="long tasks" v={String(s.longtasks)} bad={s.longtasks > 0} />
          <Stat k="рендеры" v={String(s.renders)} />
          <Stat k="флейки" v={String(s.flakes)} bad={s.flakes > 0} />
        </dl>

        <div className={styles.tabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'events'} onClick={() => setTab('events')}>
            события {all.length}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'items'} onClick={() => setTab('items')}>
            элементы {spans.length}
          </button>
        </div>

        {tab === 'events' ? (
          <>
            <div className={styles.filters}>
              {KINDS.map((k) => (
                <button key={k} type="button" className={styles.filter} data-k={k} aria-pressed={!hidden.has(k)} onClick={() => toggle(k)}>
                  {LABEL[k]}
                </button>
              ))}
            </div>
            <ol className={styles.log}>
              {rows.map((e) => (
                <li key={`${e.t}-${e.k}`} className={styles.row} data-k={e.k}>
                  <span className={styles.time}>+{((e.t - (turnStarts.get(e.turn) ?? e.t)) / 1000).toFixed(3)}s</span>
                  <span className={styles.tag} data-k={e.k}>{LABEL[e.k]}</span>
                  <span className={styles.text}>{describe(e)}</span>
                </li>
              ))}
              {rows.length === 0 && <li className={styles.empty}>Отправь сообщение — ход появится здесь.</li>}
            </ol>
          </>
        ) : (
          <ol className={styles.log}>
            {spans.map((sp) => {
              const t0 = turnStarts.get(sp.turn) ?? sp.appear;
              const life = sp.disappear !== undefined ? sp.disappear - sp.appear : undefined;
              return (
                <li key={`${sp.id}-${sp.appear}`} className={styles.row} data-flake={sp.flake ? '' : undefined}>
                  <span className={styles.time}>+{((sp.appear - t0) / 1000).toFixed(3)}s</span>
                  <span className={styles.tag} data-k={sp.flake ? 'flake' : 'item'}>{sp.kind}</span>
                  <span className={styles.text}>
                    {sp.id} · {life === undefined ? 'на месте' : `исчез через ${ms(life)}`}
                    {sp.updates ? ` · обновлений ${sp.updates}` : ''}
                    {sp.flake ? ` · ${sp.flake}` : ''}
                  </span>
                </li>
              );
            })}
            {spans.length === 0 && <li className={styles.empty}>Элементы ленты пока не появлялись.</li>}
          </ol>
        )}
      </section>
    </div>
  );
}

function Stat({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className={styles.stat}>
      <dt>{k}</dt>
      <dd className={bad ? styles.bad : undefined}>{v}</dd>
    </div>
  );
}
