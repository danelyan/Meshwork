// Клиент защиты проекта (ADR 0003, ступень 3): маршруты /api/defense-room/*, /api/employer/call/*, /api/call/{id}/signal.
import type { CallSnapshot, DefenseRoomVerdict, TranscriptEntry } from '@/server/defense-room/types';

import { postJson, request } from './api';

export type { CallSnapshot, DefenseRoomVerdict, TranscriptEntry };

export interface StartResponse {
  sessionId: string;
  resumed: boolean;
  webrtc: { iceServers: RTCIceServer[] };
  snapshot: CallSnapshot;
}

const enc = encodeURIComponent;

export const startDefenseRoomApi = (body: { mode: 'project'; projectSubmissionId: string } | { mode: 'questions' }) =>
  postJson<StartResponse>('/api/defense-room/start', body);
/** ИИ-защита проверенного сабмита до приглашения (ADR 0008 п. 1). */
export const startAiDefenseApi = (projectSubmissionId: string) => postJson<StartResponse>('/api/defense-room/ai', { projectSubmissionId });
export const defenseTurnApi = (id: string, text: string) =>
  postJson<{ text: string | null; muted: boolean; done: boolean }>(`/api/defense-room/${enc(id)}/turn`, { text });
export const defenseFinishApi = (id: string) => postJson<{ verdict: DefenseRoomVerdict }>(`/api/defense-room/${enc(id)}/finish`, {});

/** Вход в живую защиту: `recordingConsent` – работодатель подтвердил, что разговор записывается, включая его голос (ADR 0008 п. 3). */
export const joinCallApi = (id: string, recordingConsent: boolean) =>
  postJson<{ participantId: string; webrtc: { iceServers: RTCIceServer[] }; snapshot: CallSnapshot }>(`/api/employer/call/${enc(id)}/join`, { recordingConsent });
/** Сегменты голоса работодателя в живой защите; файл – `/api/call/{id}/employer-audio/file?segment=`. */
export const employerAudioListApi = (id: string) => request<{ segments: { name: string; startMs: number }[] }>(`/api/call/${enc(id)}/employer-audio`);
export const employerAudioFileUrl = (id: string, segment: string) => `/api/call/${enc(id)}/employer-audio/file?segment=${encodeURIComponent(segment)}`;
export const leaveCallApi = (id: string) => postJson<{ left: boolean }>(`/api/employer/call/${enc(id)}/leave`, {});
export const muteAiApi = (id: string, muted: boolean) => postJson<{ muted: boolean; aiText: string | null }>(`/api/employer/call/${enc(id)}/mute-ai`, { muted });
export const sayApi = (id: string, text: string) => postJson<{ entry: TranscriptEntry }>(`/api/employer/call/${enc(id)}/say`, { text });
export const askQuestionApi = (candidateId: string, text: string) => postJson<{ id: string }>('/api/employer/questions', { candidateId, text });

export const signalApi = (id: string, body: { to?: string; sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit | null }) =>
  postJson<{ delivered: true }>(`/api/call/${enc(id)}/signal`, body);
