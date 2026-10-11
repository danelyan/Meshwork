/**
 * Телеметрия чата консультанта — инструмент отладки UX (docs/platform.md, «Телеметрия чата»).
 * Чистый TS без React. Выключена по умолчанию: `track` тогда — одна проверка флага и выход.
 * Включение: localStorage['fsp:telemetry'] = '1', `?telemetry=1` в URL или переключатель в дебаг-панели.
 */

export type ItemKind = 'reply' | 'user' | 'claims' | 'ask' | 'recommendations' | 'step' | 'queue' | 'error' | 'skeleton' | 'typing' | 'call_offer' | string;

export type TelemetryEvent =
  | { k: 'sse'; ev: string; bytes: number; gap: number; hb?: boolean }
  | { k: 'turn'; phase: 'start' | 'first-event' | 'first-delta' | 'done' | 'error' | 'stop'; conv?: string; ms?: number; note?: string }
  | { k: 'item'; op: 'appear' | 'update' | 'disappear'; id: string; kind: ItemKind; reason?: string }
  | { k: 'stream'; id: string; acc: number; shown: number; lag: number; lagMs: number; showCps: number; inCps: number }
  | { k: 'anim'; what: string; ms?: number; id?: string }
  | { k: 'layout'; value: number; sources?: string }
  | { k: 'longtask'; ms: number }
  | { k: 'render'; n: number }
  | { k: 'scroll'; what: 'auto' | 'away' | 'back' }
  | { k: 'flake'; what: 'blink' | 'replaced' | 'discard' | 'remount' | 'reveal-jump'; id?: string; detail?: string };

/** `n` — сквозной номер (ключ строки в панели), `t` — performance.now(), `turn` — номер хода. */
export type Stamped = TelemetryEvent & { n: number; t: number; turn: number };

export interface TurnStats {
  turn: number;
  conv?: string;
  start: number;
  ttft?: number;
  firstEvent?: number;
  doneMs?: number;
  status: 'idle' | 'running' | 'done' | 'error' | 'stop';
  frames: number;
  heartbeats: number;
  bytes: number;
  deltas: number;
  discards: number;
  cls: number;
  longtasks: number;
  renders: number;
  flakes: number;
  maxLag: number;
  maxLagMs: number;
  showCps: number;
  inCps: number;
}

export interface ItemSpan {
  id: string;
  kind: ItemKind;
  turn: number;
  appear: number;
  disappear?: number;
  updates: number;
  flake?: string;
}

const STORE_KEY = 'fsp:telemetry';
export const TELEMETRY_EVENT = 'fsp:telemetry';
const CAP = 500;
/** Появился и исчез быстрее — «мелькнул». */
export const BLINK_MS = 300;
const SAMPLE_MS = 200;

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());

let enabled = false;
let paused = false;
const ring: (Stamped | undefined)[] = new Array(CAP);
let head = 0;
let count = 0;
let seqNo = 0;
let turnNo = 0;
let stats: TurnStats = emptyStats(0, 0);
let lastFrameAt = 0;
const spans = new Map<string, ItemSpan>();
const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let version = 0;

function emptyStats(turn: number, start: number): TurnStats {
  return { turn, start, status: turn ? 'running' : 'idle', frames: 0, heartbeats: 0, bytes: 0, deltas: 0, discards: 0, cls: 0, longtasks: 0, renders: 0, flakes: 0, maxLag: 0, maxLagMs: 0, showCps: 0, inCps: 0 };
}

/** Одна проверка — для горячих путей (кадр rAF, рендер). */
export const telemetryOn = () => enabled;

export function track(e: TelemetryEvent): void {
  if (!enabled || paused) return;
  const s = e as Stamped;
  s.n = ++seqNo;
  s.t = now();
  s.turn = turnNo;
  ring[head] = s;
  head = (head + 1) % CAP;
  if (count < CAP) count++;
  account(s);
  scheduleNotify();
}

function account(e: Stamped) {
  switch (e.k) {
    case 'sse':
      if (e.hb) stats.heartbeats++;
      else stats.frames++;
      stats.bytes += e.bytes;
      if (e.ev === 'delta') stats.deltas++;
      break;
    case 'layout':
      stats.cls += e.value;
      break;
    case 'longtask':
      stats.longtasks++;
      break;
    case 'flake':
      stats.flakes++;
      if (e.what === 'discard') stats.discards++;
      break;
    case 'stream':
      if (e.lag > stats.maxLag) stats.maxLag = e.lag;
      if (e.lagMs > stats.maxLagMs) stats.maxLagMs = e.lagMs;
      stats.showCps = e.showCps;
      if (e.inCps > 0) stats.inCps = e.inCps;
      break;
    case 'item': {
      const sp = spans.get(e.id);
      if (e.op === 'appear') {
        spans.set(e.id, { id: e.id, kind: e.kind, turn: e.turn, appear: e.t, updates: 0 });
        trimSpans();
      } else if (sp && e.op === 'update') sp.updates++;
      else if (sp && e.op === 'disappear') sp.disappear = e.t;
      break;
    }
    default:
  }
}

function trimSpans() {
  if (spans.size <= 200) return;
  const first = spans.keys().next().value;
  if (first !== undefined) spans.delete(first);
}

function scheduleNotify() {
  if (notifyTimer !== null || listeners.size === 0) return;
  // Панель перерисовывается не чаще ~8 раз в секунду: сама не должна грузить главный поток.
  notifyTimer = setTimeout(notify, 120);
}

function notify() {
  notifyTimer = null;
  version++;
  for (const l of listeners) l();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export const getVersion = () => version;

/** События в порядке поступления (старые первыми). */
export function events(): Stamped[] {
  const out: Stamped[] = [];
  const start = count < CAP ? 0 : head;
  for (let i = 0; i < count; i++) {
    const e = ring[(start + i) % CAP];
    if (e) out.push(e);
  }
  return out;
}

export const turnStats = (): TurnStats => stats;
export const itemSpans = (): ItemSpan[] => [...spans.values()];

export function clear() {
  ring.fill(undefined);
  head = 0;
  count = 0;
  spans.clear();
  stats = emptyStats(turnNo, now());
  notify();
}

export function setPaused(v: boolean) {
  paused = v;
  notify();
}
export const isPaused = () => paused;

// ---------- Ход ----------

export function turnStart(conv?: string) {
  if (!enabled) return;
  turnNo++;
  stats = emptyStats(turnNo, now());
  stats.conv = conv;
  lastFrameAt = stats.start;
  track({ k: 'turn', phase: 'start', conv });
}

export function turnEvent(type: string) {
  if (!enabled) return;
  const ms = now() - stats.start;
  if (stats.firstEvent === undefined) {
    stats.firstEvent = ms;
    track({ k: 'turn', phase: 'first-event', ms, note: type });
  }
  if (type === 'delta' && stats.ttft === undefined) {
    stats.ttft = ms;
    track({ k: 'turn', phase: 'first-delta', ms });
  }
}

export function turnEnd(phase: 'done' | 'error' | 'stop', note?: string, renders?: number) {
  if (!enabled) return;
  const ms = now() - stats.start;
  if (stats.status === 'running' || phase === 'stop') {
    stats.status = phase;
    stats.doneMs = ms;
  }
  if (renders !== undefined) {
    stats.renders = renders;
    track({ k: 'render', n: renders });
  }
  track({ k: 'turn', phase, ms, conv: stats.conv, note });
}

/** Кадр SSE из парсера (`createSseParser(types, { onFrame })`). */
export function trackFrame(ev: string, bytes: number, heartbeat: boolean) {
  if (!enabled) return;
  const t = now();
  const gap = lastFrameAt ? t - lastFrameAt : 0;
  lastFrameAt = t;
  track({ k: 'sse', ev, bytes, gap: Math.round(gap), hb: heartbeat || undefined });
}

// ---------- Элементы ленты ----------

interface FeedLike {
  id: string;
  role: string;
  event?: { type: string; text?: string };
  text?: string;
}

export function kindOf(it: FeedLike): ItemKind {
  if (it.role === 'user') return 'user';
  const t = it.event?.type ?? 'unknown';
  return t === 'message' ? 'reply' : t;
}

/** Пара (видимое содержимое) для сравнения «обновился ли элемент». */
const sig = (it: FeedLike) => it.event?.text?.length ?? it.text?.length ?? 0;

/**
 * Сравнить ленту до и после редьюсера: appear / update / disappear + производные флейки
 * (мелькнул < BLINK_MS, повторный mount того же id). Дёшево: Map по id, без DOM.
 */
export function diffItems(prev: readonly FeedLike[], next: readonly FeedLike[], reason?: string) {
  if (!enabled || prev === next) return;
  const before = new Map<string, FeedLike>();
  for (const it of prev) before.set(it.id, it);
  const t = now();
  for (const it of next) {
    const was = before.get(it.id);
    if (!was) {
      const old = spans.get(it.id);
      if (old?.disappear !== undefined) track({ k: 'flake', what: 'remount', id: it.id, detail: kindOf(it) });
      track({ k: 'item', op: 'appear', id: it.id, kind: kindOf(it), reason });
    } else {
      before.delete(it.id);
      const a = was.event?.text;
      const b = it.event?.text;
      // Текст реплики не продолжился, а заменился (авторитетный `message` ≠ накопленным дельтам).
      if (a && b !== undefined && a !== b && !b.startsWith(a)) track({ k: 'flake', what: 'replaced', id: it.id, detail: `${a.length}→${b.length} зн` });
      if (was !== it && (sig(was) !== sig(it) || was.event?.type !== it.event?.type)) {
        // Обновления дельт идут десятками: в ленту событий — только счётчик в таймлайне.
        const sp = spans.get(it.id);
        if (sp) sp.updates++;
        else track({ k: 'item', op: 'update', id: it.id, kind: kindOf(it), reason });
      }
    }
  }
  for (const it of before.values()) {
    track({ k: 'item', op: 'disappear', id: it.id, kind: kindOf(it), reason });
    const sp = spans.get(it.id);
    if (sp && t - sp.appear < BLINK_MS) {
      sp.flake = 'blink';
      track({ k: 'flake', what: 'blink', id: it.id, detail: `${kindOf(it)} ${Math.round(t - sp.appear)}ms` });
    }
  }
}

/** Синтетический элемент (typing/skeleton), который рисуется не из списка ленты. */
export function trackVirtual(base: string, kind: ItemKind, visible: boolean) {
  if (!enabled) return;
  const id = `${base}#${turnNo}`;
  if (visible) {
    track({ k: 'item', op: 'appear', id, kind });
    return;
  }
  const sp = spans.get(id);
  if (!sp || sp.disappear !== undefined) return;
  track({ k: 'item', op: 'disappear', id, kind });
  const ms = now() - sp.appear;
  if (ms < BLINK_MS) {
    sp.flake = 'blink';
    track({ k: 'flake', what: 'blink', id, detail: `${kind} ${Math.round(ms)}ms` });
  }
}

// ---------- Стрим ----------

export interface StreamSampler {
  tick(acc: number, shown: number, t: number): void;
  flush(acc: number, shown: number, t: number): void;
}

/**
 * Сэмплер раскрытия одной реплики: не чаще раза в SAMPLE_MS отправляет `stream`
 * (накоплено/показано/отставание/скорости). Показанное уменьшилось — флейк `reveal-jump`.
 */
export function createStreamSampler(id: string): StreamSampler {
  let lastT = -1;
  let lastAcc = 0;
  let lastShown = 0;
  let maxShown = 0;
  let ema = 0;
  const emit = (acc: number, shown: number, t: number) => {
    const dt = lastT < 0 ? 0 : (t - lastT) / 1000;
    const showCps = dt > 0 ? Math.round((shown - lastShown) / dt) : 0;
    const inCps = dt > 0 ? Math.round((acc - lastAcc) / dt) : 0;
    const lag = Math.max(0, acc - shown);
    // Отставание в мс — по сглаженной скорости показа: раскрытие идёт по словам, мгновенная скорость скачет.
    ema = ema ? ema * 0.6 + showCps * 0.4 : showCps;
    const lagMs = ema > 0 ? Math.round((lag / ema) * 1000) : 0;
    lastT = t;
    lastAcc = acc;
    lastShown = shown;
    track({ k: 'stream', id, acc, shown, lag, lagMs, showCps, inCps });
  };
  return {
    tick(acc, shown, t) {
      if (!enabled) return;
      if (shown < maxShown) track({ k: 'flake', what: 'reveal-jump', id, detail: `${maxShown}→${shown}` });
      maxShown = Math.max(maxShown, shown);
      if (lastT < 0) {
        lastT = t;
        lastAcc = acc;
        lastShown = shown;
        return;
      }
      if (t - lastT >= SAMPLE_MS) emit(acc, shown, t);
    },
    flush(acc, shown, t) {
      if (!enabled || lastT < 0) return;
      emit(acc, shown, t);
    },
  };
}

// ---------- Флаг ----------

function readStore(): boolean {
  try {
    return window.localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setTelemetryEnabled(v: boolean, persist = true) {
  if (persist && typeof window !== 'undefined') {
    try {
      if (v) window.localStorage.setItem(STORE_KEY, '1');
      else window.localStorage.removeItem(STORE_KEY);
    } catch {
      /* хранилище недоступно — флаг живёт до перезагрузки */
    }
  }
  if (enabled === v) return;
  enabled = v;
  if (v) startObservers();
  else stopObservers();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(TELEMETRY_EVENT, { detail: v }));
  notify();
}

let inited = false;
/** Прочитать флаг один раз (URL → localStorage) и слушать `storage` из других вкладок. */
export function initTelemetry() {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  let on = readStore();
  try {
    const q = new URLSearchParams(window.location.search).get('telemetry');
    if (q === '1') on = true;
    if (q === '0') on = false;
    if (q !== null) setTelemetryEnabled(on);
  } catch {
    /* без URL — только localStorage */
  }
  if (on) setTelemetryEnabled(true, false);
  window.addEventListener('storage', (e) => {
    if (e.key === STORE_KEY) setTelemetryEnabled(e.newValue === '1', false);
  });
}

// ---------- Наблюдатели (только при включённой телеметрии) ----------

let observers: PerformanceObserver[] = [];

interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
  sources?: { node?: Node | null }[];
}

function describe(node: Node | null | undefined): string {
  if (!node) return '?';
  if (node.nodeType !== 1) return node.parentElement ? `${describe(node.parentElement)}>#text` : '#text';
  const el = node as Element;
  const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
  return `${el.tagName.toLowerCase()}${cls ? `.${cls.replace(/_[A-Za-z0-9]{5}$/, '')}` : ''}`;
}

function startObservers() {
  if (typeof PerformanceObserver === 'undefined' || observers.length) return;
  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  if (supported.includes('layout-shift')) {
    const o = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LayoutShiftEntry[]) {
        if (entry.hadRecentInput) continue;
        const nodes = (entry.sources ?? []).map((s) => s.node).filter(Boolean) as Node[];
        if (entry.value < 0.00005) continue;
        // Сдвиги самой панели телеметрии (строки лога) в замер не попадают: значение общее на все источники,
        // поэтому запись с любым источником внутри панели отбрасывается целиком.
        if (nodes.some((n) => (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest('[data-telemetry-panel]'))) continue;
        track({ k: 'layout', value: Math.round(entry.value * 10000) / 10000, sources: nodes.slice(0, 3).map(describe).join(' ') || undefined });
      }
    });
    o.observe({ type: 'layout-shift', buffered: false });
    observers.push(o);
  }
  if (supported.includes('longtask')) {
    const o = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) track({ k: 'longtask', ms: Math.round(entry.duration) });
    });
    o.observe({ type: 'longtask', buffered: false });
    observers.push(o);
  }
}

function stopObservers() {
  for (const o of observers) o.disconnect();
  observers = [];
}

/** Для тестов: сбросить состояние модуля. */
export function __resetTelemetry() {
  stopObservers();
  enabled = false;
  paused = false;
  turnNo = 0;
  lastFrameAt = 0;
  listeners.clear();
  if (notifyTimer !== null) clearTimeout(notifyTimer);
  notifyTimer = null;
  ring.fill(undefined);
  head = 0;
  count = 0;
  seqNo = 0;
  spans.clear();
  stats = emptyStats(0, 0);
}
