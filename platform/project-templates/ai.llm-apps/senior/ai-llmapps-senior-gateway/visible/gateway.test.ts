// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { describe, expect, it } from 'vitest';

import { createGateway, GatewayError } from '../../src/gateway';
import type { Provider } from '../../src/provider';

const provider: Provider = {
  name: 'demo',
  async complete() {
    return { text: '{"city":"Казань","days":3}', inputTokens: 50, outputTokens: 10 };
  },
};
const fields = [
  { name: 'city', type: 'string' as const, required: true },
  { name: 'days', type: 'number' as const, required: true },
];

describe('шлюз (visible)', () => {
  it('извлекает поля из ответа модели', async () => {
    const g = createGateway({ providers: [provider], budgetTokens: 10_000 });
    const r = await g.extract({ instruction: 'Командировка', text: 'Еду в Казань на три дня', fields });
    expect(r).toMatchObject({ data: { city: 'Казань', days: 3 }, provider: 'demo', cached: false, tokens: 60 });
  });

  it('пустой текст — bad_request', async () => {
    const g = createGateway({ providers: [provider], budgetTokens: 10_000 });
    await expect(g.extract({ instruction: 'x', text: ' ', fields })).rejects.toBeInstanceOf(GatewayError);
  });
});
