import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetTelemetry,
  createStreamSampler,
  diffItems,
  events,
  itemSpans,
  setTelemetryEnabled,
  subscribe,
  track,
  turnEnd,
  turnEvent,
  turnStart,
  turnStats,
} from '@/components/chat/telemetry';
import { createSseParser } from '@/lib/sse';

const reply = (id: string, text: string) => ({ id, role: 'agent', event: { type: 'message', text } });

describe('шина телеметрии чата', () => {
  beforeEach(() => {
    __resetTelemetry();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    __resetTelemetry();
  });

  it('выключена – ничего не пишет', () => {
    track({ k: 'longtask', ms: 80 });
    diffItems([], [reply('i1', 'a')]);
    expect(events()).toHaveLength(0);
  });

  it('кольцевой буфер держит последние 500 событий по порядку', () => {
    setTelemetryEnabled(true, false);
    for (let i = 0; i < 520; i++) track({ k: 'longtask', ms: i });
    const all = events();
    expect(all).toHaveLength(500);
    expect(all[0]).toMatchObject({ ms: 20 });
    expect(all.at(-1)).toMatchObject({ ms: 519 });
  });

  it('подписчики получают одно схлопнутое уведомление', () => {
    setTelemetryEnabled(true, false);
    const fn = vi.fn();
    subscribe(fn);
    track({ k: 'longtask', ms: 1 });
    track({ k: 'longtask', ms: 2 });
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ход: TTFT по первой дельте, счётчики кадров', () => {
    setTelemetryEnabled(true, false);
    turnStart('conv-1');
    turnEvent('step');
    turnEvent('delta');
    turnEvent('delta');
    track({ k: 'sse', ev: 'delta', bytes: 10, gap: 5 });
    track({ k: 'sse', ev: 'comment', bytes: 6, gap: 5, hb: true });
    turnEnd('done', undefined, 7);
    const s = turnStats();
    expect(s.ttft).toBeTypeOf('number');
    expect(s).toMatchObject({ status: 'done', frames: 1, heartbeats: 1, deltas: 1, renders: 7 });
    expect(events().filter((e) => e.k === 'turn').map((e) => (e as { phase: string }).phase)).toEqual(['start', 'first-event', 'first-delta', 'done']);
  });

  it('diff ленты: appear/disappear, мелькание и повторный mount – флейки', () => {
    setTelemetryEnabled(true, false);
    const a = [reply('i1', 'привет')];
    diffItems([], a);
    diffItems(a, []);
    diffItems([], a);
    const flakes = events().filter((e) => e.k === 'flake').map((e) => (e as { what: string }).what);
    expect(flakes).toEqual(['blink', 'remount']);
    expect(itemSpans()[0]).toMatchObject({ id: 'i1', kind: 'reply' });
  });

  it('текст реплики заменился, а не продолжился – флейк replaced; рост – нет', () => {
    setTelemetryEnabled(true, false);
    const a = [reply('i1', 'При')];
    const b = [reply('i1', 'Привет')];
    const c = [reply('i1', 'Другой текст')];
    diffItems([], a);
    diffItems(a, b);
    expect(events().some((e) => e.k === 'flake')).toBe(false);
    diffItems(b, c);
    expect(events().filter((e) => e.k === 'flake')).toHaveLength(1);
    expect(itemSpans()[0]?.updates).toBe(2);
  });

  it('сэмплер стрима: не чаще 200 мс, скорость и отставание; откат показа – reveal-jump', () => {
    setTelemetryEnabled(true, false);
    const s = createStreamSampler('r1');
    s.tick(100, 0, 0);
    s.tick(120, 10, 100);
    expect(events()).toHaveLength(0);
    s.tick(200, 20, 200);
    const [e] = events();
    expect(e).toMatchObject({ k: 'stream', acc: 200, shown: 20, lag: 180, showCps: 100, inCps: 500, lagMs: 1800 });
    s.tick(200, 15, 260);
    expect(events().at(-1)).toMatchObject({ k: 'flake', what: 'reveal-jump' });
  });
});

describe('createSseParser onFrame', () => {
  it('сообщает о каждом кадре и heartbeat, контракт событий прежний', () => {
    const frames: [string, number, boolean][] = [];
    const p = createSseParser(undefined, { onFrame: (t, b, hb) => frames.push([t, b, hb]) });
    const out = p.push(': ping\n\ndata: {"type":"delta","id":"m1","text":"a"}\n\ndata: oops\n\n');
    expect(out).toEqual([{ type: 'delta', id: 'm1', text: 'a' }]);
    expect(frames.map((f) => [f[0], f[2]])).toEqual([
      ['comment', true],
      ['delta', false],
      ['invalid', false],
    ]);
  });
});
