// PLATFORM-OWNED: скрытые тесты платформы; кандидату не выдаются
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createGateway, GatewayError, type ExtractRequest, type Field } from '../src/gateway';

import { fake, ProviderError } from './helpers/fake-provider';

const FIELDS: Field[] = [
  { name: 'name', type: 'string', required: true },
  { name: 'age', type: 'number', required: true },
  { name: 'remote', type: 'boolean', required: false },
];
const REQ: ExtractRequest = { instruction: 'Данные кандидата из письма.', text: 'Меня зовут Иван, мне 30, хочу удалёнку.', fields: FIELDS };
const VALID = '{"name":"Иван","age":30,"remote":true}';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GatewayError);
    return (e as GatewayError).code;
  }
  throw new Error('ожидалась GatewayError');
}

describe('запрос и ответ', () => {
  it('неверный запрос – bad_request без вызова провайдера', async () => {
    const p = fake('p');
    const g = createGateway({ providers: [p.provider], budgetTokens: 100_000 });
    expect(await code(g.extract({ ...REQ, text: '   ' }))).toBe('bad_request');
    expect(await code(g.extract({ ...REQ, fields: [] }))).toBe('bad_request');
    expect(await code(g.extract({ ...REQ, fields: [{ name: 'Bad-name', type: 'string', required: true }] }))).toBe('bad_request');
    expect(await code(g.extract({ ...REQ, fields: [FIELDS[0]!, FIELDS[0]!] }))).toBe('bad_request');
    expect(p.requests).toHaveLength(0);
  });

  it('JSON в ограде и с текстом вокруг; лишние ключи отброшены; токены и maxTokens', async () => {
    const p = fake('main', ['Вот результат:\n```json\n{"name":"Иван","age":30,"remote":true,"salary":1}\n```\nГотово.']);
    const g = createGateway({ providers: [p.provider], budgetTokens: 100_000 });
    const r = await g.extract(REQ);
    expect(r).toEqual({ data: { name: 'Иван', age: 30, remote: true }, provider: 'main', cached: false, repaired: false, tokens: 120 });
    expect(p.requests[0]!.maxTokens).toBe(512);
    expect(p.requests[0]!.user).toContain('Меня зовут Иван');
    expect(g.spent()).toBe(120);
  });

  it('необязательное поле отсутствует или null – null', async () => {
    const p = fake('p', ['{"name":"Иван","age":30}', '{"name":"Иван","age":30,"remote":null}']);
    const g = createGateway({ providers: [p.provider], budgetTokens: 100_000, maxTokens: 64 });
    expect((await g.extract(REQ)).data).toEqual({ name: 'Иван', age: 30, remote: null });
    expect((await g.extract({ ...REQ, text: REQ.text + ' ' })).data.remote).toBeNull();
    expect(p.requests[0]!.maxTokens).toBe(64);
  });

  it('ремонт: невалидный ответ – одна повторная попытка у того же провайдера с прежним ответом', async () => {
    const p = fake('p', ['не знаю', VALID]);
    const p2 = fake('p2', [VALID]);
    const g = createGateway({ providers: [p.provider, p2.provider], budgetTokens: 100_000 });
    const r = await g.extract(REQ);
    expect(r).toMatchObject({ repaired: true, provider: 'p', tokens: 240 });
    expect(p.requests).toHaveLength(2);
    expect(p.requests[1]!.user).toContain('не знаю');
    expect(p2.requests).toHaveLength(0);
  });

  it('строгие типы: число строкой и нет обязательного поля – ремонт', async () => {
    const p = fake('p', ['{"name":"Иван","age":"30"}', '{"age":30}', VALID]);
    const g = createGateway({ providers: [p.provider], budgetTokens: 100_000 });
    expect(await code(g.extract(REQ))).toBe('invalid_output');
    expect(p.requests).toHaveLength(2);
  });

  it('ремонт не помог – invalid_output, следующий провайдер не вызывается', async () => {
    const p = fake('p', ['{oops', '[1,2]']);
    const p2 = fake('p2', [VALID]);
    const g = createGateway({ providers: [p.provider, p2.provider], budgetTokens: 100_000 });
    expect(await code(g.extract(REQ))).toBe('invalid_output');
    expect(p2.requests).toHaveLength(0);
  });
});

describe('провайдеры', () => {
  it('timeout, rate_limit, server – фолбэк на следующего по порядку', async () => {
    const a = fake('a', [new ProviderError('timeout')]);
    const b = fake('b', [new ProviderError('rate_limit')]);
    const c = fake('c', [new ProviderError('server')]);
    const d = fake('d', [VALID]);
    const g = createGateway({ providers: [a.provider, b.provider, c.provider, d.provider], budgetTokens: 100_000 });
    expect((await g.extract(REQ)).provider).toBe('d');
  });

  it('все упали – all_providers_failed', async () => {
    const a = fake('a', [new ProviderError('server')]);
    const b = fake('b', [new ProviderError('timeout')]);
    const g = createGateway({ providers: [a.provider, b.provider], budgetTokens: 100_000 });
    expect(await code(g.extract(REQ))).toBe('all_providers_failed');
  });

  it('auth и bad_request – provider_rejected, без перехода к следующему', async () => {
    for (const kind of ['auth', 'bad_request'] as const) {
      const a = fake('a', [new ProviderError(kind)]);
      const b = fake('b', [VALID]);
      const g = createGateway({ providers: [a.provider, b.provider], budgetTokens: 100_000 });
      expect(await code(g.extract(REQ))).toBe('provider_rejected');
      expect(b.requests).toHaveLength(0);
    }
  });
});

describe('персональные данные', () => {
  it('email и телефоны не уходят в модель; плейсхолдеры по порядку; в результате – исходные значения', async () => {
    const text = 'Пишите на ivan.petrov@mail.ru или звоните +7 (912) 345-67-89, запасной 8 916 000 11 22. Ещё раз: ivan.petrov@mail.ru';
    const fields: Field[] = [
      { name: 'email', type: 'string', required: true },
      { name: 'phone', type: 'string', required: true },
      { name: 'note', type: 'string', required: false },
    ];
    const p = fake('p', ['{"email":"[EMAIL_1]"}', '{"email":"[EMAIL_1]","phone":"[PHONE_1]","note":"резерв [PHONE_2]"}']);
    const g = createGateway({ providers: [p.provider], budgetTokens: 100_000 });
    const r = await g.extract({ instruction: 'Контакты', text, fields });
    expect(r.data).toEqual({ email: 'ivan.petrov@mail.ru', phone: '+7 (912) 345-67-89', note: 'резерв 8 916 000 11 22' });
    for (const req of p.requests) {
      const all = req.system + req.user;
      expect(all).not.toContain('ivan.petrov@mail.ru');
      expect(all).not.toContain('345-67-89');
      expect(all).not.toContain('916 000 11 22');
    }
    expect(p.requests[0]!.user).toContain('[EMAIL_1]');
    expect(p.requests[0]!.user).toContain('[PHONE_2]');
    expect(p.requests[0]!.user).not.toContain('[EMAIL_2]');
  });
});

describe('бюджет', () => {
  it('оценка больше бюджета – budget_exceeded без вызова', async () => {
    const p = fake('p', [VALID]);
    const g = createGateway({ providers: [p.provider], budgetTokens: 100 });
    expect(await code(g.extract(REQ))).toBe('budget_exceeded');
    expect(p.requests).toHaveLength(0);
    expect(g.spent()).toBe(0);
  });

  it('потрачено по фактическим токенам; следующий вызов не влезает', async () => {
    const p = fake('p', [{ text: VALID, inputTokens: 1500, outputTokens: 300 }, VALID]);
    const g = createGateway({ providers: [p.provider], budgetTokens: 2000, maxTokens: 300 });
    expect((await g.extract(REQ)).tokens).toBe(1800);
    expect(await code(g.extract({ ...REQ, text: 'Другой текст' }))).toBe('budget_exceeded');
    expect(p.requests).toHaveLength(1);
    expect(g.spent()).toBe(1800);
  });

  it('бюджет проверяется и перед ремонтом', async () => {
    const p = fake('p', [{ text: 'мусор', inputTokens: 1500, outputTokens: 300 }, VALID]);
    const g = createGateway({ providers: [p.provider], budgetTokens: 2000, maxTokens: 300 });
    expect(await code(g.extract(REQ))).toBe('budget_exceeded');
    expect(p.requests).toHaveLength(1);
  });
});

describe('кэш', () => {
  it('повтор – из кэша: cached, 0 токенов, без вызова; изменение результата не портит кэш', async () => {
    const p = fake('p', [VALID]);
    const g = createGateway({ providers: [p.provider], budgetTokens: 100_000 });
    const a = await g.extract(REQ);
    a.data.name = 'испорчено';
    const b = await g.extract({ ...REQ, fields: FIELDS.map((f) => ({ ...f })) });
    expect(b).toMatchObject({ cached: true, tokens: 0, data: { name: 'Иван' } });
    expect(p.requests).toHaveLength(1);
    expect(g.spent()).toBe(120);
  });

  it('ошибки не кэшируются', async () => {
    const p = fake('p', [new ProviderError('server'), VALID]);
    const g = createGateway({ providers: [p.provider], budgetTokens: 100_000 });
    expect(await code(g.extract(REQ))).toBe('all_providers_failed');
    expect((await g.extract(REQ)).cached).toBe(false);
  });

  it('одновременные одинаковые запросы – один вызов провайдера', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = fake('p', [async () => (await gate, { text: VALID, inputTokens: 10, outputTokens: 5 })]);
    const g = createGateway({ providers: [p.provider], budgetTokens: 100_000 });
    const runs = [g.extract(REQ), g.extract(REQ), g.extract(REQ)];
    await new Promise((r) => setImmediate(r));
    release();
    const out = await Promise.all(runs);
    expect(p.requests).toHaveLength(1);
    expect(out.map((r) => r.data)).toEqual([out[0]!.data, out[0]!.data, out[0]!.data]);
  });
});

describe('DESIGN.md', () => {
  it('разделы «Решения», «Компромиссы», «Границы применимости» не короче 200 символов', () => {
    // new URL(…) в jsdom – URL из jsdom; путь считаем от файла теста.
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
