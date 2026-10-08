import { z } from 'zod';

import { AppError, errors, toErrorResponse, withErrors } from '@/server/errors';

describe('errors', () => {
  it('AppError → его статус и тело { error: { code, message } }', async () => {
    const res = toErrorResponse(errors.notFound('нет такого'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'нет такого' } });
  });

  it('ZodError → 400 validation_failed с путями', async () => {
    const err = z.object({ a: z.string() }).safeParse({ a: 1 }).error;
    const res = toErrorResponse(err);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details[0].path).toBe('a');
  });

  it('неизвестная ошибка → 500 без текста исключения', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = toErrorResponse(new Error('секрет в стектрейсе'));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('секрет');
    spy.mockRestore();
  });

  it('withErrors ловит брошенное', async () => {
    const handler = withErrors(async () => {
      throw new AppError('blocked_url', 'адрес запрещён', 400);
    });
    const res = await handler();
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('blocked_url');
  });
});
