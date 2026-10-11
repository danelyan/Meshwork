import { applyAgentEvent } from '@/components/chat/stream-items';
import { MAX_FRAME_DT_MS, revealRateCps, stepReveal, visibleCut } from '@/components/chat/smooth-text';
import { extractUrls } from '@/lib/links';

describe('smooth-text: раскрытие текста', () => {
  it('скорость: человеческий темп 45–110 зн/с, отставание не больше 6 с; paced — около 4 с в пределах 70–140', () => {
    expect(revealRateCps('streaming', 100, 100)).toBe(45);
    expect(revealRateCps('streaming', 200, 200)).toBe(80);
    expect(revealRateCps('streaming', 500, 500)).toBe(110);
    expect(revealRateCps('streaming', 1200, 1200)).toBe(200);
    expect(revealRateCps('settling', 40, 40)).toBe(70);
    expect(revealRateCps('settling', 600, 600)).toBe(110);
    expect(revealRateCps('paced', 0, 100)).toBe(70);
    expect(revealRateCps('paced', 0, 400)).toBe(100);
    expect(revealRateCps('paced', 0, 10_000)).toBe(140);
  });

  it('кадр с опозданием не двигает курсор больше чем на 50 мс', () => {
    const a = stepReveal(0, 1000, 400, 'paced');
    const b = stepReveal(0, 1000, MAX_FRAME_DT_MS, 'paced');
    expect(a).toBe(b);
  });

  it('граница по словам; хвост — только когда поток закончен; длинный токен — по символам', () => {
    const t = 'Привет, мир';
    expect(visibleCut(t, 3, false)).toBe(0);
    expect(visibleCut(t, 9, false)).toBe(8);
    expect(visibleCut(t, 11, false)).toBe(8);
    expect(visibleCut(t, 11, true)).toBe(11);
    const url = 'https://github.com/demo-ryabinin/very-long-repository-name';
    expect(visibleCut(url, 40, false)).toBe(40);
  });
});

describe('stream-items: сборка ленты', () => {
  let n = 0;
  const id = () => `i${++n}`;
  it('delta → одна живая реплика; message с id фиксирует; discard убирает', () => {
    type E = { type: string; id?: string; text?: string };
    let items: { id: string; role: string }[] = [];
    items = applyAgentEvent<E, { id: string; role: string }>(items, { type: 'delta', id: 'a', text: 'При' }, id);
    items = applyAgentEvent<E, { id: string; role: string }>(items, { type: 'delta', id: 'a', text: 'вет' }, id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ streaming: true, live: true, event: { type: 'message', text: 'Привет' } });
    items = applyAgentEvent<E, { id: string; role: string }>(items, { type: 'message', id: 'a', text: 'Привет!' }, id);
    expect(items[0]).toMatchObject({ streaming: false, event: { text: 'Привет!' } });
    items = applyAgentEvent<E, { id: string; role: string }>(items, { type: 'delta', id: 'b', text: 'x' }, id);
    items = applyAgentEvent<E, { id: string; role: string }>(items, { type: 'discard', id: 'b' }, id);
    expect(items).toHaveLength(1);
    items = applyAgentEvent<E, { id: string; role: string }>(items, { type: 'message', text: 'без дельт' }, id);
    expect(items[1]).toMatchObject({ live: true, event: { text: 'без дельт' } });
  });
});

describe('extractUrls: ссылки в тексте сообщения', () => {
  it('схема, путь, частые зоны; «Node.js» и почта — не ссылки; хвостовая пунктуация срезается', () => {
    expect(extractUrls('код: github.com/demo-ryabinin, статья https://habr.com/ru/articles/1/. Node.js, Vue.js, a@b.com, habr.com')).toEqual([
      'https://github.com/demo-ryabinin',
      'https://habr.com/ru/articles/1/',
      'https://habr.com/',
    ]);
  });
  it('ссылки на сам сайт платформы не берём', () => {
    vi.stubGlobal('window', { location: { origin: 'https://fsp.example' } });
    try {
      expect(extractUrls('https://fsp.example/profile и github.com/x')).toEqual(['https://github.com/x']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('без ссылок — пусто; повторы схлопываются', () => {
    expect(extractUrls('Пишу на Go и TypeScript')).toEqual([]);
    expect(extractUrls('github.com/x github.com/x')).toEqual(['https://github.com/x']);
  });
});
