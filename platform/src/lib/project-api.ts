// Клиентские вызовы ступени 2 «проект под работодателя» (ADR 0003): лента, сдача, задание потребности.
import type { CandidateSubmissionView, EmployerSubmissionView, EmployerTaskView, TemplateView } from '@/server/project/service';

import { postJson, request } from './api';

export const takeProjectApi = (taskId: string) =>
  postJson<{ taskId: string; expiresAt: string; active: number; maxActive: number }>(`/api/project-tasks/${encodeURIComponent(taskId)}/take`, {});

export const submitProjectApi = (taskId: string, body: { repoUrl: string; aiLogText: string; commitSha?: string }) =>
  postJson<CandidateSubmissionView>(`/api/project-tasks/${encodeURIComponent(taskId)}/submissions`, body);

export const getSubmissionApi = (id: string) => request<CandidateSubmissionView>(`/api/project-submissions/${encodeURIComponent(id)}`);

export const getNeedProjectApi = (needId: string) => request<{ task: EmployerTaskView | null }>(`/api/employer/needs/${encodeURIComponent(needId)}/project`);

export interface NeedProjectBody {
  templateId?: string;
  requiredCatalogIds: string[];
  wishesText?: string | null;
  visibility: 'open' | 'invited';
}

export const saveNeedProjectApi = (needId: string, body: NeedProjectBody) => postJson<EmployerTaskView>(`/api/employer/needs/${encodeURIComponent(needId)}/project`, body);

export const listTemplatesApi = (specialization?: string) =>
  request<{ templates: TemplateView[] }>(`/api/employer/project-templates${specialization ? `?specialization=${encodeURIComponent(specialization)}` : ''}`);

export const listProjectSubmissionsApi = (needId: string) =>
  request<{ task: EmployerTaskView | null; items: EmployerSubmissionView[] }>(`/api/employer/project-submissions?needId=${encodeURIComponent(needId)}`);

export const inviteToDefenseApi = (submissionId: string, body: { message: string; salaryFrom: number; salaryTo: number }) =>
  postJson<{ invitationId: string; callSessionId: string | null }>(`/api/employer/project-submissions/${encodeURIComponent(submissionId)}/invite-to-defense`, body);
