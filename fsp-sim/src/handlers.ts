import { z } from 'zod';

import { authenticate, requireAthlete, type Principal, type Verifier } from './auth.js';
import type { Config } from './config.js';
import type { Registry } from './data.js';
import { ApiError, readJson, type Ctx, type Router } from './http.js';
import { renderLanding, renderSwagger } from './landing.js';
import { buildOpenApi } from './openapi.js';
import { CONSENT_SCOPES, type ConsentScope } from './types.js';
import { athleteCard, athleteProfile, resultView, teamView } from './views.js';

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

const eventsQuery = pageSchema.extend({
  discipline: z.enum(['product', 'algorithmic', 'infosec', 'robotics', 'drones']).optional(),
  season: z.coerce.number().int().min(2000).max(2100).optional(),
  level: z.enum(['regional', 'national']).optional(),
  kind: z.enum(['championship', 'cup_qualifier', 'cup_final', 'junior_championship', 'regional_championship', 'hackathon']).optional(),
  region: z.string().regex(/^\d{2}$/).optional(),
});

const athletesQuery = pageSchema.extend({
  q: z.string().trim().min(2).max(100).optional(),
  region: z.string().regex(/^\d{2}$/).optional(),
  discipline: z.enum(['product', 'algorithmic', 'infosec', 'robotics', 'drones']).optional(),
});

const consentBody = z.object({ scopes: z.array(z.enum(CONSENT_SCOPES)).min(1).default([...CONSENT_SCOPES]) });

function parseQuery<T extends z.ZodTypeAny>(schema: T, url: URL): z.infer<T> {
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    throw new ApiError(400, 'validation', parsed.error.issues.map((i) => `${i.path.join('.') || 'query'}: ${i.message}`).join('; '));
  }
  return parsed.data;
}

function paginate<T>(items: T[], q: { page: number; per_page: number }) {
  const start = (q.page - 1) * q.per_page;
  return { slice: items.slice(start, start + q.per_page), meta: { page: q.page, per_page: q.per_page, total: items.length } };
}

const FSP_ID = /^FSP-\d{5}$/;

export function registerRoutes(router: Router, deps: { registry: Registry; verify: Verifier; config: Config }): void {
  const { registry: reg, verify, config } = deps;
  const auth = (ctx: Ctx) => authenticate(ctx, verify);

  /** Проверка доступа партнёра или самого спортсмена к записи спортсмена. */
  const athleteAccess = (p: Principal, fspId: string, scope: ConsentScope) => {
    if (!FSP_ID.test(fspId)) throw new ApiError(400, 'validation', 'fsp_id: формат FSP-00000');
    const athlete = reg.athletesById.get(fspId);
    if (p.kind === 'athlete') {
      if (p.fspId !== fspId) throw new ApiError(403, 'forbidden', 'Спортсмену доступны только собственные записи');
    } else if (!athlete || !reg.hasConsent(fspId, p.clientId, scope)) {
      // Нет согласия и «нет такого спортсмена» неразличимы для партнёра: иначе по 404 можно перебирать реестр.
      throw new ApiError(403, 'consent_required', `Спортсмен не давал клиенту ${p.clientId} согласия на «${scope}» или не найден`);
    }
    if (!athlete) throw new ApiError(404, 'not_found', 'Спортсмен не найден');
    return athlete;
  };

  router.add('GET', '/', () => ({ html: renderLanding(reg, config) }));
  router.add('GET', '/docs', () => ({ html: renderSwagger(config) }));
  router.add('GET', '/openapi.json', () => ({ raw: buildOpenApi(config) }));

  router.add('GET', '/api/v1/health', async () => {
    let idp: 'up' | 'down' = 'down';
    try {
      const r = await fetch(config.internalDiscoveryUrl, { signal: AbortSignal.timeout(3000) });
      idp = r.ok ? 'up' : 'down';
    } catch {
      idp = 'down';
    }
    return { data: { ok: true, idp, issuer: config.issuer, generated_at: reg.dataset.generated_at, ...reg.stats() } };
  });

  router.add('GET', '/api/v1/disciplines', () => ({ data: reg.dataset.disciplines }));
  router.add('GET', '/api/v1/regions', () => ({ data: reg.dataset.regions }));
  router.add('GET', '/api/v1/partners', () => ({ data: reg.dataset.partners }));

  router.add('GET', '/api/v1/events', (ctx) => {
    const q = parseQuery(eventsQuery, ctx.url);
    const items = reg.dataset.events.filter(
      (e) =>
        (!q.discipline || e.discipline === q.discipline) &&
        (!q.season || e.season === q.season) &&
        (!q.level || e.level === q.level) &&
        (!q.kind || e.kind === q.kind) &&
        (!q.region || e.region_code === q.region),
    );
    const sorted = [...items].sort((a, b) => b.starts_on.localeCompare(a.starts_on) || a.event_id.localeCompare(b.event_id));
    const { slice, meta } = paginate(sorted, q);
    return { data: slice, meta };
  });

  router.add('GET', '/api/v1/events/:id', (ctx) => {
    const ev = reg.eventsById.get(ctx.params['id']!);
    if (!ev) throw new ApiError(404, 'not_found', 'Соревнование не найдено');
    return { data: ev };
  });

  router.add('GET', '/api/v1/events/:id/results', (ctx) => {
    const ev = reg.eventsById.get(ctx.params['id']!);
    if (!ev) throw new ApiError(404, 'not_found', 'Соревнование не найдено');
    const results = reg.resultsOf(ev.event_id).map((r) => resultView(reg, r));
    return {
      data: {
        event: { event_id: ev.event_id, name: ev.name, discipline: ev.discipline, level: ev.level, ends_on: ev.ends_on, regulation: ev.regulation, entrants_total: ev.entrants_total },
        results,
      },
    };
  });

  router.add('GET', '/api/v1/teams/:id', (ctx) => {
    const t = teamView(reg, ctx.params['id']!);
    if (!t) throw new ApiError(404, 'not_found', 'Команда не найдена');
    return { data: t };
  });

  router.add('GET', '/api/v1/achievements/:id/verify', (ctx) => {
    const a = reg.achievementsById.get(ctx.params['id']!);
    if (!a) return { data: { valid: false, achievement_id: ctx.params['id'], reason: 'Запись с таким идентификатором в реестре отсутствует' } };
    const athlete = reg.athletesById.get(a.fsp_id);
    return {
      data: {
        valid: true,
        achievement_id: a.achievement_id,
        checksum: a.checksum,
        fsp_id: a.fsp_id,
        athlete: athlete ? athleteCard(reg, athlete).display_name : null,
        event: { event_id: a.event_id, name: a.event_name, discipline: a.discipline, level: a.level, date: a.date },
        entrant_type: a.entrant_type,
        team_name: a.team_name,
        place: a.place,
        status: a.status,
        entrants_total: a.entrants_total,
        verified_at: a.verified_at,
        protocol_url: a.protocol_url,
      },
    };
  });

  // --- Спортсмен о себе ---------------------------------------------------------------------

  router.add('GET', '/api/v1/me', async (ctx) => {
    const p = requireAthlete(await auth(ctx));
    const a = reg.athletesById.get(p.fspId);
    if (!a) throw new ApiError(404, 'not_found', `В реестре нет записи для ${p.fspId}`);
    return { data: athleteProfile(reg, a) };
  });

  router.add('GET', '/api/v1/me/achievements', async (ctx) => {
    const p = requireAthlete(await auth(ctx));
    const q = parseQuery(pageSchema, ctx.url);
    const { slice, meta } = paginate(reg.achievementsOf(p.fspId), q);
    return { data: slice, meta };
  });

  router.add('GET', '/api/v1/me/ranks', async (ctx) => {
    const p = requireAthlete(await auth(ctx));
    return { data: reg.ranksOf(p.fspId) };
  });

  router.add('GET', '/api/v1/me/consents', async (ctx) => {
    const p = requireAthlete(await auth(ctx));
    const consents = reg.consentsOf(p.fspId).map((c) => ({ ...c, partner: reg.partnersById.get(c.client_id)?.name ?? null }));
    return { data: consents, meta: { available_scopes: CONSENT_SCOPES } };
  });

  router.add('PUT', '/api/v1/me/consents/:client_id', async (ctx) => {
    const p = requireAthlete(await auth(ctx));
    const clientId = ctx.params['client_id']!;
    if (!reg.partnersById.has(clientId)) throw new ApiError(404, 'not_found', `Партнёр ${clientId} не зарегистрирован`);
    const body = consentBody.safeParse(await readJson(ctx.req));
    if (!body.success) throw new ApiError(400, 'validation', body.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
    return { data: reg.grantConsent(p.fspId, clientId, body.data.scopes) };
  });

  router.add('DELETE', '/api/v1/me/consents/:client_id', async (ctx) => {
    const p = requireAthlete(await auth(ctx));
    const clientId = ctx.params['client_id']!;
    if (!reg.partnersById.has(clientId)) throw new ApiError(404, 'not_found', `Партнёр ${clientId} не зарегистрирован`);
    reg.revokeConsent(p.fspId, clientId);
    return { status: 204 };
  });

  // --- Партнёр о спортсменах (в пределах согласий) -----------------------------------------

  router.add('GET', '/api/v1/athletes', async (ctx) => {
    const p = await auth(ctx);
    if (p.kind !== 'partner') throw new ApiError(403, 'forbidden', 'Поиск по реестру доступен только партнёру (client_credentials)');
    const q = parseQuery(athletesQuery, ctx.url);
    const needle = q.q?.toLowerCase();
    const items = reg
      .athletesConsentedTo(p.clientId)
      .filter(
        (a) =>
          (!q.region || a.region_code === q.region) &&
          (!q.discipline || a.disciplines.includes(q.discipline)) &&
          (!needle || a.fsp_id.toLowerCase() === needle || `${a.last_name} ${a.first_name} ${a.middle_name}`.toLowerCase().includes(needle)),
      )
      .map((a) => athleteCard(reg, a));
    const { slice, meta } = paginate(items, q);
    return { data: slice, meta: { ...meta, client_id: p.clientId } };
  });

  router.add('GET', '/api/v1/athletes/:fsp_id', async (ctx) => {
    const p = await auth(ctx);
    const a = athleteAccess(p, ctx.params['fsp_id']!, 'profile');
    return { data: athleteProfile(reg, a) };
  });

  router.add('GET', '/api/v1/athletes/:fsp_id/achievements', async (ctx) => {
    const p = await auth(ctx);
    const a = athleteAccess(p, ctx.params['fsp_id']!, 'achievements');
    const q = parseQuery(pageSchema, ctx.url);
    const { slice, meta } = paginate(reg.achievementsOf(a.fsp_id), q);
    return { data: slice, meta };
  });

  router.add('GET', '/api/v1/athletes/:fsp_id/ranks', async (ctx) => {
    const p = await auth(ctx);
    const a = athleteAccess(p, ctx.params['fsp_id']!, 'ranks');
    return { data: reg.ranksOf(a.fsp_id) };
  });
}
