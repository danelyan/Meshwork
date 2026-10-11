// Тонкий клиент к API платформы. Контракты других лейнов могут быть заглушками,
// поэтому ответы разбираются терпимо, а ошибки приводятся к ApiError с понятным текстом.
import type { Specialization } from '@/lib/directions';
import type { ProfileView } from '@/server/claims/types';
import type { OnboardingView } from '@/server/onboarding/types';
import type { AnswerResult, DefenseQuestion, DefenseSessionView, DefenseVerdict } from '@/server/defense/types';
import type { Gap, TargetRec, TaskRec, TestRecommendation } from '@/server/recommend/types';
import type { Grade } from '@/lib/grades';

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

export async function readError(res: Response): Promise<ApiError> {
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
  // Кука подписана верно, но аккаунта уже нет (пересид/очистка в другом окне): сервер её стёр — на вход.
  if (code === 'session_stale' && typeof window !== 'undefined') {
    const here = window.location.pathname + window.location.search;
    window.location.assign(`/auth?next=${encodeURIComponent(here)}`);
  }
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
  specialization: Specialization | null;
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
/** Новый демо-гость; `consent` — версия текста согласия с галки (без неё сервер отвечает 409/400). */
export const demoFreshLogin = (consent: string) => postJson<{ user: { id: string; name: string }; next: string }>('/api/demo/login', { fresh: true, consent });
export const demoRestartOnboarding = (key: { restartUserId: string } | { restartCandidateId: string }) =>
  postJson<{ user: { id: string; name: string }; next: string }>('/api/demo/login', key);
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
  /** Закрыто шагов знакомства из скольки; null — завершено или не посчитать. Пропуск считается закрытым. */
  onboardingProgress?: { done: number; total: number } | null;
}
export const getMe = async () => (await request<{ user: MeView | null }>('/api/auth/me')).user;
export const getConsentVersion = async () => (await request<{ version: string }>('/api/auth/consent')).version;
export const acceptConsent = (version: string) => postJson<{ version: string; acceptedAt: string }>('/api/auth/consent', { version });
/** Переключить активную роль (ADR 0004); после ответа — полная навигация на `next`. */
export const switchRoleApi = (body: { role: 'candidate' } | { role: 'employer'; companyName?: string }) =>
  postJson<{ role: MeView['role']; next: string; created: boolean; changed: boolean }>('/api/auth/role/switch', body);
export const chooseRoleApi = (body: { role: 'candidate' } | { role: 'employer'; companyName: string }) =>
  postJson<{ role: MeView['role']; candidateId: string | null; employerProfileId: string | null }>('/api/auth/role', body);
export const completeOnboarding = () => postJson<{ onboarded: true; next: string }>('/api/auth/onboarding/complete', {});

// --- lane onboarding: онбординг-чат (app/api/onboarding/route.ts) ---
export type OnboardingAction =
  | { action: 'answer'; stepId: string; value: unknown }
  | { action: 'skip'; stepId: string }
  | { action: 'goto'; stepId: string };
export const getOnboarding = () => request<OnboardingView>('/api/onboarding');
export const onboardingAct = (body: OnboardingAction) => postJson<OnboardingView>('/api/onboarding', body);
/** «Настроить позже»: онбординг не завершается, ответ — куда вести. */
export const onboardingLater = () => postJson<{ next: string }>('/api/onboarding', { action: 'later' });

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
const ALLOWED_EXT = ['.pdf', '.docx', '.md', '.markdown', '.txt', '.csv'];

/** Проверка файла до отправки; текст ошибки показывается пользователю как есть. */
export function validateUploadFile(file: { name: string; size: number }): string | null {
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXT.some((e) => name.endsWith(e))) return `«${file.name}»: принимаем PDF, DOCX, MD, TXT и CSV.`;
  if (file.size === 0) return `«${file.name}»: файл пустой.`;
  if (file.size > MAX_UPLOAD_BYTES) return `«${file.name}»: больше 5 МБ. Сожмите файл или пришлите ссылкой.`;
  return null;
}

/** Ответ POST /api/uploads (collector): краткая сводка разбора; оригинал хранится, скачать — uploadFileHref. */
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

/** Ответ DELETE /api/uploads/:id и /api/sources/:id: сколько черновиков удалено и сколько утверждений осталось. */
export interface DeleteMaterialResponse {
  deletedClaims: number;
  keptClaims: number;
}
export const deleteMaterial = (kind: 'file' | 'link', id: string) =>
  request<DeleteMaterialResponse>(`/api/${kind === 'file' ? 'uploads' : 'sources'}/${encodeURIComponent(id)}`, { method: 'DELETE' });
/** Ссылка на скачивание оригинала (GET /api/uploads/:id/file). */
export const uploadFileHref = (id: string) => `/api/uploads/${encodeURIComponent(id)}/file`;

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
  /** Свободный вопрос посреди онбординга: id текущего шага (консультант ответит коротко и вернёт к шагу). */
  onboardingStep?: string;
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

// --- lane test: тест на грейд (docs/decisions/0002-grade-test.md) ---

export type { AttemptSummary, AttemptView, EligibilityView, StartResult } from '@/server/test/types';

export const startTestApi = (specialization: Specialization, grade: Grade, subcategoryId?: string | null) =>
  postJson<import('@/server/test/types').StartResult>('/api/test/start', { specialization, grade, subcategoryId: subcategoryId ?? undefined });
export const testEligibilityApi = (specialization: Specialization, grade: Grade, subcategoryId?: string | null) =>
  request<import('@/server/test/types').EligibilityView & { rules: string; retakeAfter?: string }>(
    `/api/test/start?specialization=${specialization}&grade=${grade}${subcategoryId ? `&subcategoryId=${encodeURIComponent(subcategoryId)}` : ''}`,
  );
export const getTestAttemptApi = (id: string) => request<import('@/server/test/types').AttemptView>(`/api/test/attempt/${encodeURIComponent(id)}`);
export const answerTestApi = (id: string, answer: string) =>
  postJson<import('@/server/test/types').AttemptView>(`/api/test/attempt/${encodeURIComponent(id)}/answer`, { answer });
export const finishTestApi = (id: string) => postJson<import('@/server/test/types').AttemptView>(`/api/test/attempt/${encodeURIComponent(id)}/finish`, {});
export const confirmJuniorApi = (id: string) => postJson<import('@/server/test/types').AttemptView>(`/api/test/attempt/${encodeURIComponent(id)}/confirm-junior`, {});
export const startConfirmTestApi = (id: string) =>
  postJson<{ attemptId: string; resumed: boolean }>(`/api/test/attempt/${encodeURIComponent(id)}/confirm-start`, {});
export const listTestAttemptsApi = async () => {
  const res = await request<{ attempts?: import('@/server/test/types').AttemptSummary[] }>('/api/test/attempts');
  return Array.isArray(res.attempts) ? res.attempts : [];
};
