import { createReplyStream, splitChunks } from '@/server/agent/reply-stream';

type Ev = { type: string; id?: string; text?: string };

describe('reply-stream: дельты реплики', () => {
  it('splitChunks: куски по словам, склейка = исходный текст', () => {
    const t = 'Нашёл в резюме три навыка: Go, PostgreSQL и Kafka. Подтверди карточки — покажу вакансии.';
    const parts = splitChunks(t);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.join('')).toBe(t);
  });

  it('без дельт провайдера finish нарезает текст и закрывает message с тем же id', async () => {
    const evs: Ev[] = [];
    const s = createReplyStream((e) => evs.push(e), undefined, () => 0);
    await s.finish('раз два три четыре пять');
    const msg = evs.at(-1)!;
    expect(msg).toMatchObject({ type: 'message', text: 'раз два три четыре пять' });
    const deltas = evs.filter((e) => e.type === 'delta');
    expect(deltas.map((d) => d.text).join('')).toBe(msg.text);
    expect(deltas.every((d) => d.id === msg.id)).toBe(true);
  });

  it('дельты провайдера идут как есть; после discard — новый id и повторная нарезка не нужна', async () => {
    const evs: Ev[] = [];
    const s = createReplyStream((e) => evs.push(e), undefined, () => 0);
    s.onDelta('думаю…');
    const first = s.id;
    s.discard();
    expect(evs).toEqual([
      { type: 'delta', id: first, text: 'думаю…' },
      { type: 'discard', id: first },
    ]);
    s.onDelta('Ответ');
    await s.finish('Ответ');
    expect(evs.slice(2)).toEqual([
      { type: 'delta', id: expect.not.stringMatching(first), text: 'Ответ' },
      { type: 'message', id: evs[2]!.id, text: 'Ответ' },
    ]);
  });

  it('discard без показанного текста ничего не шлёт; отмена — без message', async () => {
    const evs: Ev[] = [];
    const ctrl = new AbortController();
    const s = createReplyStream((e) => evs.push(e), ctrl.signal, () => 0);
    s.discard();
    ctrl.abort();
    await s.finish('текст');
    expect(evs).toEqual([]);
  });

  it('стоп посреди дельт модели: показанный кусок — message, его и сохранять', () => {
    const evs: Ev[] = [];
    const s = createReplyStream((e) => evs.push(e), undefined, () => 0);
    s.onDelta('Начало ');
    s.onDelta('ответа');
    const id = s.id;
    expect(s.stop()).toBe('Начало ответа');
    expect(evs.at(-1)).toEqual({ type: 'message', id, text: 'Начало ответа' });
  });

  it('стоп без дельт — ничего не сохранять и не слать', () => {
    const evs: Ev[] = [];
    const s = createReplyStream((e) => evs.push(e), undefined, () => 0);
    expect(s.stop()).toBeNull();
    expect(evs).toEqual([]);
  });

  it('пауза между кусками не оставляет слушателей abort на сигнале хода', async () => {
    const ctrl = new AbortController();
    const added = vi.spyOn(ctrl.signal, 'addEventListener');
    const removed = vi.spyOn(ctrl.signal, 'removeEventListener');
    const s = createReplyStream(() => undefined, ctrl.signal, () => 1);
    const text = 'раз два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать';
    expect(await s.finish(text)).toBe(text);
    const on = added.mock.calls.filter((c) => c[0] === 'abort');
    const off = removed.mock.calls.filter((c) => c[0] === 'abort');
    expect(on.length).toBe(splitChunks(text).length);
    expect(off.map((c) => c[1])).toEqual(on.map((c) => c[1]));
  });

  it('клиент ушёл (pace): нарезка не ждёт, но message с полным текстом отдаётся и сохраняется', async () => {
    const evs: Ev[] = [];
    const pace = new AbortController();
    pace.abort();
    const s = createReplyStream((e) => evs.push(e), new AbortController().signal, () => 1000, pace.signal);
    const t0 = Date.now();
    expect(await s.finish('раз два три четыре пять шесть')).toBe('раз два три четыре пять шесть');
    expect(Date.now() - t0).toBeLessThan(500);
    expect(evs).toEqual([{ type: 'message', id: expect.any(String), text: 'раз два три четыре пять шесть' }]);
  });

  it('стоп посреди нарезки: message и сохранение — только показанный кусок', async () => {
    const evs: Ev[] = [];
    const stop = new AbortController();
    let n = 0;
    const s = createReplyStream(
      (e) => {
        evs.push(e);
        if (e.type === 'delta' && ++n === 1) stop.abort();
      },
      stop.signal,
      () => 0,
    );
    const saved = await s.finish('раз два три четыре пять шесть семь');
    expect(saved).toBe('раз два три');
    expect(evs.filter((e) => e.type === 'delta')).toHaveLength(1);
    expect(evs.at(-1)).toMatchObject({ type: 'message', text: 'раз два три' });
  });
});
