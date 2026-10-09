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
});
