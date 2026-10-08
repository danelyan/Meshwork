// Тонкий клиент к API платформы. Контракты других лейнов могут быть заглушками,
// поэтому ответы разбираются терпимо, а ошибки приводятся к ApiError с понятным текстом.
import type { ProfileView } from '@/server/claims/types';
import type { DefenseVerdict } from '@/server/defense/types';
import type { Gap, TaskRec } from '@/server/recommend/types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function readError(res: Response): Promise<ApiError> {
  let message = `Ошибка ${res.status}`;
  let code: string | undefined;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } | string; message?: string };
    if (typeof body.error === 'string') message = body.error;
    else if (body.error?.message) {
      message = body.error.message;
      code = body.error.code;
    } else if (body.message) message = body.message;
  } catch {
    /* тело не JSON */
  }
  if (res.status === 401) message = 'Сессия закончилась. Войдите заново.';
  return new ApiError(message, res.status, code);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError('Нет связи с сервером. Проверьте сеть и повторите.', 0, 'network');
  }
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

export interface DemoCandidate {
  id: string;
  name: string;
  specialization: 'backend' | 'frontend' | null;
  fspState: string;
}

export const getDemoCandidates = async () => (await request<{ candidates: DemoCandidate[] }>('/api/demo/login')).candidates;
export const demoLogin = (candidateId: string) => postJson<{ candidate: { id: string; name: string } }>('/api/demo/login', { candidateId });
export const demoLogout = () => request<{ ok: true }>('/api/demo/login', { method: 'DELETE' });

export const getProfile = () => request<ProfileView>('/api/profile');

export interface RecommendationsView {
  gaps?: Gap[];
  tasks?: TaskRec[];
}
export const getRecommendations = () => request<RecommendationsView>('/api/recommendations');

export type ClaimAction = 'confirm' | 'edit' | 'reject';
export const claimAction = (claimId: string, action: ClaimAction, statement?: string) =>
  postJson<unknown>(`/api/claims/${encodeURIComponent(claimId)}/${action}`, statement === undefined ? {} : { statement });

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXT = ['.pdf', '.docx'];

/** Проверка файла до отправки; текст ошибки показывается пользователю как есть. */
export function validateUploadFile(file: { name: string; size: number }): string | null {
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXT.some((e) => name.endsWith(e))) return `«${file.name}»: принимаем только PDF и DOCX.`;
  if (file.size === 0) return `«${file.name}»: файл пустой.`;
  if (file.size > MAX_UPLOAD_BYTES) return `«${file.name}»: больше 5 МБ. Сожмите файл или пришлите ссылкой.`;
  return null;
}

export async function uploadFile(file: File): Promise<{ id: string; filename: string }> {
  const form = new FormData();
  form.append('file', file);
  const data = await request<{ upload?: { id: string; filename?: string }; id?: string; filename?: string }>('/api/uploads', {
    method: 'POST',
    body: form,
  });
  const id = data.upload?.id ?? data.id;
  if (!id) throw new ApiError('Сервер не вернул идентификатор файла.', 500);
  return { id, filename: data.upload?.filename ?? data.filename ?? file.name };
}

/** Разбор поля ссылок: пробелы, запятые, переводы строк. Возвращает валидные http(s) и отброшенные. */
export function parseUrls(input: string): { urls: string[]; invalid: string[] } {
  const urls: string[] = [];
  const invalid: string[] = [];
  for (const token of input.split(/[\s,;]+/).filter(Boolean)) {
    try {
      const u = new URL(/^[a-z]+:\/\//i.test(token) ? token : `https://${token}`);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.')) {
        if (!urls.includes(u.toString())) urls.push(u.toString());
        continue;
      }
    } catch {
      /* не ссылка */
    }
    invalid.push(token);
  }
  return { urls, invalid };
}

export interface SendMessageInput {
  text: string;
  uploadIds?: string[];
  urls?: string[];
  conversationId?: string;
}

/** Открывает SSE-поток ответа консультанта. Тело читает вызывающий (см. useConsultant). */
export async function openConsultantStream(input: SendMessageInput, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  let res: Response;
  try {
    res = await fetch('/api/consultant/messages', {
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

// --- защита утверждения (лейн defense, волна 3): предполагаемая форма API ---
export interface DefenseStep {
  sessionId: string;
  question?: { index: number; question: string };
  total?: number;
  verdict?: DefenseVerdict;
  /** уровень утверждения после защиты, если сервер вернул */
  level?: string;
}
export const startDefenseApi = (claimId: string) => postJson<DefenseStep>('/api/defense', { claimId });
export const answerDefenseApi = (sessionId: string, answer: string) =>
  postJson<DefenseStep>(`/api/defense/${encodeURIComponent(sessionId)}/answer`, { answer });
