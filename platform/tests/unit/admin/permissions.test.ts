import { ACTIONS, type Action, ROLE_ACTIONS, STAFF_ROLES, type StaffRoleName, can } from '@/server/admin/permissions';
import { ADMIN_NAV, navFor } from '@/lib/admin-nav';

// Матрица прав персонала (E-08, ADR 0009): ожидание записано здесь независимо от permissions.ts –
// каждая пара «роль × действие» проверяется отдельно. Новое действие без строки здесь роняет тест полноты.
const O = 'owner';
const M = 'moderator';
const S = 'support';
const EXPECTED: Record<Action, readonly StaffRoleName[]> = {
  view_dashboard: [O, M, S],
  view_users: [O, S],
  view_candidates: [O, M, S],
  view_companies: [O, M, S],
  view_vacancies: [O, M],
  view_invitations: [O, M],
  reveal_pii: [O, S],
  view_audit: [O],
  view_complaints: [O, M],
  resolve_complaint: [O, M],
  view_appeals: [O, M],
  resolve_appeal: [O, M],
  view_objections: [O, S],
  answer_objection: [O, S],
  view_red_flags: [O, M],
  review_red_flag: [O, M],
  view_verification: [O, M],
  verify_company: [O, M],
  block_user: [O],
  unblock_user: [O, S],
  block_company: [O, M],
  hide_vacancy: [O, M],
  hide_candidate: [O, M],
  reset_cooldown: [O, S],
  erase_account: [O, S],
  manage_demo: [O],
  manage_staff: [O],
  view_settings: [O],
  edit_settings: [O],
  edit_catalogs: [O],
  view_metrics: [O],
  export_csv: [O],
};

describe('матрица прав персонала', () => {
  it('ровно три роли, analyst нет', () => {
    expect([...STAFF_ROLES]).toEqual(['owner', 'moderator', 'support']);
  });

  it('у каждого действия каталога есть ожидание и наоборот', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ACTIONS].sort());
  });

  const pairs = STAFF_ROLES.flatMap((role) => ACTIONS.map((action) => [role, action, EXPECTED[action].includes(role)] as const));
  it.each(pairs)('%s × %s → %s', (role, action, allowed) => {
    expect(can(role, action)).toBe(allowed);
  });

  it('owner может всё', () => {
    expect(ROLE_ACTIONS.owner.size).toBe(ACTIONS.length);
  });

  it('в каталоге нет ручной установки категории/грейда и входа под пользователем', () => {
    for (const a of ACTIONS) expect(a).not.toMatch(/grade|category|impersonat|login_as/);
  });

  it('неизвестная роль ничего не может', () => {
    expect(can('analyst' as StaffRoleName, 'view_dashboard')).toBe(false);
  });
});

describe('меню админки', () => {
  it('пункты уникальны и лежат под /admin', () => {
    const hrefs = ADMIN_NAV.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of hrefs) expect(h === '/admin' || h.startsWith('/admin/')).toBe(true);
  });

  it('пункт виден ровно тем ролям, у кого есть его право', () => {
    for (const role of STAFF_ROLES) {
      const visible = navFor(role).flatMap((g) => g.items.map((i) => i.href));
      const expected = ADMIN_NAV.flatMap((g) => g.items).filter((i) => can(role, i.action)).map((i) => i.href);
      expect(visible).toEqual(expected);
    }
    expect(navFor('moderator').flatMap((g) => g.items.map((i) => i.href))).not.toContain('/admin/staff');
    expect(navFor('support').flatMap((g) => g.items.map((i) => i.href))).not.toContain('/admin/metrics');
  });
});
