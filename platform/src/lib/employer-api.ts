// Клиент кабинета работодателя и входящих приглашений кандидата (lane employer).
import { ApiError, postJson, readError, request } from './api';

export interface VacancyBody {
  title: string;
  specialization: 'backend' | 'frontend';
  grade: 'junior' | 'middle';
  salaryFrom: number;
  salaryTo: number;
  teamDescription: string | null;
  description: string | null;
  stack: string[];
  needs: { catalogId: string; weight: number }[];
}

const sendJson = <T>(url: string, method: 'PUT' | 'PATCH', body: unknown) =>
  request<T>(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const createVacancyApi = (body: VacancyBody) => postJson<{ id: string }>('/api/employer/vacancies', body);
export const updateVacancyApi = (id: string, body: VacancyBody) => sendJson<{ id: string }>(`/api/employer/vacancies/${encodeURIComponent(id)}`, 'PUT', body);
export const archiveVacancyApi = (id: string, archived: boolean) =>
  sendJson<{ id: string }>(`/api/employer/vacancies/${encodeURIComponent(id)}`, 'PATCH', { archived });

export interface InviteBody {
  candidateId: string;
  vacancyId: string | null;
  message: string;
  /** Вилка, ₽ в месяц; salaryTo ≥ salaryFrom. */
  salaryFrom: number;
  salaryTo: number;
}
export const inviteApi = (body: InviteBody) => postJson<{ id: string; status: string }>('/api/employer/invitations', body);

export const respondInvitationApi = (id: string, action: 'accept' | 'decline') =>
  postJson<{ id: string; status: string }>(`/api/invitations/${encodeURIComponent(id)}`, { action });
export const setContactApi = (contact: string) => postJson<{ contact: string | null }>('/api/profile/contact', { contact });
export const setPrivacyApi = (hiddenFromEmployers: boolean) =>
  postJson<{ hiddenFromEmployers: boolean }>('/api/profile/privacy', { hiddenFromEmployers });

/** Ход помощника работодателя: SSE-поток EmployerAgentEvent (app/api/employer/assistant/messages). */
export async function openEmployerAssistantStream(input: { text: string; conversationId?: string }, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  let res: Response;
  try {
    res = await fetch('/api/employer/assistant/messages', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(input),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError('Нет связи с сервером. Проверьте сеть и повторите.', 0, 'network');
  }
  if (!res.ok) throw await readError(res);
  if (!res.body) throw new ApiError('Сервер не отдал поток ответа.', 502);
  return res.body;
}

/** Профиль компании работодателя (R-E-01): GET/PATCH /api/employer/company. */
export interface CompanyBody {
  name: string;
  description: string | null;
  industry: string | null;
  inn: string | null;
  contact: string | null;
}
/** Отказ валидации с текстами по полям (`validation_failed`, details = [{ path, message }]). */
export class CompanyFieldsError extends ApiError {
  constructor(
    message: string,
    readonly fields: Partial<Record<keyof CompanyBody, string>>,
  ) {
    super(message, 400, 'validation_failed');
    this.name = 'CompanyFieldsError';
  }
}

export async function updateCompanyApi(body: Partial<CompanyBody>): Promise<CompanyBody & { id: string }> {
  let res: Response;
  try {
    res = await fetch('/api/employer/company', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Нет связи с сервером. Проверьте сеть и повторите.', 0, 'network');
  }
  if (res.ok) return (await res.json()) as CompanyBody & { id: string };
  const clone = res.clone();
  try {
    const j = (await clone.json()) as { error?: { code?: string; details?: { path: string; message: string }[] } };
    if (j.error?.code === 'validation_failed' && Array.isArray(j.error.details)) {
      const fields: Partial<Record<keyof CompanyBody, string>> = {};
      for (const d of j.error.details) if (d.path) fields[d.path as keyof CompanyBody] ??= d.message;
      throw new CompanyFieldsError('Проверь выделенные поля', fields);
    }
  } catch (e) {
    if (e instanceof CompanyFieldsError) throw e;
  }
  throw await readError(res);
}
