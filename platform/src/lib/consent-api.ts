// Клиент API согласий и возражений (ADR 0005).
import type { ObjectionView } from '@/server/consent/objections';
import type { ConsentItemView } from '@/server/consent/service';
import type { ConsentKindName } from '@/server/consent/texts';

import { postJson, request } from './api';

export const listConsentsApi = () => request<{ items: ConsentItemView[] }>('/api/consents');
export const grantConsentApi = (kind: ConsentKindName, version: string, context?: { invitationId: string }) =>
  postJson<{ kind: ConsentKindName; version: string; acceptedAt: string }>('/api/consents', { kind, version, ...(context ? { context } : {}) });
export const revokeConsentApi = (kind: ConsentKindName, invitationId?: string) =>
  request<{ kind: ConsentKindName; revokedAt: string; deletedRecordings?: number }>(
    `/api/consents/${kind}${invitationId ? `?invitationId=${encodeURIComponent(invitationId)}` : ''}`,
    { method: 'DELETE' },
  );
export const listObjectionsApi = () => request<{ objections: ObjectionView[] }>('/api/objections');
export const createObjectionApi = (body: { subject: ObjectionView['subject']; subjectId: string; text: string }) =>
  postJson<ObjectionView>('/api/objections', body);
