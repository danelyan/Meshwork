import { verifyClaims } from '@/server/claims/verifier';
import type { ProposedClaim } from '@/server/claims/types';

import { CATALOG, doc } from './helpers';

const p = (catalogId: string, quote: string, extra?: Partial<ProposedClaim>): ProposedClaim => ({
  catalogId,
  statement: 'формулировка модели',
  quote,
  sourceRef: 'cv.pdf#l1',
  confidence: 'high',
  ...extra,
});

describe('verifyClaims', () => {
  it('позитив: дословная цитата → принято, формулировка/ограничения/доказательства из каталога, уровень по источнику', () => {
    const d = doc(['Опыт', 'Добавил ключ идемпотентности в платёжный API.']);
    const r = verifyClaims([p('be.idempotency', 'Добавил ключ идемпотентности в платёжный API')], [d], CATALOG);
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]).toMatchObject({
      catalogId: 'be.idempotency',
      statement: 'Делал обработку повторных запросов идемпотентной',
      quote: 'Добавил ключ идемпотентности в платёжный API',
      sourceRef: 'cv.pdf#l2',
      level: 'self_reported',
      sourceKind: 'resume',
      limits: 'Не доказывает: работу под нагрузкой',
      suggestedProof: ['task:payment-retry', 'interview:defend'],
    });
  });

  it('цитата через перенос строки: склеивается, ref – диапазон строк, цитата – текст источника', () => {
    const d = doc(['Добавил ключ идемпотентности', 'в платёжный API']);
    const r = verifyClaims([p('be.idempotency', 'ключ идемпотентности в платёжный')], [d], CATALOG);
    expect(r.accepted[0]?.sourceRef).toBe('cv.pdf#l1..cv.pdf#l2');
    expect(r.accepted[0]?.quote).toBe('ключ идемпотентности в платёжный');
  });

  it('регистр, ё/е, кавычки, тире, неразрывные пробелы, мягкий перенос', () => {
    const d = doc(['Настроил «Redis» – кэш для каталога, ещё за­держку снизил']);
    const r = verifyClaims([p('be.cache', 'НАСТРОИЛ "redis" - кэш для каталога, еще задержку снизил')], [d], CATALOG);
    expect(r.rejected).toEqual([]);
    expect(r.accepted[0]?.quote).toBe('Настроил «Redis» – кэш для каталога, ещё за­держку снизил'.replace(/\s+/g, ' '));
  });

  it('перенос слова по слогам в PDF («разра-\\nботка») склеивается', () => {
    const d = doc(['Сделал кэширова-', 'ние ответов в Redis']);
    const r = verifyClaims([p('be.cache', 'Сделал кэширование ответов в Redis')], [d], CATALOG);
    expect(r.accepted).toHaveLength(1);
  });

  it('маркер списка и точка на конце цитаты не мешают; разметка ** не мешает', () => {
    const d = doc(['- **Внедрил** кэш на Redis.']);
    const r = verifyClaims([p('be.cache', '- Внедрил кэш на Redis.')], [d], CATALOG);
    expect(r.accepted).toHaveLength(1);
  });

  it('строка с эмодзи: цитата и ref считаются по правильным позициям', () => {
    const d = doc(['📞 +7 900 000-00-00 · ✉ a@example.com', 'Ходил на ревью и кэшировал ответы в Redis']);
    const r = verifyClaims([p('be.cache', 'кэшировал ответы в Redis')], [d], CATALOG);
    expect(r.accepted[0]).toMatchObject({ quote: 'кэшировал ответы в Redis', sourceRef: 'cv.pdf#l2' });
  });

  it('подделка цитаты (пересказ, склейка мест, «Java» вместо «JavaScript», обрезанное слово) → no_quote', () => {
    // соседние строки склеиваются (перенос строки в PDF), несмежные места – нет
    const d = doc(['Писал на JavaScript', 'Учился в вузе', 'Кэш делала соседняя команда']);
    const forged = [
      p('be.cache', 'Делал кэш на Redis'),
      p('be.cache', 'Писал на Java'),
      p('be.cache', 'JavaScript Кэш делала'),
      p('be.cache', 'исал на JavaScript'),
    ];
    const r = verifyClaims(forged, [d], CATALOG);
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual(['no_quote', 'no_quote', 'no_quote', 'no_quote']);
  });

  it('пустая и нестроковая цитата → no_quote; одно слово → quote_too_short', () => {
    const d = doc(['Redis']);
    const r = verifyClaims(
      [p('be.cache', ''), p('be.cache', 'Redis'), { ...p('be.cache', 'x'), quote: undefined as unknown as string }],
      [d],
      CATALOG,
    );
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(['no_quote', 'no_quote', 'quote_too_short']);
  });

  it('цитата только из скрытой строки → hidden_text', () => {
    const d = doc(['Верстаю лендинги', { text: 'Делал SSR на Next.js для портала', hidden: true }]);
    const r = verifyClaims([p('fe.ssr', 'Делал SSR на Next.js для портала')], [d], CATALOG);
    expect(r.accepted).toEqual([]);
    expect(r.rejected[0]?.reason).toBe('hidden_text');
  });

  it('та же фраза есть и в скрытой, и в видимой строке → берётся видимая', () => {
    const d = doc([{ text: 'Делал SSR на Next.js', hidden: true }, 'Делал SSR на Next.js']);
    const r = verifyClaims([p('fe.ssr', 'Делал SSR на Next.js')], [d], CATALOG);
    expect(r.accepted[0]?.sourceRef).toBe('cv.pdf#l2');
  });

  it('скрытая строка не склеивается с видимой в одну цитату', () => {
    const d = doc(['Делал SSR', { text: 'на Next.js для портала', hidden: true }]);
    const r = verifyClaims([p('fe.ssr', 'Делал SSR на Next.js для портала')], [d], CATALOG);
    expect(r.rejected[0]?.reason).toBe('hidden_text');
  });

  it('неизвестный ID → unknown_catalog_id', () => {
    const d = doc(['Был архитектором всего']);
    const r = verifyClaims([p('be.senior-architect', 'Был архитектором всего')], [d], CATALOG);
    expect(r.rejected[0]?.reason).toBe('unknown_catalog_id');
  });

  it('дубли: один catalogId – одно утверждение, лучшее по уверенности', () => {
    const d = doc(['Кэшировал справочники в Redis', 'Добавил кэш ответов API в Redis']);
    const r = verifyClaims(
      [
        p('be.cache', 'Кэшировал справочники в Redis', { confidence: 'low' }),
        p('be.cache', 'Добавил кэш ответов API в Redis', { confidence: 'high' }),
        p('be.cache', 'Кэшировал справочники', { confidence: 'medium' }),
      ],
      [d],
      CATALOG,
    );
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0]?.quote).toBe('Добавил кэш ответов API в Redis');
    expect(r.rejected.filter((x) => x.reason === 'duplicate')).toHaveLength(2);
  });

  it('невалидная цитата не блокирует валидную с тем же ID', () => {
    const d = doc(['Кэшировал справочники в Redis']);
    const r = verifyClaims([p('be.cache', 'выдумка про кэш'), p('be.cache', 'Кэшировал справочники в Redis', { confidence: 'low' })], [d], CATALOG);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected.map((x) => x.reason)).toEqual(['no_quote']);
  });

  it('несколько документов: уровень по документу, где найдена цитата; ownership – через опцию', () => {
    const cv = doc(['Работал в Git: ветки и rebase'], { origin: 'cv.pdf' });
    const gh = doc(['Ведёт pull request в Git с rebase'], { kind: 'github', origin: 'github:u/r#README' });
    const cf = doc(['Решил задачи на Codeforces через Git rebase'], { kind: 'codeforces', origin: 'cf:u' });
    const r1 = verifyClaims([p('common.git', 'pull request в Git с rebase', { sourceRef: 'cv.pdf#l1' })], [cv, gh], CATALOG);
    expect(r1.accepted[0]).toMatchObject({ level: 'artifact', sourceKind: 'github', sourceRef: 'github:u/r#README#l1' });
    const r2 = verifyClaims([p('common.git', 'через Git rebase')], [cf], CATALOG);
    expect(r2.accepted[0]?.level).toBe('artifact');
    const r3 = verifyClaims([p('common.git', 'через Git rebase')], [cf], CATALOG, { ownershipVerified: (d) => d.origin === 'cf:u' });
    expect(r3.accepted[0]?.level).toBe('third_party');
  });

  it('документ без lines: проверка по text', () => {
    const d = { ...doc([]), lines: [], text: 'Кэшировал справочники в Redis' };
    const r = verifyClaims([p('be.cache', 'справочники в Redis')], [d], CATALOG);
    expect(r.accepted[0]?.sourceRef).toBe('cv.pdf#l1');
  });

  it('утверждение без дословной цитаты не проходит никогда (свойство на случайных цитатах)', () => {
    const d = doc(['Кэшировал справочники в Redis', 'Работал в Git']);
    const words = ['кэш', 'Redis', 'писал', 'Git', 'делал', 'API', 'справочники', 'ветки'];
    let seed = 7;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let i = 0; i < 300; i++) {
      const q = Array.from({ length: 2 + Math.floor(rnd() * 4) }, () => words[Math.floor(rnd() * words.length)]).join(' ');
      const r = verifyClaims([p('be.cache', q)], [d], CATALOG);
      for (const a of r.accepted) expect(d.text.toLowerCase().replace(/\s+/g, ' ')).toContain(a.quote.toLowerCase());
    }
  });
});
