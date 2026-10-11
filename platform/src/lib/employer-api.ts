// Клиент кабинета работодателя и входящих приглашений кандидата (lane employer).
import type { Specialization } from '@/lib/directions';
import { ApiError, postJson, readError, request } from './api';
import type { Grade } from '@/lib/grades';
import type { LiveDefenseView } from '@/server/live-defense/service';

export interface VacancyBody {
  title: string;
  specialization: Specialization;
  grade: Grade;
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

/** Вопросы компании кандидату (ADR 0003, ступень 3): очередь, ответ кандидата приходит в защите. */
export interface EmployerQuestionDto {
  id: string;
  text: string;
  status: 'queued' | 'asked' | 'answered';
  askedAt: string;
  answer: string | null;
}
export const listQuestionsApi = async (candidateId: string) =>
  (await request<{ questions: EmployerQuestionDto[] }>(`/api/employer/questions?candidateId=${encodeURIComponent(candidateId)}`)).questions;
export const askQuestionApi = (candidateId: string, text: string) => postJson<EmployerQuestionDto>('/api/employer/questions', { candidateId, text });

/** accept — с версией согласия на раскрытие имени и контактов этому работодателю (Г5, ADR 0005). */
/** lane hired: работодатель отмечает найм по принятому приглашению (accepted → hired). */
export const markHiredApi = (id: string) =>
  postJson<{ id: string; status: 'hired'; hiredAt: string }>(`/api/employer/invitations/${encodeURIComponent(id)}/hire`, {});
/** lane invite-cancel: работодатель отзывает приглашение с причиной (sent | viewed | accepted → withdrawn). */
export const withdrawInvitationApi = (id: string, reason: string) =>
  postJson<{ id: string; status: 'withdrawn'; withdrawn: { at: string; reason: string } }>(`/api/employer/invitations/${encodeURIComponent(id)}/withdraw`, { reason });
export type ComplaintReasonValue = 'spam' | 'salary_mismatch' | 'offensive' | 'fake_company' | 'other';
export const complainInvitationApi = (id: string, reason: ComplaintReasonValue, comment: string) =>
  postJson<{ id: string; reason: string; createdAt: string }>(`/api/invitations/${encodeURIComponent(id)}/complaint`, { reason, comment });
export const respondInvitationApi = (id: string, action: 'accept' | 'decline', disclosureVersion?: string) =>
  postJson<{ id: string; status: string }>(`/api/invitations/${encodeURIComponent(id)}`, { action, ...(disclosureVersion ? { disclosureVersion } : {}) });
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
  /** Способ связи в приглашениях от этого представителя: контакт компании, иначе его почта; null — приглашения не отправятся (E05). */
  inviteContact?: string | null;
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

// lane live-slots (ADR 0008): слоты живой защиты.
export const proposeLiveSlotsApi = (invitationId: string, body: { slots: string[]; durationMin: 30 | 45; comment?: string }) =>
  postJson<LiveDefenseView>(`/api/employer/invitations/${encodeURIComponent(invitationId)}/live-defense`, body);
export const cancelLiveDefenseEmployerApi = (invitationId: string, reason: string) =>
  postJson<LiveDefenseView>(`/api/employer/invitations/${encodeURIComponent(invitationId)}/live-defense/cancel`, { reason });
export const chooseLiveSlotApi = (invitationId: string, slotId: string, recordingConsentVersion?: string) =>
  postJson<LiveDefenseView>(`/api/invitations/${encodeURIComponent(invitationId)}/live-defense/choose`, { slotId, ...(recordingConsentVersion ? { recordingConsentVersion } : {}) });
export const noneFitLiveSlotsApi = (invitationId: string, comment: string) =>
  postJson<LiveDefenseView>(`/api/invitations/${encodeURIComponent(invitationId)}/live-defense/none-fit`, { comment });
export const cancelLiveDefenseCandidateApi = (invitationId: string, reason: string) =>
  postJson<LiveDefenseView>(`/api/invitations/${encodeURIComponent(invitationId)}/live-defense/cancel`, { reason });
