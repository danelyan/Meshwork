// Клиент кабинета работодателя и входящих приглашений кандидата (lane employer).
import { postJson, request } from './api';

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
  salaryOffer: number;
}
export const inviteApi = (body: InviteBody) => postJson<{ id: string; status: string }>('/api/employer/invitations', body);

export const respondInvitationApi = (id: string, action: 'accept' | 'decline') =>
  postJson<{ id: string; status: string }>(`/api/invitations/${encodeURIComponent(id)}`, { action });
export const setPrivacyApi = (hiddenFromEmployers: boolean) =>
  postJson<{ hiddenFromEmployers: boolean }>('/api/profile/privacy', { hiddenFromEmployers });
