// Клиент самоотклика (R-C-12): кандидат откликается, работодатель отвечает.
import type { ApplicationStatus } from '@prisma/client';
import type { CandidateApplicationView, EmployerApplicationView } from '@/server/employer/applications';

import { postJson, request } from './api';

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  sent: 'отправлен',
  viewed: 'просмотрен',
  accepted: 'принят',
  declined: 'отклонён',
  closed: 'закрыт',
};

export const applyApi = (vacancyId: string, message: string, disclosureVersion: string) =>
  postJson<{ id: string; status: ApplicationStatus }>(`/api/career/vacancies/${encodeURIComponent(vacancyId)}/apply`, { message: message.trim() || null, disclosureVersion });
export const myApplicationsApi = () => request<{ applications: CandidateApplicationView[] }>('/api/career/applications');
export const vacancyApplicationsApi = (vacancyId: string) =>
  request<{ applications: EmployerApplicationView[] }>(`/api/employer/vacancies/${encodeURIComponent(vacancyId)}/applications?view=1`);
export const answerApplicationApi = (id: string, action: 'accept' | 'decline') =>
  request<{ id: string; status: ApplicationStatus; invitationId?: string | null }>(`/api/employer/applications/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
export const revokeApplicationDisclosureApi = (id: string) =>
  request<{ revokedAt: string }>(`/api/consents/identity_disclosure?applicationId=${encodeURIComponent(id)}`, { method: 'DELETE' });
