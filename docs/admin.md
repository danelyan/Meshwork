# Админка: контракты для лейнов (E-08)

Решения — [ADR 0009](decisions/0009-admin-staff.md). Эпик и фазы — личный `fsp/docs/epics/E-08-admin.md`.
Фундамент (фаза 0) уже даёт схему всех фаз, вход, права, журнал, раскладку и меню. Лейн фазы **только
создаёт свои страницы, API и сервисы** по путям ниже и не трогает раскладку, меню, матрицу прав и
`server/auth/access.ts`.

## Как писать страницу и API

```ts
// src/app/(admin)/admin/complaints/page.tsx
const staff = await requirePageStaff('/admin/complaints', 'view_complaints'); // server/admin/session.ts

// src/app/api/admin/complaints/[id]/route.ts
export const POST = withErrors(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const staff = await requireStaff(req, 'resolve_complaint'); // 401 / 403 / CSRF для мутаций
  const body = Body.parse(await req.json());
  const reason = requireReason(body.reason);                  // server/admin/audit.ts, 400 если пусто
  await prisma.$transaction(async (tx) => {
    const before = await tx.complaint.findUniqueOrThrow({ where: { id } });
    const after = await tx.complaint.update({ where: { id }, data: { status: 'dismissed', resolvedById: staff.staffId, resolvedAt: new Date(), resolution: reason } });
    await audit({ actor: staff, action: 'resolve_complaint.dismissed', target: { type: 'complaint', id }, reason, before, after }, tx);
  });
});
```

- Тест `tests/unit/auth/access-coverage.test.ts` требует `requirePageStaff('<адрес страницы>', …)` в каждой
  `page.tsx` под `/admin` и `requireStaff(req…)` в каждом обработчике под `/api/admin`.
- ПДн: `revealPii({ actor: staff, target, reason, fields: ['email'] }, () => prisma…)` — право, причина,
  журнал; без него ФИО/почту/телефон не отдавать (списки — псевдоним, `maskContacts`).
- `action` журнала — право из `permissions.ts` или уточнение `<право>.<исход>`; `target.type` — `user`,
  `candidate`, `company`, `vacancy`, `invitation`, `complaint`, `appeal`, `objection`, `red_flag`, `setting`, `staff`.
- Новое право — строка в `ACTIONS`, роли в матрице и ожидание в `tests/unit/admin/permissions.test.ts`
  (единственная общая правка; согласовать с интегратором).
- UI — `src/components/ui`, стили — `src/app/(admin)/admin/admin.module.css` (классы `title`, `muted`,
  `table`, `filters`, `row`, `mono`, `card`, `form`) или свой `*.module.css` только на токенах.
- Клиентские формы — `src/components/admin/adminFetch.ts`.
- OpenAPI: после новых маршрутов `npx tsx scripts/build-openapi.ts` (роль `staff` распознаётся по `requireStaff`).

## Пути и права по фазам

| Фаза | Страница (меню уже есть) | Право страницы | API (префикс `/api/admin`) | Поля схемы |
|---|---|---|---|---|
| 0 ✓ | `/admin/login`, `/admin`, `/admin/audit`, `/admin/staff`, `/admin/password` | — / `view_dashboard` / `view_audit` / `manage_staff` / любой | `auth/{login,totp,logout,me,password}`, `staff`, `staff/[id]`, `audit` | `StaffMember`, `AdminSession`, `AdminAuditLog` |
| 1 | `/admin` (дашборд — правит `page.tsx`), `/admin/users`, `/admin/candidates`, `/admin/companies`, `/admin/vacancies`, `/admin/invitations` (+ `[id]` карточки) | `view_dashboard`, `view_users`, `view_candidates`, `view_companies`, `view_vacancies`, `view_invitations`; раскрытие — `reveal_pii` | `dashboard`, `users`, `candidates`, `companies`, `vacancies`, `invitations`, `…/[id]`, `…/[id]/pii` | только чтение |
| 2 | `/admin/complaints`, `/admin/appeals`, `/admin/objections`, `/admin/red-flags`, `/admin/verification` | `view_*` + `resolve_complaint`, `resolve_appeal`, `answer_objection`, `review_red_flag`, `verify_company` | `complaints`, `appeals`, `objections`, `red-flags`, `verification` (+ `[id]`) | `Complaint.resolvedById/resolvedAt/resolution`, `SanctionAppeal`, `AssessmentObjection.answeredById`, `RedFlagReview`, `Company.verifiedAt/verifiedById/verificationNote/verificationRequestedAt/verificationEvidence` |
| 3 | карточки фазы 1 (кнопки действий), демо — `/admin/demo` (вне меню или в «Платформа» через интегратора) | `block_user`, `unblock_user`, `block_company`, `hide_vacancy`, `hide_candidate`, `reset_cooldown`, `erase_account`, `manage_demo` | `users/[id]/block`, `companies/[id]/block`, `candidates/[id]/hide`, `candidates/[id]/cooldown`, `users/[id]/erase`, `vacancies/[id]/hide`, `demo` | `User.blocked*`, `Company.blocked*` (`blockedAt`, `blockedUntil`, `blockedReason`, `blockedById`) |
| 4 | `/admin/settings`, `/admin/catalogs` | `view_settings`, `edit_settings`, `edit_catalogs` | `settings`, `settings/[key]`, `settings/[key]/rollback`, `catalogs/*` | `PlatformSetting`, `PlatformSettingVersion` |
| 5 | `/admin/metrics` | `view_metrics`, `export_csv` | `metrics/*`, `export/*.csv` | только чтение |

Персонал (управление ролями, приглашение, отключение, сброс 2FA) сделан в фазе 0, в фазе 3 его не дублировать.

## Итог по фазам (после слияния 0–5)

- Меню (`src/lib/admin-nav.ts`): к фундаменту добавлены `/admin/applications` («База», `view_invitations`) и `/admin/demo` («Платформа», `manage_demo`, только owner).
- `/admin/applications` и `GET /api/admin/applications`: самоотклики кандидатов на вакансии (фаза 1, `server/admin/overview/lists.ts`), только чтение.
- `GET /api/admin/users/[id]/pii` (и `candidates`, `companies`): раскрытие ПДн по причине, запись в журнал (`reveal_pii`, фаза 0/1).
- `/admin/demo`, `/api/admin/demo` (фаза 3, owner): демо-аккаунты, чистка мусора e2e по маркерам, переключатель показа демо в подборке.
- Настройка `matching.show_demo_candidates` (boolean, умолчание `true`) лежит в реестре `server/admin/settings/registry.ts` как `internal` (на `/admin/settings` не показывается — правится на `/admin/demo`); читать `getSetting`, писать `setDemoSetting` (версия + журнал `manage_demo.show_in_matching`).
- `POST /api/admin/vacancies/[id]/hide` `{ hidden, reason }` (`hide_vacancy`, owner/moderator): скрытие хранится как `RedFlagReview` со статусом `hidden` (`server/admin/moderation/red-flags.ts`: `setVacancyHidden`, `hiddenVacancyIds`, `isVacancyHidden`); возврат переводит ревью в `ok`. Журнал `hide_vacancy.hidden` / `hide_vacancy.shown`. Повтор того же состояния — 409.
- «Заблокирован сейчас» везде решает `isBlockedNow` / `activeBlockWhere` (`server/admin/accounts/state.ts`), не `blockedAt != null`: разблокировка ставит `blockedUntil = now`.
- Заблокированный кандидат для работодателя (404 как у скрытого): подборка/поиск, избранное, приглашение, черновик приглашения агентом, созвон без accepted, список сдач проекта, ИИ-защита сдачи.
- Кнопки действий в карточках: `components/admin/actions/` (`UserActions`, `CompanyActions`, `CandidateActions`, `VacancyActions`); права передаются флагами `can` с сервера.

## Вход и персонал

- Демо-вход жюри: `POST /api/admin/auth/demo` при `DEMO_LOGIN=true` → сессия owner `demo-owner@admin.demo`
  без пароля и TOTP. `requireStaff` пропускает только `view_*` и `export_csv` на GET плюс выход, остальное —
  403; `revealPii` для демо — 403 (`session.demoAllows`, `permissions.DEMO_STAFF_ACTIONS`).

- Первый owner: `printf '%s' "$PASS" | npx tsx scripts/admin-create.ts --email … --name … --role owner`
  (пароль — stdin или `ADMIN_PASSWORD`). Потерян телефон: `… --reset-totp --email …`.
- TOTP настраивается при первом входе (секрет и otpauth-URI на экране). Приглашённый в `/admin/staff`
  получает временный пароль (показан владельцу один раз) и меняет его на `/admin/password`.
- В тестах сессию сотрудника без прохода входа даёт строка `AdminSession` + `signAdminToken(id)` (образец —
  `tests/integration/admin/admin-auth.test.ts`, `sessionFor`).
