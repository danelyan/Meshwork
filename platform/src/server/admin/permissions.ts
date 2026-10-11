/**
 * Права персонала (E-08, ADR 0009): единый каталог действий всех фаз 0–5 и матрица «роль → действия».
 * Одна таблица — один источник: гварды (`requireStaff`, `requirePageStaff`), меню (`nav.ts`) и тест матрицы
 * (`tests/unit/admin/permissions.test.ts`, каждая пара «роль × действие»). Новое действие лейн добавляет сюда
 * и в тест одной строкой; роли персонала ровно три (решение владельца 11.10), `analyst` нет.
 *
 * Чего в каталоге нет намеренно: ручной установки категории или грейда (R-C-06, принцип 2 E-08),
 * входа под пользователем, показа паролей и токенов.
 * Без `server-only`: модуль берут CLI (`scripts/admin-create.ts`) и клиентское меню.
 */

export const STAFF_ROLES = ['owner', 'moderator', 'support'] as const;
export type StaffRoleName = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABEL: Record<StaffRoleName, string> = {
  owner: 'Владелец',
  moderator: 'Модератор',
  support: 'Поддержка',
};

/** Каталог действий. Ключ — строка, которая пишется в журнал (`AdminAuditLog.action`). */
export const ACTIONS = [
  // фаза 1 — обзор и поиск (чтение)
  'view_dashboard',
  'view_users',
  'view_candidates',
  'view_companies',
  'view_vacancies',
  'view_invitations',
  /** Раскрыть ФИО/почту/телефон: только через `revealPii` с причиной, каждое раскрытие — строка журнала. */
  'reveal_pii',
  'view_audit',
  // фаза 2 — очереди модерации
  'view_complaints',
  'resolve_complaint',
  'view_appeals',
  'resolve_appeal',
  'view_objections',
  'answer_objection',
  'view_red_flags',
  'review_red_flag',
  'view_verification',
  'verify_company',
  // фаза 3 — пользователи и компании
  'block_user',
  'unblock_user',
  'block_company',
  'hide_vacancy',
  'hide_candidate',
  /** Сбросить кулдаун смены грейда/пересдачи (R-C-09). Категорию не меняет. */
  'reset_cooldown',
  /** Удаление по запросу субъекта ПДн через erase-account.ts, двойное подтверждение. */
  'erase_account',
  'manage_demo',
  'manage_staff',
  // фаза 4 — настройки и справочники
  'view_settings',
  'edit_settings',
  'edit_catalogs',
  // фаза 5 — качество механик и отчёты (только owner)
  'view_metrics',
  'export_csv',
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Матрица по таблице ролей эпика E-08:
 *  - owner — всё;
 *  - moderator — очереди, компании, вакансии, приглашения, псевдонимы кандидатов; решает жалобы, флаги,
 *    апелляции, верификацию; блокирует компании и скрывает вакансии и фейковые профили; ПДн не раскрывает;
 *  - support — карточки пользователей (ПДн через «Показать» с причиной); отвечает на возражения, сбрасывает
 *    кулдауны, разблокирует вход, запускает удаление по запросу.
 * Метрики, выгрузки, журнал, настройки, справочники, демо и персонал — только owner.
 */
const MODERATOR: readonly Action[] = [
  'view_dashboard',
  'view_candidates',
  'view_companies',
  'view_vacancies',
  'view_invitations',
  'view_complaints',
  'resolve_complaint',
  'view_appeals',
  'resolve_appeal',
  'view_red_flags',
  'review_red_flag',
  'view_verification',
  'verify_company',
  'block_company',
  'hide_vacancy',
  'hide_candidate',
];

const SUPPORT: readonly Action[] = [
  'view_dashboard',
  'view_users',
  'view_candidates',
  'view_companies',
  'reveal_pii',
  'view_objections',
  'answer_objection',
  'reset_cooldown',
  'unblock_user',
  'erase_account',
];

export const ROLE_ACTIONS: Readonly<Record<StaffRoleName, ReadonlySet<Action>>> = {
  owner: new Set(ACTIONS),
  moderator: new Set(MODERATOR),
  support: new Set(SUPPORT),
};

export function can(role: StaffRoleName, action: Action): boolean {
  return ROLE_ACTIONS[role]?.has(action) ?? false;
}

/**
 * Демо-вход жюри (решение владельца 11.10): кнопка на /admin/login при DEMO_LOGIN входит сотрудником-owner
 * `DEMO_STAFF_EMAIL` без пароля и TOTP. Ему доступно только чтение — экраны `view_*` и обезличенная
 * выгрузка; любые изменения и раскрытие ПДн — 403, чтобы один проверяющий не менял стенд остальным.
 */
export const DEMO_STAFF_EMAIL = 'demo-owner@admin.demo';
export const DEMO_STAFF_ACTIONS: ReadonlySet<Action> = new Set(ACTIONS.filter((a) => a.startsWith('view_') || a === 'export_csv'));
export const DEMO_READONLY_MESSAGE = 'Демо-вход: только просмотр. Изменения доступны сотрудникам с паролем и 2FA.';

export function isAction(x: string): x is Action {
  return (ACTIONS as readonly string[]).includes(x);
}

export function isStaffRole(x: string): x is StaffRoleName {
  return (STAFF_ROLES as readonly string[]).includes(x);
}

/** События входа и персонала — пишутся в журнал, но это не права. */
export const STAFF_EVENTS = [
  'staff.login',
  'staff.logout',
  'staff.totp_enabled',
  'staff.password_changed',
  'staff.create',
  'staff.role_change',
  'staff.disable',
  'staff.enable',
  'staff.totp_reset',
] as const;
export type StaffEvent = (typeof STAFF_EVENTS)[number];

/** Действие журнала: право, событие персонала или уточнение права (`resolve_complaint.upheld`). */
export type AuditAction = Action | StaffEvent | `${Action}.${string}`;
