// Клиент форм входа по почте (/api/auth/register|verify|login|password/*). Свой fetch, а не
// lib/api.ts: там 401 переписывается в «Сессия закончилась», а здесь 401 – «неверный пароль»,
// и нужен `details.devCode` из ответа 403.

export class AuthFormError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly devCode: string | null = null,
  ) {
    super(message);
    this.name = 'AuthFormError';
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthFormError('Нет связи с сервером. Проверьте сеть и повторите.', 0, 'network');
  }
  const data = (await res.json().catch(() => ({}))) as T & {
    error?: { code?: string; message?: string; details?: { devCode?: string } | unknown };
  };
  if (!res.ok) {
    const details = data.error?.details as { devCode?: unknown } | undefined;
    const dev = typeof details?.devCode === 'string' ? details.devCode : null;
    // validation_failed: первое сообщение Zod понятнее общего «Данные не прошли проверку».
    const issues = Array.isArray(data.error?.details) ? (data.error.details as { message?: string }[]) : [];
    const message = (data.error?.code === 'validation_failed' && issues[0]?.message) || data.error?.message || `Ошибка ${res.status}`;
    throw new AuthFormError(message, res.status, data.error?.code ?? 'unknown', dev);
  }
  return data;
}

export interface CodeSent {
  sent: true;
  /** Только при локальной разработке (localhost, не production); на стенде не приходит. */
  devCode?: string;
}

export const registerEmail = (b: { email: string; password: string; consent: string }) => post<CodeSent>('/api/auth/register', b);
export const verifyEmailCode = (b: { email: string; code: string; next: string | null }) => post<{ next: string }>('/api/auth/verify', b);
export const resendEmailCode = (b: { email: string }) => post<CodeSent>('/api/auth/verify/resend', b);
export const loginEmail = (b: { email: string; password: string; next: string | null }) => post<{ next: string }>('/api/auth/login', b);
export const forgotPassword = (b: { email: string }) => post<{ sent: true }>('/api/auth/password/forgot', b);
export const resetPasswordWithCode = (b: { email: string; code: string; password: string; next: string | null }) =>
  post<{ next: string }>('/api/auth/password/reset', b);
