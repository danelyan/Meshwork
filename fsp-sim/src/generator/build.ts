import { createHash } from 'node:crypto';

import type {
  Achievement, Athlete, Consent, Dataset, DisciplineCode, Event, EventKind, Rank, RankName, Result, Team,
} from '../types.js';
import { CONSENT_SCOPES } from '../types.js';
import { DISCIPLINES, DISCIPLINE_BY_CODE, FINAL_CITIES, HACKATHON_THEMES, PARTNERS, REGIONS } from './catalog.js';
import { FEMALE_NAMES, MALE_NAMES, PATRONYMICS, SURNAMES, TEAM_ADJECTIVES, TEAM_NOUNS } from './names.js';
import { Rng } from './rng.js';

/**
 * Генератор синтетического реестра. Детерминирован: один seed → байт в байт тот же набор
 * (tests/generator.test.ts сверяет data/dataset.json с повторной генерацией).
 * Правила присвоения разрядов – упрощённая условность для демо, не ЕВСК.
 */

export const DEFAULT_SEED = 20261010;
export const GENERATED_AT = '2026-10-10T12:00:00+03:00';
const ATHLETES_TOTAL = 120;
const SEASONS = [2023, 2024, 2025, 2026];
/** События позже этой даты в набор не попадают (набор «на 1 октября 2026»). */
const DATA_CUTOFF = '2026-10-01';
const ORGANIZER = 'Федерация спортивного программирования (симуляция)';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const MS_DAY = 86_400_000;

export function addDays(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00Z`).getTime() + days * MS_DAY;
  return new Date(t).toISOString().slice(0, 10);
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

const RANK_ORDER: Record<RankName, number> = {
  'II юношеский разряд': 0,
  'I юношеский разряд': 1,
  'III спортивный разряд': 2,
  'II спортивный разряд': 3,
  'I спортивный разряд': 4,
  'КМС': 5,
  'МС': 6,
};

const CITY_REGION: Record<string, string> = Object.fromEntries(REGIONS.map((r) => [r.city, r.code]));

interface Ctx {
  rng: Rng;
  skill: Map<string, number>;
  athletes: Athlete[];
  teams: Team[];
  events: Event[];
  results: Result[];
  achievements: Achievement[];
  achievementSeq: Map<number, number>;
}

function buildAthletes(rng: Rng, skill: Map<string, number>): Athlete[] {
  const used = new Set<string>();
  const out: Athlete[] = [];
  for (let i = 0; i < ATHLETES_TOTAL; i++) {
    const sex: 'm' | 'f' = rng.chance(0.68) ? 'm' : 'f';
    let first = '';
    let last = '';
    do {
      first = rng.pick(sex === 'm' ? MALE_NAMES : FEMALE_NAMES);
      last = rng.pick(SURNAMES) + (sex === 'f' ? 'а' : '');
    } while (used.has(`${last} ${first}`));
    used.add(`${last} ${first}`);
    const middle = rng.pick(PATRONYMICS)[sex === 'm' ? 0 : 1];
    const birthBand = rng.weighted([[0, 3], [1, 5], [2, 2]] as const);
    const birth_year = birthBand === 0 ? rng.int(1996, 2001) : birthBand === 1 ? rng.int(2002, 2006) : rng.int(2007, 2009);
    const region = rng.weighted(REGIONS.map((r) => [r, r.weight] as const));
    const primary = rng.weighted<DisciplineCode>([
      ['product', 34], ['algorithmic', 30], ['infosec', 14], ['robotics', 11], ['drones', 11],
    ]);
    const disciplines: DisciplineCode[] = [primary];
    if (rng.chance(0.3)) {
      const other = rng.pick(DISCIPLINES.filter((d) => d.code !== primary)).code;
      disciplines.push(other);
    }
    const year = rng.weighted([[2022, 3], [2023, 4], [2024, 4], [2025, 2]] as const);
    const member_since = iso(year, rng.int(1, 12), rng.int(1, 28));
    const fsp_id = `FSP-${10001 + i}`;
    skill.set(fsp_id, round1(0.15 + rng.next() * 0.8));
    out.push({
      fsp_id,
      last_name: last,
      first_name: first,
      middle_name: middle,
      sex,
      birth_year,
      region_code: region.code,
      disciplines,
      member_since,
      status: 'active',
      username: fsp_id.toLowerCase(),
      email: `${fsp_id.toLowerCase()}@example.com`,
    });
  }
  return out;
}

interface EventSpec {
  kind: EventKind;
  season: number;
  discipline: DisciplineCode;
  regionCode: string | null;
}

function eventName(spec: EventSpec, theme: string): string {
  const short = DISCIPLINE_BY_CODE[spec.discipline].short_name;
  const base = `по спортивному программированию (${short})`;
  switch (spec.kind) {
    case 'cup_qualifier': return `Кубок России ${base}, отборочный этап ${spec.season}`;
    case 'cup_final': return `Кубок России ${base}, финал ${spec.season}`;
    case 'championship': return `Чемпионат России ${base} ${spec.season}`;
    case 'junior_championship': return `Первенство России ${base} ${spec.season}`;
    case 'regional_championship': {
      const region = REGIONS.find((r) => r.code === spec.regionCode)!;
      return `Региональный чемпионат ${base}, ${region.name}, ${spec.season}`;
    }
    case 'hackathon': return `Всероссийский хакатон ФСП «${theme}» ${spec.season}`;
  }
}

function makeEvent(ctx: Ctx, spec: EventSpec, seq: number): Event | null {
  const { rng } = ctx;
  const d = DISCIPLINE_BY_CODE[spec.discipline];
  const days = spec.discipline === 'algorithmic' ? 1 : spec.kind === 'hackathon' ? 2 : 2;
  let starts_on: string;
  let format: Event['format'];
  let city: string | null = null;
  let region_code: string | null = spec.regionCode;
  switch (spec.kind) {
    case 'cup_qualifier': starts_on = iso(spec.season, 2, rng.int(8, 22)); format = 'online'; break;
    case 'cup_final':
      starts_on = iso(spec.season, rng.chance(0.5) ? 5 : 6, rng.int(5, 25)); format = 'offline';
      city = rng.pick(FINAL_CITIES); region_code = CITY_REGION[city]!; break;
    case 'championship':
      starts_on = iso(spec.season, 9, rng.int(8, 22)); format = rng.chance(0.3) ? 'hybrid' : 'offline';
      city = rng.pick(FINAL_CITIES); region_code = CITY_REGION[city]!; break;
    case 'junior_championship':
      starts_on = iso(spec.season, 7, rng.int(3, 20)); format = 'hybrid';
      city = rng.pick(FINAL_CITIES); region_code = CITY_REGION[city]!; break;
    case 'regional_championship': {
      const region = REGIONS.find((r) => r.code === spec.regionCode)!;
      starts_on = iso(spec.season, rng.chance(0.5) ? 3 : 4, rng.int(2, 26)); format = 'offline'; city = region.city; break;
    }
    case 'hackathon':
      starts_on = iso(spec.season, 11, rng.int(5, 20)); format = 'hybrid'; city = 'Москва'; region_code = '77'; break;
  }
  const ends_on = addDays(starts_on, days - 1);
  if (ends_on > DATA_CUTOFF) return null;
  const event_id = `EV-${spec.season}-${pad(seq, 3)}`;
  const theme = HACKATHON_THEMES[(spec.season - 2023) % HACKATHON_THEMES.length]!;
  return {
    event_id,
    name: eventName(spec, theme),
    discipline: spec.discipline,
    kind: spec.kind,
    level: spec.kind === 'regional_championship' ? 'regional' : 'national',
    season: spec.season,
    starts_on,
    ends_on,
    format,
    region_code,
    city,
    organizer: ORGANIZER,
    regulation: { code: `РГ-${spec.discipline.toUpperCase()}-${spec.season}`, version: `${spec.season}.1`, criteria: d.criteria },
    entrant_type: d.entrant_type,
    entrants_total: 0,
    participants_total: 0,
    protocol_url: `/api/v1/events/${event_id}/results`,
  };
}

function isJunior(a: Athlete, season: number): boolean {
  return season - a.birth_year <= 18;
}

function eligiblePool(ctx: Ctx, ev: Event): Athlete[] {
  return ctx.athletes.filter((a) => {
    if (!a.disciplines.includes(ev.discipline)) return false;
    if (a.member_since > ev.starts_on) return false;
    if (ev.kind === 'junior_championship' && !isJunior(a, ev.season)) return false;
    if (ev.kind === 'regional_championship' && a.region_code !== ev.region_code) return false;
    return true;
  });
}

function teamName(rng: Rng, taken: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    const name = `${rng.pick(TEAM_ADJECTIVES)} ${rng.pick(TEAM_NOUNS)}`;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  const name = `Команда ${taken.size + 1}`;
  taken.add(name);
  return name;
}

function formTeams(ctx: Ctx, ev: Event, entrants: Athlete[]): Team[] {
  const { rng } = ctx;
  const maxSize = ev.discipline === 'product' ? 5 : 4;
  const byRegion = new Map<string, Athlete[]>();
  for (const a of entrants) byRegion.set(a.region_code, [...(byRegion.get(a.region_code) ?? []), a]);
  const groups: Athlete[][] = [];
  const leftovers: Athlete[] = [];
  for (const members of [...byRegion.values()].map((g) => rng.shuffle(g))) {
    let rest = members;
    while (rest.length >= 3) {
      let size = Math.min(rest.length, rng.int(3, maxSize));
      if (rest.length - size > 0 && rest.length - size < 3) size = Math.min(rest.length, maxSize);
      groups.push(rest.slice(0, size));
      rest = rest.slice(size);
    }
    leftovers.push(...rest);
  }
  let rest = rng.shuffle(leftovers);
  while (rest.length >= 3) {
    const size = Math.min(rest.length, rng.int(3, maxSize));
    groups.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  for (const a of rest) {
    const target = groups.find((g) => g.length < maxSize);
    if (target) target.push(a);
  }
  const taken = new Set<string>();
  return groups.map((members, i) => ({
    team_id: `TM-${ev.event_id}-${pad(i + 1)}`,
    name: teamName(rng, taken),
    event_id: ev.event_id,
    region_code: members[0]!.region_code,
    captain_fsp_id: members[0]!.fsp_id,
    members: members.map((m) => m.fsp_id),
  }));
}

interface Entrant {
  team: Team | null;
  athlete: Athlete | null;
  members: string[];
}

function scoreEntrant(ctx: Ctx, ev: Event, e: Entrant): Omit<Result, 'result_id' | 'event_id' | 'place' | 'status' | 'entrant_type' | 'team_id' | 'fsp_id'> {
  const { rng } = ctx;
  const avg = e.members.reduce((s, id) => s + (ctx.skill.get(id) ?? 0.5), 0) / e.members.length;
  const strength = clamp(avg + (rng.next() - 0.5) * 0.3, 0.02, 0.98);
  switch (ev.discipline) {
    case 'algorithmic': {
      const tasks = rng.int(8, 12);
      const solved = clamp(Math.round(tasks * clamp(strength * 0.9 + (rng.next() - 0.5) * 0.25, 0, 1)), 0, tasks);
      const penalty = solved * rng.int(20, 60) + rng.int(0, 50);
      return { points: solved, criteria_scores: null, tasks_solved: solved, penalty };
    }
    case 'infosec':
      return { points: Math.round(5000 * clamp(strength * 0.85 + rng.next() * 0.15, 0, 1)), criteria_scores: null, tasks_solved: null, penalty: null };
    case 'product': {
      const scores = Array.from({ length: 6 }, () => round1(clamp(10 * (strength * 0.8 + rng.next() * 0.2), 0, 10)));
      return { points: round1(scores.reduce((s, x) => s + x, 0)), criteria_scores: scores, tasks_solved: null, penalty: null };
    }
    case 'robotics':
    case 'drones': {
      const scores = Array.from({ length: 4 }, () => round1(clamp(25 * (strength * 0.8 + rng.next() * 0.2), 0, 25)));
      return { points: round1(scores.reduce((s, x) => s + x, 0)), criteria_scores: scores, tasks_solved: null, penalty: null };
    }
  }
}

function checksum(a: Pick<Achievement, 'achievement_id' | 'fsp_id' | 'event_id' | 'place' | 'points'>): string {
  return createHash('sha256').update(`${a.achievement_id}|${a.fsp_id}|${a.event_id}|${a.place ?? '-'}|${a.points}`).digest('hex');
}

export function achievementChecksum(a: Achievement): string {
  return checksum(a);
}

function runEvent(ctx: Ctx, ev: Event): boolean {
  const { rng } = ctx;
  const pool = eligiblePool(ctx, ev);
  const rate = ev.kind === 'regional_championship' ? 0.85 : ev.kind === 'hackathon' ? 0.45 : ev.kind === 'junior_championship' ? 0.7 : 0.5 + rng.next() * 0.3;
  const entrantsAthletes = rng.shuffle(pool).slice(0, Math.round(pool.length * rate));
  let entrants: Entrant[];
  if (ev.entrant_type === 'team') {
    const teams = formTeams(ctx, ev, entrantsAthletes);
    if (teams.length < 2) return false;
    entrants = teams.map((t) => ({ team: t, athlete: null, members: t.members }));
    ctx.teams.push(...teams);
  } else {
    if (entrantsAthletes.length < 4) return false;
    entrants = entrantsAthletes.map((a) => ({ team: null, athlete: a, members: [a.fsp_id] }));
  }
  const scored = entrants.map((e) => ({ e, score: scoreEntrant(ctx, ev, e), dq: rng.chance(0.03) }));
  const ranked = scored
    .filter((s) => !s.dq)
    .sort((a, b) => b.score.points - a.score.points || (a.score.penalty ?? 0) - (b.score.penalty ?? 0) || a.e.members[0]!.localeCompare(b.e.members[0]!));
  const dq = scored.filter((s) => s.dq);
  const ordered = [...ranked.map((s, i) => ({ ...s, place: i + 1 as number | null })), ...dq.map((s) => ({ ...s, place: null as number | null }))];
  ev.entrants_total = entrants.length;
  ev.participants_total = entrants.reduce((s, e) => s + e.members.length, 0);
  ordered.forEach((s, i) => {
    const status = s.dq ? 'disqualified' : 'ranked';
    const result: Result = {
      result_id: `RS-${ev.event_id}-${pad(i + 1, 3)}`,
      event_id: ev.event_id,
      place: s.place,
      status,
      entrant_type: ev.entrant_type,
      team_id: s.e.team?.team_id ?? null,
      fsp_id: s.e.athlete?.fsp_id ?? null,
      points: s.dq ? 0 : s.score.points,
      criteria_scores: s.dq ? null : s.score.criteria_scores,
      tasks_solved: s.dq ? null : s.score.tasks_solved,
      penalty: s.dq ? null : s.score.penalty,
    };
    ctx.results.push(result);
    for (const fsp_id of s.e.members) {
      const seq = (ctx.achievementSeq.get(ev.season) ?? 0) + 1;
      ctx.achievementSeq.set(ev.season, seq);
      const base = {
        achievement_id: `ACH-${ev.season}-${pad(seq, 4)}`,
        fsp_id,
        event_id: ev.event_id,
        place: result.place,
        points: result.points,
      };
      ctx.achievements.push({
        ...base,
        event_name: ev.name,
        discipline: ev.discipline,
        level: ev.level,
        kind: ev.kind,
        season: ev.season,
        date: ev.ends_on,
        entrant_type: ev.entrant_type,
        team_id: s.e.team?.team_id ?? null,
        team_name: s.e.team?.name ?? null,
        status,
        entrants_total: ev.entrants_total,
        criteria_scores: result.criteria_scores,
        regulation: { code: ev.regulation.code, version: ev.regulation.version },
        verified: true,
        verified_at: `${addDays(ev.ends_on, rng.int(3, 14))}T10:00:00+03:00`,
        protocol_url: ev.protocol_url,
        checksum: checksum(base),
      });
    }
  });
  return true;
}

function buildEvents(ctx: Ctx): void {
  const { rng } = ctx;
  for (const season of SEASONS) {
    let seq = 0;
    const specs: EventSpec[] = [];
    for (const d of DISCIPLINES) {
      specs.push({ kind: 'cup_qualifier', season, discipline: d.code, regionCode: null });
      specs.push({ kind: 'cup_final', season, discipline: d.code, regionCode: null });
      specs.push({ kind: 'championship', season, discipline: d.code, regionCode: null });
      specs.push({ kind: 'junior_championship', season, discipline: d.code, regionCode: null });
      // Региональный чемпионат – в регионе, где по дисциплине достаточно спортсменов.
      const counts = new Map<string, number>();
      for (const a of ctx.athletes) if (a.disciplines.includes(d.code)) counts.set(a.region_code, (counts.get(a.region_code) ?? 0) + 1);
      const candidates = [...counts.entries()].filter(([, n]) => n >= (d.entrant_type === 'team' ? 7 : 5)).map(([code]) => code).sort();
      if (candidates.length > 0) specs.push({ kind: 'regional_championship', season, discipline: d.code, regionCode: rng.pick(candidates) });
    }
    specs.push({ kind: 'hackathon', season, discipline: 'product', regionCode: null });
    for (const spec of specs) {
      const ev = makeEvent(ctx, spec, seq + 1);
      if (!ev) continue;
      const teamsBefore = ctx.teams.length;
      if (!runEvent(ctx, ev)) {
        ctx.teams.length = teamsBefore;
        continue;
      }
      seq += 1;
      ctx.events.push(ev);
    }
  }
  ctx.events.sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.event_id.localeCompare(b.event_id));
}

/** Условное правило присвоения разряда по одному результату (не ЕВСК). */
export function impliedRank(a: Achievement, athlete: Athlete): RankName | null {
  if (a.place === null) return null;
  const half = Math.ceil(a.entrants_total / 2);
  const junior = isJunior(athlete, a.season);
  switch (a.kind) {
    case 'championship':
    case 'cup_final':
      if (a.place === 1) return junior ? 'КМС' : 'МС';
      if (a.place <= 3) return 'КМС';
      if (a.place <= 6) return 'I спортивный разряд';
      return a.place <= half ? 'II спортивный разряд' : 'III спортивный разряд';
    case 'cup_qualifier':
      if (a.place <= 3) return 'I спортивный разряд';
      return a.place <= half ? 'II спортивный разряд' : null;
    case 'junior_championship':
      if (a.place === 1) return 'I спортивный разряд';
      if (a.place <= 3) return 'II спортивный разряд';
      return a.place <= half ? 'I юношеский разряд' : 'II юношеский разряд';
    case 'regional_championship':
      if (a.place === 1) return 'II спортивный разряд';
      if (a.place <= 3) return 'III спортивный разряд';
      if (!junior) return null;
      return a.place <= half ? 'I юношеский разряд' : 'II юношеский разряд';
    case 'hackathon':
      return null;
  }
}

function buildRanks(ctx: Ctx): Rank[] {
  const { rng } = ctx;
  const ranks: Rank[] = [];
  const byAthlete = new Map<string, Achievement[]>();
  for (const a of ctx.achievements) byAthlete.set(a.fsp_id, [...(byAthlete.get(a.fsp_id) ?? []), a]);
  const orderSeq = new Map<number, number>();
  for (const athlete of ctx.athletes) {
    const list = (byAthlete.get(athlete.fsp_id) ?? []).sort((x, y) => x.date.localeCompare(y.date) || x.achievement_id.localeCompare(y.achievement_id));
    const current = new Map<DisciplineCode, RankName>();
    for (const a of list) {
      const implied = impliedRank(a, athlete);
      if (!implied) continue;
      const cur = current.get(a.discipline);
      if (cur && RANK_ORDER[cur] >= RANK_ORDER[implied]) continue;
      current.set(a.discipline, implied);
      const assigned_on = addDays(a.date, rng.int(20, 45));
      const year = Number(assigned_on.slice(0, 4));
      const seq = (orderSeq.get(year) ?? 0) + 1;
      orderSeq.set(year, seq);
      const years = implied === 'МС' ? null : implied === 'КМС' ? 3 : 2;
      ranks.push({
        rank_id: `RK-${year}-${pad(seq, 4)}`,
        fsp_id: athlete.fsp_id,
        discipline: a.discipline,
        rank: implied,
        order_no: `П-${year}-${pad(seq, 4)}`,
        assigned_on,
        valid_until: years ? `${year + years}${assigned_on.slice(4)}` : null,
        basis_achievement_id: a.achievement_id,
      });
    }
  }
  return ranks.sort((a, b) => a.assigned_on.localeCompare(b.assigned_on) || a.rank_id.localeCompare(b.rank_id));
}

function buildConsents(ctx: Ctx): Consent[] {
  const { rng } = ctx;
  const out: Consent[] = [];
  for (const a of ctx.athletes) {
    out.push({ fsp_id: a.fsp_id, client_id: 'fsp-career', scopes: [...CONSENT_SCOPES], granted_at: `2026-09-${pad(rng.int(1, 28))}T10:00:00+03:00` });
    if (rng.chance(0.2)) {
      out.push({ fsp_id: a.fsp_id, client_id: 'fsp-partner-demo', scopes: ['profile', 'achievements'], granted_at: `2026-09-${pad(rng.int(1, 28))}T12:00:00+03:00` });
    }
  }
  return out;
}

export function buildDataset(seed: number = DEFAULT_SEED): Dataset {
  const rng = new Rng(seed);
  const skill = new Map<string, number>();
  const ctx: Ctx = { rng, skill, athletes: [], teams: [], events: [], results: [], achievements: [], achievementSeq: new Map() };
  ctx.athletes = buildAthletes(rng, skill);
  buildEvents(ctx);
  const ranks = buildRanks(ctx);
  const consents = buildConsents(ctx);
  return {
    schema_version: 1,
    simulator: true,
    generated_at: GENERATED_AT,
    seed,
    disciplines: DISCIPLINES,
    regions: REGIONS.map(({ code, name, city }) => ({ code, name, city })),
    partners: PARTNERS,
    athletes: ctx.athletes,
    teams: ctx.teams,
    events: ctx.events,
    results: ctx.results,
    achievements: ctx.achievements,
    ranks,
    consents,
  };
}
