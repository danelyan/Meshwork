import 'server-only';

import type { SessionPrincipal, SessionRole } from '@/server/session';

/**
 * Матрица доступа (E-05, фаза 1): одна таблица для страниц, API и server actions.
 * Ключ — шаблон маршрута, как в `src/app` без групп в скобках (`/defense/[claimId]`).
 * Deny by default: путь без записи закрыт, а тесты `tests/unit/auth/access-*.test.ts`
 * падают, если у `page.tsx`, `route.ts` или `'use server'` нет записи или гварда нужного уровня.
 *
 * Решает **активная роль** (`session.role`), наличие профиля роли в куке — второе условие:
 * с переключением ролей в учётке будут оба профиля, и пускать по одному наличию id нельзя.
 */

/** Уровни страниц: public — без входа; account — любой вход (в т.ч. pending и старая демо-кука). */
export type PageLevel = 'public' | 'account' | 'candidate' | 'employer';

/**
 * Уровни API и гвард, который обязан вызвать обработчик:
 * candidate → `requireCandidate`, employer → `requireEmployer`, account → `requireUser` (аккаунт любой роли),
 * session → `getSession` + 401 (любой вход, включая старую демо-куку), dev → `devRoute` (только dev-хост),
 * public → без входа.
 */
export type ApiLevel = 'public' | 'session' | 'account' | 'candidate' | 'employer' | 'dev';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** Уровень для всех методов файла или по методам (метода нет в записи — закрыт). */
export type ApiRule = ApiLevel | Partial<Record<HttpMethod, ApiLevel>>;

export const PAGE_ACCESS = {
  '/': 'public',
  '/auth': 'public',
  '/consent': 'public',
  '/privacy': 'public',
  '/terms': 'public',
  '/employer-terms': 'public',
  '/ai': 'public',
  '/site-access': 'public',
  '/api-docs': 'public',
  // Валидация (критерии 1–2): цифры и прогон подбора на своём наборе — жюри без регистрации.
  '/validation': 'public',
  '/evaluate': 'public',
  // Лаборатория вариантов заданий: генерация из реестра по seed, без данных пользователей.
  '/mechanics': 'public',
  // Симулятор адаптивного теста для жюри: виртуальный кандидат, без БД.
  '/simulator': 'public',
  // «Как устроена проверка» для жюри: схема теста, информация банка, симуляция, формула подбора; без БД.
  '/method': 'public',
  // Флаг DEMO_LOGIN проверяет сама страница (выключен → 404).
  '/demo': 'public',
  // Режим эксперта: тест на грейд без регистрации, грейд не присваивается. Флаг DEMO_LOGIN — в странице (выключен → 404).
  '/expert': 'public',
  // Прежние адреса: только редирект на /consultant, данных нет.
  '/onboarding': 'public',
  '/employer/assistant': 'public',
  // Дом обеих ролей: знакомство (pending), консультант кандидата, помощник работодателя.
  '/consultant': 'account',
  '/profile': 'candidate',
  '/career': 'candidate',
  '/companies': 'candidate',
  '/companies/[id]': 'candidate',
  '/saved': 'candidate',
  '/settings': 'candidate',
  '/skills': 'candidate',
  '/test': 'candidate',
  '/interview': 'candidate',
  '/interview/room': 'candidate',
  '/invitations': 'candidate',
  '/defense/[claimId]': 'candidate',
  // Созвон-защита (ADR 0003): комната кандидата и наблюдение работодателя.
  '/defense-room': 'candidate',
  '/defense-room/[sessionId]': 'candidate',
  // Лента проектных заданий и задание (ADR 0003, ступень 2).
  '/projects': 'candidate',
  '/projects/[taskId]': 'candidate',
  '/employer': 'employer',
  '/employer/vacancies': 'employer',
  // Профиль компании (R-E-01) — страницу делает лейн company; сюда ведём работодателя с чужих страниц.
  '/employer/company': 'employer',
  '/employer/search': 'employer',
  '/employer/saved': 'employer',
  '/employer/invitations': 'employer',
  '/employer/needs/new': 'employer',
  '/employer/needs/[id]': 'employer',
  '/employer/needs/[id]/edit': 'employer',
  '/employer/calls': 'employer',
  '/employer/calls/[id]': 'employer',
  // Витрины дизайна. Варианты экрана консультанта показывают живую ленту кандидата — как /consultant у кандидата.
  '/design/avatar': 'public',
  '/design/fonts': 'public',
  '/design/head-motion-preview': 'public',
  '/design/consultant-grid-preview': 'public',
  '/design/consultant-grid-v1': 'public',
  '/design/consultant-grid-v2': 'public',
  '/design/consultant-grid-v3': 'public',
  '/design/consultant-a': 'candidate',
  '/design/consultant-b': 'candidate',
  '/design/consultant-c': 'candidate',
  '/design/consultant-d': 'candidate',
} as const satisfies Record<string, PageLevel>;

export const API_ACCESS = {
  '/api/auth/account': 'account',
  '/api/favorites': 'account',
  '/api/notifications': 'account',
  '/api/career/vacancies': 'candidate',
  '/api/career/vacancies/[id]/apply': 'candidate',
  '/api/career/applications': 'candidate',
  // Вход, регистрация, пароль, Яндекс ID — до входа.
  '/api/auth/login': 'public',
  '/api/auth/logout': 'public',
  '/api/auth/register': 'public',
  '/api/auth/verify': 'public',
  '/api/auth/verify/resend': 'public',
  '/api/auth/password/forgot': 'public',
  '/api/auth/password/reset': 'public',
  '/api/auth/yandex': 'public',
  '/api/auth/yandex/callback': 'public',
  // ФСП ID (R-FSP-01): привязка к профилю через внешний OIDC-провайдер (старт и возврат) — только кандидату.
  '/api/fsp-id/link': 'candidate',
  // Возврат обслуживает и привязку (requireCandidate внутри), и вход на платформу через ФСП ID (без сессии).
  '/api/fsp-id/callback': 'public',
  '/api/fsp-id/login': 'public',
  // Мок провайдера ФСП ID (страница входа «чужого» сервиса; без внешнего провайдера в env) — без входа на платформу.
  '/api/fsp-id/realms/fsp/protocol/openid-connect/auth': 'public',
  '/api/auth/stale': 'public',
  // `{ user: null }` для гостя — отвечает всем.
  '/api/auth/me': 'public',
  '/api/auth/consent': { GET: 'public', POST: 'account' },
  '/api/auth/role': 'account',
  // Мои согласия (ADR 0005): у кандидата и работодателя.
  '/api/consents': 'account',
  '/api/consents/[kind]': 'account',
  // Возражение против оценки (ст. 16 152-ФЗ) — только кандидат, работодатель их не видит.
  '/api/objections': 'candidate',
  // Переключение активной роли и вторая роль на той же учётке (ADR 0004).
  '/api/auth/role/switch': 'account',
  '/api/auth/onboarding/complete': 'account',
  '/api/onboarding': 'account',
  // Флаг DEMO_LOGIN проверяет обработчик (выключен → 404).
  '/api/demo/login': 'public',
  '/api/demo/resume': 'candidate',
  // Режим эксперта (server/expert): вход — своя кука fsp_expert (requireExpert в обработчике), не сессия cid;
  // флаг DEMO_LOGIN, лимиты создания — там же.
  '/api/expert/start': 'public',
  '/api/expert/attempt/[id]': 'public',
  '/api/expert/attempt/[id]/answer': 'public',
  '/api/expert/attempt/[id]/finish': 'public',
  '/api/expert/attempt/[id]/signal': 'public',
  '/api/profile': 'candidate',
  '/api/profile/details': 'candidate',
  '/api/profile/resume-fields': 'candidate',
  '/api/profile/contact': 'candidate',
  '/api/profile/privacy': 'candidate',
  '/api/claims/[id]/[action]': 'candidate',
  '/api/claims/confirm-batch': 'candidate',
  '/api/test/start': 'candidate',
  '/api/test/attempts': 'candidate',
  '/api/test/attempt/[id]': 'candidate',
  '/api/test/attempt/[id]/answer': 'candidate',
  '/api/test/attempt/[id]/confirm-junior': 'candidate',
  '/api/test/attempt/[id]/confirm-start': 'candidate',
  '/api/test/attempt/[id]/finish': 'candidate',
  '/api/test/attempt/[id]/signal': 'candidate',
  '/api/defense': 'candidate',
  '/api/defense/[sessionId]': 'candidate',
  '/api/uploads': 'candidate',
  '/api/uploads/[id]': 'candidate',
  '/api/uploads/[id]/file': 'candidate',
  '/api/sources/[id]': 'candidate',
  '/api/invitations': 'candidate',
  '/api/invitations/[id]': 'candidate',
  '/api/invitations/[id]/complaint': 'candidate',
  '/api/invitations/[id]/live-defense/choose': 'candidate',
  '/api/invitations/[id]/live-defense/none-fit': 'candidate',
  '/api/invitations/[id]/live-defense/cancel': 'candidate',
  '/api/recommendations': 'candidate',
  '/api/consultant/messages': 'candidate',
  '/api/consultant/messages/stop': 'candidate',
  '/api/consultant/conversations': 'candidate',
  '/api/consultant/conversations/[id]': 'candidate',
  '/api/consultant/settings': 'candidate',
  // Память консультанта у каждой роли своя (memoryOwnerOf): кандидат и работодатель.
  '/api/consultant/memory': 'session',
  '/api/consultant/memory/[id]': 'session',
  '/api/employer/assistant/messages': 'employer',
  '/api/employer/company': 'employer',
  /** lane admin (E-08, фаза 2): запрос ручной верификации компании. */
  '/api/employer/company/verification': 'employer',
  /** lane admin (E-08, фаза 2): апелляция на санкцию за жалобы. */
  '/api/employer/sanction-appeal': 'employer',
  '/api/employer/invitations': 'employer',
  '/api/employer/invitations/[id]/hire': 'employer',
  '/api/employer/invitations/[id]/live-defense': 'employer',
  '/api/employer/invitations/[id]/live-defense/cancel': 'employer',
  '/api/employer/invitations/[id]/withdraw': 'employer',
  '/api/employer/search': 'employer',
  '/api/employer/vacancies': 'employer',
  '/api/employer/vacancies/[id]': 'employer',
  '/api/employer/vacancies/[id]/matches': 'employer',
  '/api/employer/vacancies/[id]/applications': 'employer',
  '/api/employer/applications/[id]': 'employer',
  // Звонок с аватаром (ADR 0003): ведёт кандидат; запись и события видят обе стороны по правилам server/call/access.ts.
  '/api/call': 'candidate',
  '/api/call/start': 'candidate',
  '/api/call/consent': 'candidate',
  '/api/call/[id]': 'session',
  '/api/call/[id]/events': 'session',
  '/api/call/[id]/recording': 'session',
  '/api/call/[id]/video': 'session',
  '/api/call/[id]/employer-audio': 'session',
  '/api/call/[id]/employer-audio/file': 'session',
  '/api/call/[id]/signal': 'session',
  '/api/call/[id]/turn': 'candidate',
  '/api/call/[id]/interrupt': 'candidate',
  '/api/call/[id]/audio': 'candidate',
  '/api/call/[id]/finish': 'candidate',
  // Справочник направлений и подкатегорий (ADR 0003): общий, без персональных данных.
  '/api/directions': 'public',
  // Проектная ступень (ADR 0003, лента заданий): кандидат — лента, задание, сдача; работодатель — задание потребности и сабмиты.
  '/api/project-tasks/feed': 'candidate',
  '/api/project-tasks/[id]': 'candidate',
  '/api/project-tasks/[id]/take': 'candidate',
  '/api/project-tasks/[id]/submissions': 'candidate',
  '/api/project-tasks/[id]/skeleton.zip': 'candidate',
  '/api/project-submissions/[id]': 'candidate',
  '/api/employer/needs/[id]/project': 'employer',
  '/api/employer/project-templates': 'employer',
  '/api/employer/project-submissions': 'employer',
  '/api/employer/project-submissions/[id]/ai-defense': 'employer',
  '/api/employer/project-submissions/[id]/invite-to-defense': 'employer',
  '/api/defense-room/start': 'candidate',
  '/api/defense-room/ai': 'candidate',
  '/api/defense-room/pending': 'candidate',
  '/api/defense-room/[id]': 'session',
  '/api/defense-room/[id]/events': 'session',
  '/api/defense-room/[id]/turn': 'candidate',
  '/api/defense-room/[id]/finish': 'candidate',
  '/api/consultant/aside': 'account',
  '/api/employer/calls': 'employer',
  '/api/employer/questions': 'employer',
  '/api/employer/call/[id]/join': 'employer',
  '/api/employer/call/[id]/leave': 'employer',
  '/api/employer/call/[id]/mute-ai': 'employer',
  '/api/employer/call/[id]/say': 'employer',
  '/api/employer/call/[id]/audio': 'employer',
  // GET — режим распознавания/озвучки для композера; POST — только с входом (тратит квоту SpeechKit).
  '/api/stt': { GET: 'public', POST: 'session' },
  '/api/tts': { GET: 'public', POST: 'session' },
  '/api/health': 'public',
  '/api/openapi': 'public',
  // Прогон ранжирования на наборе пользователя: в памяти, лимиты входа и частоты (route.ts).
  '/api/evaluate': { POST: 'public' },
  '/api/simulator': { POST: 'public' },
  '/api/dev/delete-account': 'dev',
  // Ответ оператора на возражения против оценки (ст. 16, ADR 0005).
  '/api/dev/objections': 'dev',
  '/api/dev/login-as': 'dev',
  '/api/dev/logout': 'dev',
  '/api/dev/new-conversation': 'dev',
  '/api/dev/new-user': 'dev',
  '/api/dev/reset-onboarding': 'dev',
  '/api/dev/reset-test-attempts': 'dev',
} as const satisfies Record<string, ApiRule>;

/**
 * Server actions — POST-точки мимо страницы, проверка роли обязана быть внутри action (Next.js: Data Security).
 * Ключ — файл с `'use server'` от `src/`; уровень — как у страниц.
 */
export const ACTION_ACCESS = {
  // Пароль стенда (SITE_PASSWORD) — до входа.
  'app/site-access/actions.ts': 'public',
} as const satisfies Record<string, PageLevel>;

/**
 * Админка (E-08, docs/decisions/0009-admin-staff.md) — отдельный контур доступа: кука персонала `fsp_admin`,
 * не роль сессии `cid`. Таблицы выше её не описывают: всё под префиксами закрыто гвардом персонала
 * (`requirePageStaff` в каждой page.tsx, `requireStaff(req…)` в каждом обработчике — проверяет
 * `tests/unit/auth/access-coverage.test.ts`), открыты только шаги входа. Лейны админки таблицы не правят.
 */
export const ADMIN_PAGE_PREFIX = '/admin';
export const ADMIN_API_PREFIX = '/api/admin';
export const ADMIN_PUBLIC_ROUTES: readonly string[] = ['/admin/login', '/api/admin/auth/login', '/api/admin/auth/totp'];

/** Маршрут админки (страница или API) — доступ решает гвард персонала, не PAGE_ACCESS/API_ACCESS. */
export function isAdminRoute(path: string): boolean {
  const p = path.split(/[?#]/, 1)[0] ?? '';
  return [ADMIN_PAGE_PREFIX, ADMIN_API_PREFIX].some((x) => p === x || p.startsWith(`${x}/`));
}

/** Роли, которым открыт уровень страницы. */
const LEVEL_ROLES: Record<Exclude<PageLevel, 'public'>, readonly SessionRole[]> = {
  account: ['pending', 'candidate', 'employer'],
  candidate: ['candidate'],
  employer: ['employer'],
};

/**
 * Куда вести вошедшего с чужой страницы (решения владельца 10.10): работодателя со страниц кандидата —
 * в профиль компании; кандидата из кабинета работодателя и pending — в ленту /consultant (это `HOME`, отдельной записи не нужно).
 * Роль совпала, но профиля роли в куке нет — в дом роли (`homePathFor`).
 */
const FOREIGN_REDIRECT: Partial<Record<'candidate' | 'employer', Partial<Record<SessionRole, string>>>> = {
  candidate: { employer: '/employer/company' },
};

/** Дом роли после входа и для чужих страниц. Пока у всех ролей — лента /consultant (решение владельца 10.10). */
const HOME: Record<SessionRole, string> = { pending: '/consultant', candidate: '/consultant', employer: '/consultant' };

export function homePathFor(role: SessionRole): string {
  return HOME[role];
}

/** Есть ли в сессии профиль для её активной роли (кандидат — candidateId, работодатель — аккаунт и профиль). */
export function hasActiveProfile(s: SessionPrincipal): boolean {
  if (s.role === 'candidate') return s.candidateId !== null;
  if (s.role === 'employer') return s.userId !== null && s.employerProfileId !== null;
  return s.userId !== null;
}

/** Пускает ли уровень сессию: активная роль уровня и профиль этой роли. Единственное место правила «роль + профиль». */
export function allowsLevel(level: Exclude<PageLevel, 'public'>, s: SessionPrincipal): boolean {
  return LEVEL_ROLES[level].includes(s.role) && hasActiveProfile(s);
}

function segments(path: string): string[] {
  const pathname = path.split(/[?#]/, 1)[0] ?? '';
  return pathname.split('/').filter(Boolean);
}

/**
 * Запись таблицы для конкретного пути: `[param]` совпадает с любым одним сегментом, статичный сегмент
 * точнее динамического. Catch-all (`[...x]`) маршрутов в приложении нет и таблица их не поддерживает:
 * такой маршрут не найдёт записи, и тест полноты упадёт. null — записи нет.
 */
export function matchRoute<T extends string>(table: Readonly<Record<T, unknown>>, path: string): T | null {
  const segs = segments(path);
  let best: T | null = null;
  let bestStatic = -1;
  for (const pattern of Object.keys(table) as T[]) {
    const ps = segments(pattern);
    if (ps.length !== segs.length) continue;
    let statics = 0;
    const ok = ps.every((p, i) => {
      if (/^\[[^.\]]+\]$/.test(p)) return true;
      statics++;
      return p === segs[i];
    });
    if (ok && statics > bestStatic) {
      best = pattern;
      bestStatic = statics;
    }
  }
  return best;
}

/** Уровень страницы по пути (query и hash игнорируются); null — записи нет (закрыто). */
export function pageLevelFor(path: string): PageLevel | null {
  const key = matchRoute(PAGE_ACCESS, path);
  return key ? PAGE_ACCESS[key] : null;
}

/** Уровень API по пути и методу; null — записи нет или метод не разрешён (закрыто). */
export function apiLevelFor(path: string, method: HttpMethod): ApiLevel | null {
  const key = matchRoute(API_ACCESS, path);
  if (!key) return null;
  const rule: ApiRule = API_ACCESS[key];
  return typeof rule === 'string' ? rule : (rule[method] ?? null);
}

/** Адрес входа: гость → /auth, протухшая кука → /api/auth/stale (стирает куку). Единственная сборка адреса. */
export function authRedirect(next: string, stale: boolean): string {
  return `${stale ? '/api/auth/stale' : '/auth'}?next=${encodeURIComponent(next)}`;
}

/**
 * Куда отправить со страницы `path`; null — пускать. Чистая функция (тесты без Next).
 * Гость → /auth?next=…; протухшая кука (`stale`: подпись верна, аккаунта нет) → /api/auth/stale?next=…,
 * который стирает куку (в Server Component куки менять нельзя). Вошедший без права → `FOREIGN_REDIRECT`
 * или дом роли. Пути без записи закрыты для всех.
 */
export function foreignPageRedirect(session: SessionPrincipal | null, path: string, opts: { stale?: boolean } = {}): string | null {
  const level = pageLevelFor(path);
  if (level === 'public') return null;
  if (!session) return authRedirect(path, opts.stale ?? false);
  if (level === null) return homePathFor(session.role);
  if (level === 'account') return null;
  if (allowsLevel(level, session)) return null;
  return FOREIGN_REDIRECT[level]?.[session.role] ?? homePathFor(session.role);
}
