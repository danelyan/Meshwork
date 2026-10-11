import type { Registry } from './data.js';
import type { Athlete, Rank, Result } from './types.js';

/** Представления записей для ответов API: что и кому показывается. */

export function displayName(a: Athlete): string {
  const initials = [a.first_name, a.middle_name].filter(Boolean).map((n) => `${n[0]}.`);
  return [a.last_name, ...initials].join(' ');
}

export function fullName(a: Athlete): string {
  return [a.last_name, a.first_name, a.middle_name].filter(Boolean).join(' ');
}

const RANK_WEIGHT: Record<Rank['rank'], number> = {
  'II юношеский разряд': 0, 'I юношеский разряд': 1, 'III спортивный разряд': 2, 'II спортивный разряд': 3,
  'I спортивный разряд': 4, 'КМС': 5, 'МС': 6,
};

export function bestRank(ranks: Rank[]): Rank | null {
  return ranks.reduce<Rank | null>((best, r) => (!best || RANK_WEIGHT[r.rank] > RANK_WEIGHT[best.rank] ? r : best), null);
}

export function regionView(reg: Registry, code: string | null) {
  if (!code) return null;
  const r = reg.dataset.regions.find((x) => x.code === code);
  return r ? { code: r.code, name: r.name } : { code, name: null };
}

export function disciplineView(reg: Registry, code: string) {
  const d = reg.dataset.disciplines.find((x) => x.code === code);
  return d ? { code: d.code, name: d.name, entrant_type: d.entrant_type } : { code, name: null, entrant_type: null };
}

/** Полный профиль: сам спортсмен и партнёры с согласием на profile. */
export function athleteProfile(reg: Registry, a: Athlete) {
  const ranks = reg.ranksOf(a.fsp_id);
  return {
    fsp_id: a.fsp_id,
    last_name: a.last_name,
    first_name: a.first_name,
    middle_name: a.middle_name,
    full_name: fullName(a),
    display_name: displayName(a),
    birth_year: a.birth_year,
    region: regionView(reg, a.region_code),
    disciplines: a.disciplines.map((d) => disciplineView(reg, d)),
    member_since: a.member_since,
    status: a.status,
    best_rank: bestRank(ranks) ? { rank: bestRank(ranks)!.rank, discipline: bestRank(ranks)!.discipline } : null,
    achievements_total: reg.achievementsOf(a.fsp_id).length,
  };
}

/** Короткая карточка для поиска и протоколов (как в публичных протоколах: фамилия, инициалы, регион). */
export function athleteCard(reg: Registry, a: Athlete) {
  const best = bestRank(reg.ranksOf(a.fsp_id));
  return {
    fsp_id: a.fsp_id,
    display_name: displayName(a),
    region: regionView(reg, a.region_code),
    disciplines: a.disciplines,
    best_rank: best ? best.rank : null,
  };
}

export function resultView(reg: Registry, r: Result) {
  const entrant =
    r.entrant_type === 'team'
      ? (() => {
          const t = reg.teamsById.get(r.team_id!);
          return t
            ? {
                type: 'team' as const,
                team_id: t.team_id,
                name: t.name,
                region: regionView(reg, t.region_code),
                members: t.members.map((id) => {
                  const a = reg.athletesById.get(id);
                  return a ? { fsp_id: a.fsp_id, display_name: displayName(a) } : { fsp_id: id, display_name: null };
                }),
              }
            : { type: 'team' as const, team_id: r.team_id, name: null, region: null, members: [] };
        })()
      : (() => {
          const a = reg.athletesById.get(r.fsp_id!);
          return { type: 'individual' as const, fsp_id: r.fsp_id, display_name: a ? displayName(a) : null, region: a ? regionView(reg, a.region_code) : null };
        })();
  return {
    result_id: r.result_id,
    place: r.place,
    status: r.status,
    entrant,
    points: r.points,
    criteria_scores: r.criteria_scores,
    tasks_solved: r.tasks_solved,
    penalty: r.penalty,
  };
}

export function teamView(reg: Registry, teamId: string) {
  const t = reg.teamsById.get(teamId);
  if (!t) return null;
  const ev = reg.eventsById.get(t.event_id);
  const result = reg.resultsOf(t.event_id).find((r) => r.team_id === t.team_id) ?? null;
  return {
    team_id: t.team_id,
    name: t.name,
    region: regionView(reg, t.region_code),
    event: ev ? { event_id: ev.event_id, name: ev.name, discipline: ev.discipline, ends_on: ev.ends_on } : { event_id: t.event_id },
    captain_fsp_id: t.captain_fsp_id,
    members: t.members.map((id) => {
      const a = reg.athletesById.get(id);
      return a ? { fsp_id: a.fsp_id, display_name: displayName(a) } : { fsp_id: id, display_name: null };
    }),
    result: result ? { place: result.place, status: result.status, points: result.points, criteria_scores: result.criteria_scores } : null,
  };
}
