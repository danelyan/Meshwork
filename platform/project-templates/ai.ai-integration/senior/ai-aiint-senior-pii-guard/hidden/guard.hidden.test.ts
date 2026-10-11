// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createGuard, GuardError } from '../src/guard';

import { clock, fake, gated, ModelError } from './helpers/fake-model';

const HOUR = 3_600_000;
const BUDGET = { tokens: 100_000, periodMs: HOUR };

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GuardError);
    return (e as GuardError).code;
  }
  throw new Error('ожидалась GuardError');
}

function make(replies: string[] | Parameters<typeof fake>[1], extra: Record<string, unknown> = {}) {
  const c = clock();
  const m = fake('primary', replies);
  const guard = createGuard({ primary: m.model, now: c.now, budget: BUDGET, ...extra });
  return { guard, c, m };
}

describe('запрос', () => {
  it('пустой userId или prompt – bad_request без вызова модели и без записи в аудит', async () => {
    const { guard, m } = make([]);
    expect(await code(guard.ask({ userId: ' ', prompt: 'привет' }))).toBe('bad_request');
    expect(await code(guard.ask({ userId: 'u1', prompt: '  \n ' }))).toBe('bad_request');
    expect(m.requests).toHaveLength(0);
    expect(guard.audit()).toHaveLength(0);
  });

  it('now() вызывается один раз на ask', async () => {
    const { guard, c } = make(['ok', 'ok']);
    await guard.ask({ userId: 'u1', prompt: 'первый' });
    expect(c.calls()).toBe(1);
    await guard.ask({ userId: 'u1', prompt: 'первый' });
    expect(c.calls()).toBe(2);
  });
});

describe('маскирование ПДн', () => {
  it('email не уходит модели, в ответе подставляется обратно', async () => {
    const { guard, m } = make(['Написал на [EMAIL_1] – ответим сегодня.']);
    const r = await guard.ask({ userId: 'u1', prompt: 'Свяжитесь с Ивановым: Ivan.Petrov@Example.com, срочно.' });
    expect(m.requests[0]!.prompt).toBe('Свяжитесь с Ивановым: [EMAIL_1], срочно.');
    expect(r.text).toBe('Написал на Ivan.Petrov@Example.com – ответим сегодня.');
    expect(r.masked).toBe(1);
  });

  it('нумерация по типам в порядке появления; одно значение – один плейсхолдер, email без учёта регистра', async () => {
    const { guard, m } = make(['[EMAIL_2] и [EMAIL_1] и [EMAIL_2]']);
    const r = await guard.ask({ userId: 'u1', prompt: 'a@x.ru, B@Y.ru, потом A@X.RU' });
    expect(m.requests[0]!.prompt).toBe('[EMAIL_1], [EMAIL_2], потом [EMAIL_1]');
    expect(r.text).toBe('B@Y.ru и a@x.ru и B@Y.ru');
    expect(r.masked).toBe(2);
  });

  it('телефоны в разных записях; +7 и 8 с теми же цифрами – одно значение', async () => {
    const { guard, m } = make(['[PHONE_1]|[PHONE_2]']);
    const prompt = 'Звоните +7 (999) 123-45-67 или 8 999 123 45 67, запасной: 8-912-000-11-22.';
    const r = await guard.ask({ userId: 'u1', prompt });
    expect(m.requests[0]!.prompt).toBe('Звоните [PHONE_1] или [PHONE_1], запасной: [PHONE_2].');
    expect(r.text).toBe('+7 (999) 123-45-67|8-912-000-11-22');
    expect(r.masked).toBe(2);
    const second = fake('p2', ['[PHONE_1]']);
    const g2 = createGuard({ primary: second.model, now: clock().now, budget: BUDGET });
    await g2.ask({ userId: 'u', prompt: 'номер 89991234567 и +79991234567.' });
    expect(second.requests[0]!.prompt).toBe('номер [PHONE_1] и [PHONE_1].');
  });

  it('карта: с верной контрольной суммой маскируется, с неверной и обычные числа остаются', async () => {
    const { guard, m } = make(['[CARD_1]']);
    const r = await guard.ask({
      userId: 'u1',
      prompt: 'Карта 4111-1111-1111-1111, ошибочная 1234 5678 9012 3456, заказ 12345678, год 2026.',
    });
    expect(m.requests[0]!.prompt).toBe('Карта [CARD_1], ошибочная 1234 5678 9012 3456, заказ 12345678, год 2026.');
    expect(r.text).toBe('4111-1111-1111-1111');
    const g2 = make(['[CARD_1]']);
    await g2.guard.ask({ userId: 'u', prompt: 'карта 4111111111111111 и 4111 1111 1111 1111' });
    expect(g2.m.requests[0]!.prompt).toBe('карта [CARD_1] и [CARD_1]');
  });

  it('разные типы нумеруются независимо; номер внутри email не принимается за телефон', async () => {
    const { guard, m } = make(['ok']);
    await guard.ask({ userId: 'u1', prompt: '89991234567@mail.ru, 89991234567, a@b.io' });
    expect(m.requests[0]!.prompt).toBe('[EMAIL_1], [PHONE_1], [EMAIL_2]');
  });

  it('подстановка за один проход; незнакомые плейсхолдеры остаются', async () => {
    const { guard } = make(['[EMAIL_1] [EMAIL_7] [PHONE_1] [CARD_1]']);
    const r = await guard.ask({ userId: 'u1', prompt: 'пишите на a@x.ru' });
    expect(r.text).toBe('a@x.ru [EMAIL_7] [PHONE_1] [CARD_1]');
  });

  it('запасная модель тоже получает только маскированный текст', async () => {
    const c = clock();
    const primary = fake('p', [new ModelError('timeout')]);
    const backup = fake('b', ['привет [EMAIL_1]']);
    const guard = createGuard({ primary: primary.model, fallback: backup.model, now: c.now, budget: BUDGET });
    const r = await guard.ask({ userId: 'u1', prompt: 'Письмо для secret@corp.ru' });
    expect(primary.requests[0]!.prompt).toBe('Письмо для [EMAIL_1]');
    expect(backup.requests[0]!.prompt).toBe('Письмо для [EMAIL_1]');
    expect(r.text).toBe('привет secret@corp.ru');
  });
});

describe('кэш', () => {
  it('повтор – из кэша: cached, tokens 0, без вызова, бюджет не списан', async () => {
    const { guard, m } = make(['ответ']);
    const a = await guard.ask({ userId: 'u1', prompt: 'вопрос' });
    const b = await guard.ask({ userId: 'u1', prompt: 'вопрос' });
    expect(a).toMatchObject({ text: 'ответ', model: 'primary', cached: false, tokens: 100 });
    expect(b).toMatchObject({ text: 'ответ', model: 'primary', cached: true, tokens: 0 });
    expect(m.requests).toHaveLength(1);
    expect(guard.usage('u1').used).toBe(100);
  });

  it('ключ – маскированный prompt: чужой ответ из кэша восстанавливается по таблице текущего запроса', async () => {
    const { guard, m } = make(['Отправлено на [EMAIL_1].']);
    const a = await guard.ask({ userId: 'alice', prompt: 'Отправь на alice@a.ru' });
    const b = await guard.ask({ userId: 'bob', prompt: 'Отправь на bob@b.ru' });
    expect(m.requests).toHaveLength(1);
    expect(a.text).toBe('Отправлено на alice@a.ru.');
    expect(b).toMatchObject({ text: 'Отправлено на bob@b.ru.', cached: true, tokens: 0 });
    expect(b.text).not.toContain('alice');
    expect(guard.usage('bob').used).toBe(0);
  });

  it('срок жизни: свежо при t - storedAt < ttl, дальше – новый вызов', async () => {
    const { guard, c, m } = make(['один', 'два', 'три'], { cacheTtlMs: 60_000 });
    await guard.ask({ userId: 'u1', prompt: 'q' });
    c.advance(59_999);
    expect((await guard.ask({ userId: 'u1', prompt: 'q' })).cached).toBe(true);
    c.advance(1);
    const r = await guard.ask({ userId: 'u1', prompt: 'q' });
    expect(r).toMatchObject({ text: 'два', cached: false });
    expect(m.requests).toHaveLength(2);
  });

  it('одновременные одинаковые запросы делят один вызов; присоединившийся не платит', async () => {
    const c = clock();
    const g = gated('primary');
    const guard = createGuard({ primary: g.model, now: c.now, budget: BUDGET });
    const first = guard.ask({ userId: 'u1', prompt: 'тяжёлый вопрос' });
    const second = guard.ask({ userId: 'u2', prompt: 'тяжёлый вопрос' });
    await Promise.resolve();
    g.release({ text: 'ответ', tokens: 70 });
    const [a, b] = await Promise.all([first, second]);
    expect(g.requests).toHaveLength(1);
    expect(a).toMatchObject({ cached: false, tokens: 70 });
    expect(b).toMatchObject({ cached: true, tokens: 0, text: 'ответ' });
    expect(guard.usage('u1').used).toBe(70);
    expect(guard.usage('u2').used).toBe(0);
  });

  it('ошибка делится с присоединившимися', async () => {
    const c = clock();
    const g = gated('primary');
    const guard = createGuard({ primary: g.model, now: c.now, budget: BUDGET });
    const first = guard.ask({ userId: 'u1', prompt: 'q' });
    const second = guard.ask({ userId: 'u2', prompt: 'q' });
    await Promise.resolve();
    g.release(new ModelError('server'));
    expect(await code(first)).toBe('unavailable');
    expect(await code(second)).toBe('unavailable');
  });

  it('после ошибки тот же запрос снова идёт в модель', async () => {
    const { guard, m } = make([new ModelError('server'), 'ожил']);
    expect(await code(guard.ask({ userId: 'u1', prompt: 'q' }))).toBe('unavailable');
    const r = await guard.ask({ userId: 'u1', prompt: 'q' });
    expect(r).toMatchObject({ text: 'ожил', cached: false });
    expect(m.requests).toHaveLength(2);
  });
});

describe('бюджет', () => {
  // prompt из 40 символов, maxTokens 100: оценка = 10 + 100 = 110
  const P = (n: number) => `${'а'.repeat(39)}${n}`;

  it('оценка до вызова: used + оценка > limit – budget_exceeded без вызова; равенство допустимо', async () => {
    const c = clock();
    const m = fake('primary', [{ text: 'a', tokens: 150 }, { text: 'b', tokens: 150 }, 'c']);
    const guard = createGuard({ primary: m.model, now: c.now, budget: { tokens: 260, periodMs: HOUR }, maxTokens: 100 });
    await guard.ask({ userId: 'u1', prompt: P(1) });
    await guard.ask({ userId: 'u1', prompt: P(2) }); // 150 + 110 = 260 – ровно лимит
    expect(guard.usage('u1').used).toBe(300);
    expect(await code(guard.ask({ userId: 'u1', prompt: P(3) }))).toBe('budget_exceeded');
    expect(m.requests).toHaveLength(2);
  });

  it('списывается фактический расход из ответа, а не оценка; maxTokens уходит модели как есть', async () => {
    const c = clock();
    const m = fake('primary', [{ text: 'a', tokens: 42 }]);
    const guard = createGuard({ primary: m.model, now: c.now, budget: BUDGET, maxTokens: 123 });
    const r = await guard.ask({ userId: 'u1', prompt: 'q' });
    expect(r.tokens).toBe(42);
    expect(guard.usage('u1').used).toBe(42);
    expect(m.requests[0]!.maxTokens).toBe(123);
    const d = make(['x']);
    await d.guard.ask({ userId: 'u', prompt: 'q' });
    expect(d.m.requests[0]!.maxTokens).toBe(256);
  });

  it('лимит у каждого пользователя свой; окно сбрасывается по часам', async () => {
    const c = clock(10 * HOUR + 5_000);
    const m = fake('primary', [{ text: 'a', tokens: 500 }, 'b', { text: 'c', tokens: 10 }]);
    const guard = createGuard({ primary: m.model, now: c.now, budget: { tokens: 600, periodMs: HOUR }, maxTokens: 100 });
    await guard.ask({ userId: 'u1', prompt: 'первый' });
    expect(guard.usage('u1')).toEqual({ used: 500, limit: 600, resetsAt: 11 * HOUR });
    expect(guard.usage('u2')).toEqual({ used: 0, limit: 600, resetsAt: 11 * HOUR });
    expect(await code(guard.ask({ userId: 'u1', prompt: 'второй' }))).toBe('budget_exceeded');
    expect((await guard.ask({ userId: 'u2', prompt: 'второй' })).tokens).toBe(100);
    c.set(11 * HOUR);
    expect(guard.usage('u1')).toEqual({ used: 0, limit: 600, resetsAt: 12 * HOUR });
    expect((await guard.ask({ userId: 'u1', prompt: 'третий' })).tokens).toBe(10);
    c.set(11 * HOUR - 1);
    expect(guard.usage('u1').used).toBe(500);
  });

  it('исчерпанный бюджет не мешает получить ответ из кэша', async () => {
    const c = clock();
    const m = fake('primary', [{ text: 'дорого', tokens: 1000 }]);
    const guard = createGuard({ primary: m.model, now: c.now, budget: { tokens: 1000, periodMs: HOUR } });
    await guard.ask({ userId: 'u1', prompt: 'вопрос' });
    expect(await code(guard.ask({ userId: 'u1', prompt: 'другой вопрос' }))).toBe('budget_exceeded');
    const r = await guard.ask({ userId: 'u1', prompt: 'вопрос' });
    expect(r).toMatchObject({ text: 'дорого', cached: true, tokens: 0 });
  });

  it('оценка считается по маскированному prompt', async () => {
    const c = clock();
    const m = fake('primary', ['ok']);
    // маскированный: «[EMAIL_1]» = 9 символов → ceil(9/4) = 3, + maxTokens 10 = 13 ≤ 13
    const guard = createGuard({ primary: m.model, now: c.now, budget: { tokens: 13, periodMs: HOUR }, maxTokens: 10 });
    const r = await guard.ask({ userId: 'u1', prompt: 'long.address.for.test@example-domain.com' });
    expect(r.text).toBe('ok');
  });
});

describe('сбои моделей', () => {
  it('timeout, rate_limit, server и неизвестная ошибка – переход к запасной; списывается её расход', async () => {
    for (const err of [new ModelError('timeout'), new ModelError('rate_limit'), new ModelError('server'), new Error('сеть')]) {
      const c = clock();
      const primary = fake('p', [err]);
      const backup = fake('b', [{ text: 'из запасной', tokens: 33 }]);
      const guard = createGuard({ primary: primary.model, fallback: backup.model, now: c.now, budget: BUDGET });
      const r = await guard.ask({ userId: 'u1', prompt: 'q' });
      expect(r).toMatchObject({ text: 'из запасной', model: 'b', cached: false, tokens: 33 });
      expect(guard.usage('u1').used).toBe(33);
    }
  });

  it('запасной нет или она тоже упала – unavailable, токены не списаны', async () => {
    const c = clock();
    const lone = createGuard({ primary: fake('p', [new ModelError('timeout')]).model, now: c.now, budget: BUDGET });
    expect(await code(lone.ask({ userId: 'u1', prompt: 'q' }))).toBe('unavailable');
    const both = createGuard({
      primary: fake('p', [new ModelError('rate_limit')]).model,
      fallback: fake('b', [new ModelError('server')]).model,
      now: c.now,
      budget: BUDGET,
    });
    expect(await code(both.ask({ userId: 'u1', prompt: 'q' }))).toBe('unavailable');
    expect(both.usage('u1').used).toBe(0);
  });

  it('bad_request и auth – model_rejected без перехода к запасной', async () => {
    for (const kind of ['bad_request', 'auth'] as const) {
      const c = clock();
      const backup = fake('b', ['не должна вызываться']);
      const guard = createGuard({ primary: fake('p', [new ModelError(kind)]).model, fallback: backup.model, now: c.now, budget: BUDGET });
      expect(await code(guard.ask({ userId: 'u1', prompt: 'q' }))).toBe('model_rejected');
      expect(backup.requests).toHaveLength(0);
    }
    const c = clock();
    const guard = createGuard({
      primary: fake('p', [new ModelError('timeout')]).model,
      fallback: fake('b', [new ModelError('auth')]).model,
      now: c.now,
      budget: BUDGET,
    });
    expect(await code(guard.ask({ userId: 'u1', prompt: 'q' }))).toBe('model_rejected');
  });
});

describe('аудит', () => {
  it('запись на каждый завершённый ask; в журнале нет ПДн и текстов', async () => {
    const c = clock(5_000);
    const primary = fake('p', ['[EMAIL_1] [PHONE_1]', new ModelError('server')]);
    const guard = createGuard({ primary: primary.model, now: c.now, budget: { tokens: 1000, periodMs: HOUR }, maxTokens: 100 });
    const prompt = 'Пишите boss@corp.ru или звоните +7 999 123 45 67, карта 4111 1111 1111 1111, ещё boss@corp.ru';
    await guard.ask({ userId: 'u1', prompt });
    c.advance(10);
    await guard.ask({ userId: 'u1', prompt });
    c.advance(10);
    await code(guard.ask({ userId: 'u2', prompt: 'другое' }));
    c.advance(10);
    await code(guard.ask({ userId: 'u1', prompt: 'x'.repeat(4000) }));
    await code(guard.ask({ userId: '', prompt: 'x' }));

    const log = guard.audit();
    expect(log).toEqual([
      { userId: 'u1', at: 5_000, outcome: 'ok', model: 'p', tokens: 100, pii: { EMAIL: 1, PHONE: 1, CARD: 1 } },
      { userId: 'u1', at: 5_010, outcome: 'cached', model: null, tokens: 0, pii: { EMAIL: 1, PHONE: 1, CARD: 1 } },
      { userId: 'u2', at: 5_020, outcome: 'unavailable', model: null, tokens: 0, pii: {} },
      { userId: 'u1', at: 5_030, outcome: 'budget_exceeded', model: null, tokens: 0, pii: {} },
    ]);
    const dump = JSON.stringify(log);
    for (const secret of ['boss@corp.ru', '999', '4111', 'Пишите']) expect(dump).not.toContain(secret);
    log.length = 0;
    expect(guard.audit()).toHaveLength(4);
  });
});

describe('DESIGN.md', () => {
  it('разделы «Решения», «Компромиссы», «Границы применимости» не короче 200 символов', () => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../DESIGN.md');
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, 'utf8');
    for (const h of ['Решения', 'Компромиссы', 'Границы применимости']) {
      const m = new RegExp(`^## ${h}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(text);
      expect(m, h).not.toBeNull();
      expect(m![1]!.trim().length, h).toBeGreaterThanOrEqual(200);
    }
  });
});
