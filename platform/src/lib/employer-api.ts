// Клиент кабинета работодателя и входящих приглашений кандидата (lane employer).
import type { Specialization } from '@/lib/directions';
import { ApiError, postJson, readError, request } from './api';

export interface VacancyBody {
  title: string;
  specialization: Specialization;
  grade: 'junior' | 'middle';
  salaryFrom: number;
  salaryTo: number;
  teamDescription: string | null;
  description: string | null;
  stack: string[];
  /** lane directions: подкатегория из справочника (обязательна, подборка ищет по ней). */
  subcategoryId: string;
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
