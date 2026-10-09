// Тонкий клиент к API платформы. Контракты других лейнов могут быть заглушками,
// поэтому ответы разбираются терпимо, а ошибки приводятся к ApiError с понятным текстом.
import type { ProfileView } from '@/server/claims/types';
import type { AnswerResult, DefenseQuestion, DefenseSessionView, DefenseVerdict } from '@/server/defense/types';
import type { Gap, TargetRec, TaskRec, TestRecommendation } from '@/server/recommend/types';

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

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError('Нет связи с сервером. Проверьте сеть и повторите.', 0, 'network');
  }
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

export function postJson<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

export interface DemoCandidate {
  id: string;
  name: string;
  specialization: 'backend' | 'frontend' | null;
  fspState: string;
  /** Какой файл загрузить и какую ссылку вставить; null — подсказки нет. */
  demoResume?: { fileName: string; link: string } | null;
}

export const getDemoCandidates = async () => (await request<{ candidates: DemoCandidate[] }>('/api/demo/login')).candidates;
export const demoLogin = (candidateId: string) => postJson<{ candidate: { id: string; name: string }; next?: string }>('/api/demo/login', { candidateId });
export const demoLogout = () => request<{ ok: true }>('/api/demo/login', { method: 'DELETE' });

// --- lane auth: вход, роль, согласие (docs/decisions/0001-auth-yandex-id.md) ---

export interface DemoEmployer {
  id: string;
  name: string;
  company: { id: string; name: string } | null;
}

export const getDemoAccounts = () => request<{ candidates: DemoCandidate[]; employers?: DemoEmployer[] }>('/api/demo/login');
export const demoEmployerLogin = (employerUserId: string) =>
  postJson<{ employer: { id: string; name: string }; next: string }>('/api/demo/login', { employerUserId });
export const logout = () => postJson<{ ok: true }>('/api/auth/logout', {});

export interface MeView {
  id: string;
  role: 'pending' | 'candidate' | 'employer';
  name: string;
  email: string | null;
  isDemo: boolean;
  candidateId: string | null;
  employerProfileId: string | null;
  onboarded: boolean;
  /** Есть согласие на текущую версию текста. */
  consent: boolean;
}
export const getMe = async () => (await request<{ user: MeView | null }>('/api/auth/me')).user;
export const getConsentVersion = async () => (await request<{ version: string }>('/api/auth/consent')).version;
export const acceptConsent = (version: string) => postJson<{ version: string; acceptedAt: string }>('/api/auth/consent', { version });
export const chooseRoleApi = (body: { role: 'candidate' } | { role: 'employer'; companyName: string }) =>
  postJson<{ role: MeView['role']; candidateId: string | null; employerProfileId: string | null }>('/api/auth/role', body);
export const completeOnboarding = () => postJson<{ onboarded: true; next: string }>('/api/auth/onboarding/complete', {});

export const getProfile = () => request<ProfileView>('/api/profile');

/** GET /api/recommendations — target: `vacancy:<id>` | `category:<spec>:<grade>`; без него сервер берёт цель сам. */
export interface RecommendationsView {
  /** Цель, к которой посчитаны пробелы (переданная или выбранная сервером). */
  target?: string;
  test?: TestRecommendation;
  gaps?: Gap[];
  tasks?: TaskRec[];
  targets?: TargetRec[];
}
export const getRecommendations = (target?: string) =>
  request<RecommendationsView>(`/api/recommendations${target ? `?target=${encodeURIComponent(target)}` : ''}`);

export type ClaimAction = 'confirm' | 'edit' | 'reject';
export const claimAction = (claimId: string, action: ClaimAction, statement?: string) =>
  postJson<unknown>(`/api/claims/${encodeURIComponent(claimId)}/${action}`, statement === undefined ? {} : { statement });

export interface ConfirmBatchResponse {
  confirmed: string[];
  skipped: { id: string; reason: string }[];
}
export const confirmClaimsBatchApi = (ids: string[]) => postJson<ConfirmBatchResponse>('/api/claims/confirm-batch', { ids });

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

/** Ответ POST /api/uploads (collector): краткая сводка разбора, сам файл не хранится. */
export interface UploadResponse {
  uploadId: string;
  deduplicated: boolean;
  doc: { title: string; sourceKind: string; lines: number; pages: number | null; flags: Record<string, unknown>; preview: string };
}

export async function uploadFile(file: File): Promise<{ id: string; filename: string; deduplicated: boolean }> {
  const form = new FormData();
  form.append('file', file);
  const data = await request<UploadResponse>('/api/uploads', { method: 'POST', body: form });
  if (!data.uploadId) throw new ApiError('Сервер не вернул идентификатор файла.', 500);
  return { id: data.uploadId, filename: data.doc?.title || file.name, deduplicated: data.deduplicated };
}

/** Демо-резюме текущего демо-кандидата как File (GET /api/demo/resume) — для кнопки «Загрузить демо-резюме». */
export async function fetchDemoResume(fileName: string): Promise<File> {
  let res: Response;
  try {
    res = await fetch('/api/demo/resume', { credentials: 'same-origin' });
  } catch {
    throw new ApiError('Нет связи с сервером. Проверьте сеть и повторите.', 0, 'network');
  }
  if (!res.ok) throw await readError(res);
  return new File([await res.blob()], fileName, { type: 'application/pdf' });
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

// --- защита утверждения (лейн defense) ---
/** Шаг защиты для UI: текущий вопрос или вердикт. */
export interface DefenseStep {
  sessionId: string;
  question?: DefenseQuestion;
  total?: number;
  verdict?: DefenseVerdict;
}

/** POST /api/defense {claimId} → {sessionId, question, resumed}; активная сессия продолжается. */
export const startDefenseApi = (claimId: string) =>
  postJson<{ sessionId: string; question: DefenseQuestion; resumed: boolean }>('/api/defense', { claimId });

/** GET /api/defense/[sessionId] — вся сессия (для продолжения после перезагрузки). */
export const getDefenseSessionApi = (sessionId: string) =>
  request<DefenseSessionView>(`/api/defense/${encodeURIComponent(sessionId)}`);

/** POST /api/defense/[sessionId] {answer} → {next?, verdict?}. */
export async function answerDefenseApi(sessionId: string, answer: string): Promise<DefenseStep> {
  const r = await postJson<AnswerResult>(`/api/defense/${encodeURIComponent(sessionId)}`, { answer });
  return { sessionId, ...(r.next ? { question: r.next } : {}), ...(r.verdict ? { verdict: r.verdict } : {}) };
}
