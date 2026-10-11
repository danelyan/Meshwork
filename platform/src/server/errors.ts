import { ZodError } from 'zod';

/** Единый формат ошибки API: `{ error: { code, message } }` + HTTP-статус. */
export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Известные коды. Лейны могут добавлять свои строкой (`blocked_url`, …). */
export type ErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'blocked_url'
  | 'llm_unavailable'
  | 'not_implemented'
  | 'internal'
  | (string & {});

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  badRequest: (message = 'Некорректный запрос', details?: unknown) =>
    new AppError('bad_request', message, 400, details),
  unauthorized: (message = 'Нужен вход') => new AppError('unauthorized', message, 401),
  /** Кука подписана верно, но аккаунта в БД нет; клиент (`lib/api.ts`) ведёт на /auth. */
  sessionStale: () => new AppError('session_stale', 'Сессия устарела. Войдите заново.', 401),
  forbidden: (message = 'Нет доступа') => new AppError('forbidden', message, 403),
  /** Для чужих объектов тоже 404 – не раскрываем, что объект существует. */
  notFound: (message = 'Не найдено') => new AppError('not_found', message, 404),
  conflict: (message: string) => new AppError('conflict', message, 409),
  payloadTooLarge: (message = 'Слишком большой запрос') =>
    new AppError('payload_too_large', message, 413),
  rateLimited: (message = 'Слишком много запросов') => new AppError('rate_limited', message, 429),
};

export function errorBody(code: ErrorCode, message: string, details?: unknown): ErrorBody {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}

export function jsonError(code: ErrorCode, message: string, status: number, details?: unknown): Response {
  return Response.json(errorBody(code, message, details), { status });
}

/**
 * Любая ошибка → Response. AppError – как есть, ZodError – 400 validation_failed
 * с issues, остальное – 500 без текста исключения наружу.
 */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof AppError) return jsonError(err.code, err.message, err.status, err.details);
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return jsonError('validation_failed', 'Данные не прошли проверку', 400, issues);
  }
  console.error('[api] unhandled error', err);
  return jsonError('internal', 'Внутренняя ошибка', 500);
}

/** Пути, где протухшая кука не должна давать 401: выход, проверка входа, сам вход. */
const STALE_CHECK_SKIP = ['/api/auth/logout', '/api/auth/me', '/api/auth/stale', '/api/auth/yandex', '/api/auth/register', '/api/auth/verify', '/api/auth/login', '/api/auth/password/', '/api/demo/login', '/api/dev/', '/api/admin/'];

/** Обёртка route handler'а: бросай AppError/ZodError – получишь правильный ответ. */
export function withErrors<A extends unknown[]>(
  handler: (...args: A) => Promise<Response> | Response,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      const req = args[0];
      if (req instanceof Request && !STALE_CHECK_SKIP.some((p) => new URL(req.url).pathname.startsWith(p))) {
        const { isSessionStale } = await import('./auth/stale');
        if (await isSessionStale(req)) {
          const res = toErrorResponse(errors.sessionStale());
          res.headers.append('set-cookie', 'cid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
          return res;
        }
      }
      return await handler(...args);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}
