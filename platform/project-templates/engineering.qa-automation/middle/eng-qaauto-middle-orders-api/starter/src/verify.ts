import request from 'supertest';

import type { CreateApp } from './types';

// Ваша проверка API заказов (см. contract.md): бросьте Error, если сервис нарушает контракт.
export async function verify(createApp: CreateApp): Promise<void> {
  void request;
  void createApp;
  throw new Error('verify не реализован');
}
