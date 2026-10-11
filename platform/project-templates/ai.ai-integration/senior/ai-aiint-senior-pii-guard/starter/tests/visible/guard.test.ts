// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { describe, expect, it } from 'vitest';

import { createGuard, GuardError } from '../../src/guard';
import { ModelError, type Model, type ModelRequest } from '../../src/model';

function model(name: string, text: string, tokens = 50): Model & { seen: ModelRequest[] } {
  const seen: ModelRequest[] = [];
  return {
    name,
    seen,
    async complete(req) {
      seen.push(req);
      return { text, tokens };
    },
  };
}

const budget = { tokens: 10_000, periodMs: 3_600_000 };

describe('охранный шлюз (visible)', () => {
  it('ПДн не уходят модели, в ответе возвращаются', async () => {
    const m = model('main', 'Отправил на [EMAIL_1]');
    const guard = createGuard({ primary: m, now: () => 1000, budget });
    const r = await guard.ask({ userId: 'u1', prompt: 'Напиши на ivan@example.com' });
    expect(m.seen[0]!.prompt).toBe('Напиши на [EMAIL_1]');
    expect(r.text).toBe('Отправил на ivan@example.com');
  });

  it('повторный запрос берётся из кэша', async () => {
    const m = model('main', 'ответ');
    const guard = createGuard({ primary: m, now: () => 1000, budget });
    await guard.ask({ userId: 'u1', prompt: 'вопрос' });
    const r = await guard.ask({ userId: 'u1', prompt: 'вопрос' });
    expect(r).toMatchObject({ cached: true, tokens: 0 });
    expect(m.seen).toHaveLength(1);
  });

  it('бюджет исчерпан — budget_exceeded без вызова модели', async () => {
    const m = model('main', 'ответ', 900);
    const guard = createGuard({ primary: m, now: () => 1000, budget: { tokens: 1000, periodMs: 3_600_000 }, maxTokens: 100 });
    await guard.ask({ userId: 'u1', prompt: 'первый' });
    await expect(guard.ask({ userId: 'u1', prompt: 'второй' })).rejects.toBeInstanceOf(GuardError);
    expect(m.seen).toHaveLength(1);
  });

  it('при таймауте основной модели отвечает запасная', async () => {
    const broken: Model = {
      name: 'main',
      async complete() {
        throw new ModelError('timeout');
      },
    };
    const backup = model('backup', 'из запасной');
    const guard = createGuard({ primary: broken, fallback: backup, now: () => 1000, budget });
    const r = await guard.ask({ userId: 'u1', prompt: 'вопрос' });
    expect(r).toMatchObject({ text: 'из запасной', model: 'backup' });
  });
});
