import { DEFAULT_VAD, MicGate, PREROLL_FRAMES, type VadEvent, initialVad, isSpeech, vadStep, vadThreshold } from '@/lib/vad';

const LOUD = 0.2;
const QUIET = 0.001;

function run(levels: number[], playing = false, cfg = DEFAULT_VAD) {
  let state = initialVad(cfg);
  const events: VadEvent[] = [];
  for (const rms of levels) {
    const [next, ev] = vadStep(state, rms, playing, cfg);
    state = next;
    if (ev) events.push(ev);
  }
  return { state, events };
}

describe('детектор речи: кандидат, подтверждение, hangover', () => {
  it('тишина адаптирует пол и не даёт событий; короткий щелчок – false_start', () => {
    const quiet = run(Array(30).fill(QUIET));
    expect(quiet.events).toEqual([]);
    expect(quiet.state.noiseFloor).toBeLessThan(initialVad().noiseFloor);
    const click = run([...Array(5).fill(QUIET), LOUD, LOUD, LOUD, ...Array(20).fill(QUIET)]);
    expect(click.events.map((e) => e.kind)).toEqual(['false_start']);
  });

  it('речь дольше confirmMs → speech_start, тишина releaseMs → speech_end', () => {
    const r = run([...Array(5).fill(QUIET), ...Array(12).fill(LOUD), ...Array(30).fill(QUIET)]);
    expect(r.events.map((e) => e.kind)).toEqual(['speech_start', 'speech_end']);
    expect((r.events[0] as { utteranceId: string }).utteranceId).toBe('u-1');
  });

  it('пока ИИ говорит: порог выше и подтверждение дольше (bargeInMs) – короткое «ага» не перебивает', () => {
    const s = initialVad();
    expect(vadThreshold(s, true, DEFAULT_VAD)).toBeCloseTo(vadThreshold(s, false, DEFAULT_VAD) * DEFAULT_VAD.playbackMargin);
    const short = run([...Array(3).fill(QUIET), ...Array(8).fill(LOUD), ...Array(20).fill(QUIET)], true);
    expect(short.events.map((e) => e.kind)).toEqual(['false_start']);
    const long = run([...Array(3).fill(QUIET), ...Array(16).fill(LOUD), ...Array(20).fill(QUIET)], true);
    expect(long.events.map((e) => e.kind)).toEqual(['speech_start', 'speech_end']);
  });
});

describe('ворота микрофона: прерол и кадры фразы', () => {
  it('speech_start отдаёт прерол и кадры кандидата, фраза – кадры до speech_end, шум – ничего', () => {
    const gate = new MicGate<number>();
    const sent: number[] = [];
    let i = 0;
    const feed = (rms: number) => {
      const r = gate.step(i++, rms, false);
      sent.push(...r.send);
      return r.event?.kind ?? null;
    };
    for (let k = 0; k < 20; k++) feed(QUIET);
    expect(sent).toEqual([]);
    let started: number | null = null;
    for (let k = 0; k < 10; k++) if (feed(LOUD) === 'speech_start') started = i - 1;
    expect(started).not.toBeNull();
    // Прерол ≤ PREROLL_FRAMES кадров тишины + все кадры кандидата + текущий.
    expect(sent[0]).toBeGreaterThanOrEqual(20 - PREROLL_FRAMES);
    expect(sent).toContain(started);
    expect(sent[sent.length - 1]).toBe(i - 1);
    const before = sent.length;
    let ended = false;
    for (let k = 0; k < 30 && !ended; k++) ended = feed(QUIET) === 'speech_end';
    expect(ended).toBe(true);
    expect(sent.length).toBeGreaterThan(before);
    expect(isSpeech(gate.state)).toBe(false);
    expect(gate.forceEnd()).toBeNull();
  });
});
