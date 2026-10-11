import { z } from 'zod';

import type { Config } from './config.js';
import { SANDBOX_LIMITS, type Registry } from './data.js';
import { ATHLETE_DEMO_CLIENT } from './generator/realm.js';
import { ApiError, readJson, type Ctx, type Router } from './http.js';
import type { IdentityAdmin } from './idp.js';
import { DISCIPLINE_CODES, EVENT_KINDS, RANK_NAMES, type Athlete } from './types.js';
import { fullName, regionView } from './views.js';

/**
 * Песочница стенда: открытые (без токена) маршруты, которыми жюри правит реестр руками – заводит и
 * удаляет участников, вносит достижения и разряды. Правки сразу видны в основном API и в ФСП ID.
 * В настоящем реестре таких маршрутов быть не может: записи вносит федерация по протоколам.
 */

const KIND_LABELS: Record<(typeof EVENT_KINDS)[number], string> = {
  championship: 'Чемпионат России',
  cup_qualifier: 'Кубок России – отборочный этап',
  cup_final: 'Кубок России – финал',
  junior_championship: 'Первенство России',
  regional_championship: 'Чемпионат региона',
  hackathon: 'Хакатон ФСП',
};

/** Имена: буквы, пробел, дефис, апостроф. Страница открыта всем – произвольный текст сюда не попадает. */
const personName = (max = 40) => z.string().trim().min(1).max(max).regex(/^[\p{L}][\p{L} '’-]*$/u, 'только буквы, пробел, дефис и апостроф');
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'дата в виде ГГГГ-ММ-ДД')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'такой даты нет');
const discipline = z.enum(DISCIPLINE_CODES);

const athleteFields = {
  last_name: personName(),
  first_name: personName(),
  middle_name: z.union([z.literal(''), personName()]),
  sex: z.enum(['m', 'f']),
  birth_year: z.number().int().min(1950).max(2015),
  region_code: z.string().regex(/^\d{2}$/),
  disciplines: z.array(discipline).min(1).max(DISCIPLINE_CODES.length),
};
const athleteBody = z.object({ ...athleteFields, middle_name: athleteFields.middle_name.default(''), sex: athleteFields.sex.default('m') });
// Без значений по умолчанию: при правке не присланное поле остаётся как было.
const athletePatch = z.object(athleteFields).partial().refine((p) => Object.keys(p).length > 0, 'нет полей для изменения');

const achievementBody = z.object({
  event_id: z.string().min(1).max(40).optional(),
  event: z
    .object({
      // Название видят на платформе: без угловых скобок и управляющих символов.
      name: z.string().trim().min(3).max(160).regex(/^[^<>\p{Cc}]+$/u, 'без угловых скобок и управляющих символов'),
      discipline,
      kind: z.enum(EVENT_KINDS).default('hackathon'),
      date: isoDate,
      entrants_total: z.number().int().min(1).max(5000),
    })
    .optional(),
  place: z.number().int().min(1).max(5000).nullable().default(null),
  status: z.enum(['ranked', 'disqualified']).default('ranked'),
  team_name: z.string().trim().max(60).regex(/^[^<>\p{Cc}]*$/u, 'без угловых скобок и управляющих символов').optional(),
});

const rankBody = z.object({ discipline, rank: z.enum(RANK_NAMES), assigned_on: isoDate });

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

const FSP_ID = /^FSP-\d{5}$/;
const MUTATIONS_PER_MINUTE = 120;

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown, where = 'body'): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'validation', parsed.error.issues.map((i) => `${i.path.join('.') || where}: ${i.message}`).join('; '));
  return parsed.data;
}

const moscowToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());

export function registerSandboxRoutes(router: Router, deps: { registry: Registry; idp: IdentityAdmin; config: Config }): void {
  const { registry: reg, idp, config } = deps;

  // Правки идут строго по одной: номер ФСП ID резервируется до обращения к Keycloak.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  let window = { startedAt: 0, count: 0 };
  const mutation = <T>(fn: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    if (now - window.startedAt > 60_000) window = { startedAt: now, count: 0 };
    window.count += 1;
    if (window.count > MUTATIONS_PER_MINUTE) throw new ApiError(429, 'rate_limited', 'Слишком много правок подряд: подождите минуту', { 'retry-after': '60' });
    return serial(fn);
  };

  const fspIdOf = (ctx: Ctx) => {
    const id = ctx.params['fsp_id']!;
    if (!FSP_ID.test(id)) throw new ApiError(400, 'validation', 'fsp_id: формат FSP-00000');
    return id;
  };

  const notFuture = (date: string, field: string) => {
    if (date > moscowToday()) throw new ApiError(400, 'validation', `${field}: дата в будущем`);
    if (date < '2000-01-01') throw new ApiError(400, 'validation', `${field}: не раньше 2000 года`);
  };

  const row = (a: Athlete) => ({
    fsp_id: a.fsp_id,
    full_name: fullName(a),
    username: a.username,
    region: regionView(reg, a.region_code),
    disciplines: a.disciplines,
    achievements_total: reg.achievementsOf(a.fsp_id).length,
    ranks_total: reg.ranksOf(a.fsp_id).length,
    manual: a.manual === true,
  });

  const card = (a: Athlete) => ({
    athlete: { ...a, manual: a.manual === true, full_name: fullName(a), region: regionView(reg, a.region_code) },
    login: { username: a.username, password: config.demoPassword },
    achievements: reg.achievementsOf(a.fsp_id),
    ranks: reg.ranksOf(a.fsp_id),
    consents: reg.consentsOf(a.fsp_id),
  });

  router.add('GET', '/api/v1/sandbox/meta', () => ({
    data: {
      public_url: config.publicUrl,
      api_url: `${config.publicUrl}/api/v1`,
      issuer: config.issuer,
      token_url: `${config.issuer}/protocol/openid-connect/token`,
      platform_url: config.platformUrl,
      demo_password: config.demoPassword,
      athlete_demo_client: ATHLETE_DEMO_CLIENT,
      partner_demo: { client_id: 'fsp-partner-demo', client_secret: config.partnerDemoSecret },
      limits: SANDBOX_LIMITS,
      stats: reg.stats(),
      changes: reg.changes(),
      generated_at: reg.dataset.generated_at,
      disciplines: reg.dataset.disciplines.map((d) => ({ code: d.code, name: d.name, short_name: d.short_name, entrant_type: d.entrant_type })),
      regions: reg.dataset.regions.map((r) => ({ code: r.code, name: r.name })),
      ranks: RANK_NAMES,
      event_kinds: EVENT_KINDS.map((code) => ({ code, label: KIND_LABELS[code] })),
    },
  }));

  router.add('GET', '/api/v1/sandbox/athletes', (ctx) => {
    const q = parse(listQuery, Object.fromEntries(ctx.url.searchParams), 'query');
    const needle = q.q?.toLowerCase();
    const items = reg.dataset.athletes
      .filter((a) => !needle || a.fsp_id.toLowerCase().includes(needle) || a.username.includes(needle) || fullName(a).toLowerCase().includes(needle))
      // Сначала добавленные вручную (свежие сверху), затем исходный набор по номеру.
      .sort((a, b) => Number(b.manual === true) - Number(a.manual === true) || (a.manual ? b.fsp_id.localeCompare(a.fsp_id) : a.fsp_id.localeCompare(b.fsp_id)));
    const start = (q.page - 1) * q.per_page;
    return { data: items.slice(start, start + q.per_page).map(row), meta: { page: q.page, per_page: q.per_page, total: items.length, changes: reg.changes() } };
  });

  router.add('GET', '/api/v1/sandbox/athletes/:fsp_id', (ctx) => {
    const a = reg.athletesById.get(fspIdOf(ctx));
    if (!a) throw new ApiError(404, 'not_found', 'Участника нет в реестре');
    return { data: card(a) };
  });

  router.add('POST', '/api/v1/sandbox/athletes', async (ctx) => {
    const input = parse(athleteBody, await readJson(ctx.req));
    return mutation(async () => {
      const draft = reg.draftAthlete(input, moscowToday());
      await idp.upsertUser(draft);
      return { status: 201, data: card(reg.insertAthlete(draft)) };
    });
  });

  router.add('PATCH', '/api/v1/sandbox/athletes/:fsp_id', async (ctx) => {
    const id = fspIdOf(ctx);
    const patch = parse(athletePatch, await readJson(ctx.req));
    return mutation(async () => {
      const next = reg.patchedAthlete(id, patch);
      await idp.upsertUser(next);
      return { data: card(reg.replaceAthlete(next)) };
    });
  });

  router.add('DELETE', '/api/v1/sandbox/athletes/:fsp_id', (ctx) => {
    const id = fspIdOf(ctx);
    return mutation(async () => {
      const a = reg.athletesById.get(id);
      if (!a) throw new ApiError(404, 'not_found', 'Участника нет в реестре');
      await idp.deleteUser(a.username);
      reg.deleteAthlete(id);
      return { status: 204 };
    });
  });

  router.add('POST', '/api/v1/sandbox/athletes/:fsp_id/achievements', async (ctx) => {
    const id = fspIdOf(ctx);
    const input = parse(achievementBody, await readJson(ctx.req));
    if (input.event) notFuture(input.event.date, 'event.date');
    if (input.status === 'ranked' && input.place === null) throw new ApiError(400, 'validation', 'place: укажите место или статус disqualified');
    return mutation(async () => ({ status: 201, data: reg.addAchievement(id, input) }));
  });

  router.add('DELETE', '/api/v1/sandbox/achievements/:id', (ctx) =>
    mutation(async () => {
      reg.deleteAchievement(ctx.params['id']!);
      return { status: 204 };
    }),
  );

  router.add('POST', '/api/v1/sandbox/athletes/:fsp_id/ranks', async (ctx) => {
    const id = fspIdOf(ctx);
    const input = parse(rankBody, await readJson(ctx.req));
    notFuture(input.assigned_on, 'assigned_on');
    return mutation(async () => ({ status: 201, data: reg.addRank(id, input) }));
  });

  router.add('DELETE', '/api/v1/sandbox/ranks/:id', (ctx) =>
    mutation(async () => {
      reg.deleteRank(ctx.params['id']!);
      return { status: 204 };
    }),
  );

  router.add('POST', '/api/v1/sandbox/reset', () =>
    mutation(async () => {
      // Сначала пользователи ФСП ID: если Keycloak недоступен, реестр остаётся как был.
      const users = await idp.reconcile(reg.baseAthletes());
      reg.reset();
      return { data: { reset: true, users, stats: reg.stats() } };
    }),
  );
}
