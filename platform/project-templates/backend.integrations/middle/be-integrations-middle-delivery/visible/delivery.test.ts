// PLATFORM-OWNED: видимые тесты платформы; правки кандидата при проверке игнорируются
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDeliveryClient } from '../../src/delivery-client';

import { startMockProvider, type MockProvider } from './mock-provider';

let mock: MockProvider;
beforeEach(async () => {
  mock = await startMockProvider();
});
afterEach(() => mock.close());

const QUOTE = { quote_id: 'q-1', price: { amount: '1234.50', currency: 'RUB' }, eta: { min_days: 1, max_days: 3 } };

describe('delivery client (visible)', () => {
  it('quote: маппинг запроса и ответа', async () => {
    mock.script('/v2/quotes', { status: 200, body: QUOTE });
    const client = createDeliveryClient({ baseUrl: mock.baseUrl });
    const q = await client.quote({ fromCity: 'Москва', toCity: 'Казань', weightKg: 1.25 });
    expect(q).toEqual({ priceKop: 123450, etaDays: { min: 1, max: 3 } });
    expect(mock.requests[0]!.body).toEqual({ from_city: 'Москва', to_city: 'Казань', weight_grams: 1250 });
  });

  it('quote: повтор после 503', async () => {
    mock.script('/v2/quotes', { status: 503, body: {} }, { status: 200, body: QUOTE });
    const client = createDeliveryClient({ baseUrl: mock.baseUrl, sleep: async () => {} });
    await expect(client.quote({ fromCity: 'A', toCity: 'B', weightKg: 1 })).resolves.toMatchObject({ priceKop: 123450 });
    expect(mock.requests).toHaveLength(2);
  });
});
