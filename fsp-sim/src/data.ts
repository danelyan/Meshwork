import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { achievementChecksum } from './generator/build.js';
import { ApiError } from './http.js';
import type { Achievement, Athlete, Consent, Dataset, DisciplineCode, Event, EventKind, Partner, Rank, RankName, Result, ResultStatus, Team } from './types.js';
import { CONSENT_SCOPES, type ConsentScope } from './types.js';

/** Пределы песочницы: страница открыта всем, поэтому объём ручных правок ограничен. */
export const SANDBOX_LIMITS = {
  manual_athletes: 50,
  achievements_per_athlete: 40,
  ranks_per_athlete: 10,
  manual_events: 200,
} as const;

/** Номера ручных записей. Не сбрасываются вместе с данными: номер ФСП ID не должен достаться другому человеку. */
interface Counters {
  athlete: number;
  event: number;
  achievement: number;
  rank: number;
}

interface StateFile {
  state_version: 1;
  base_fingerprint: string;
  counters: Counters;
  modified: boolean;
  dataset: Dataset;
}

export interface AthleteInput {
  last_name: string;
  first_name: string;
  middle_name: string;
  sex: 'm' | 'f';
  birth_year: number;
  region_code: string;
  disciplines: DisciplineCode[];
}

export interface NewEventInput {
  name: string;
  discipline: DisciplineCode;
  kind: EventKind;
  date: string;
  entrants_total: number;
}

export interface AchievementInput {
  /** Существующее соревнование либо описание нового — ровно одно из двух. */
  event_id?: string;
  event?: NewEventInput;
  place: number | null;
  status: ResultStatus;
  team_name?: string;
}

export interface RankInput {
  discipline: DisciplineCode;
  rank: RankName;
  assigned_on: string;
}

const FIRST_MANUAL_ATHLETE = 20_000;
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const clone = <T>(v: T): T => structuredClone(v);

function fingerprint(base: Dataset): string {
  return createHash('sha256').update(JSON.stringify(base)).digest('hex');
}

/** Отпечаток записей без согласий: согласия меняет сам спортсмен, это не ручная правка реестра. */
function contentPrint(d: Dataset): string {
  return fingerprint({ ...d, consents: [] });
}

/**
 * Реестр в памяти: индексы по набору данных, согласия спортсменов и ручные правки песочницы стенда.
 * Исходный набор (`base`) не меняется — к нему возвращает `reset()`. Рабочая копия пишется в файл
 * состояния, если он задан; после смены исходного набора файл состояния отбрасывается.
 */
export class Registry {
  readonly athletesById = new Map<string, Athlete>();
  readonly eventsById = new Map<string, Event>();
  readonly teamsById = new Map<string, Team>();
  readonly partnersById = new Map<string, Partner>();
  readonly resultsByEvent = new Map<string, Result[]>();
  readonly achievementsById = new Map<string, Achievement>();
  readonly achievementsByAthlete = new Map<string, Achievement[]>();
  readonly ranksByAthlete = new Map<string, Rank[]>();
  private readonly consents = new Map<string, Map<string, Consent>>();
  private readonly base: Dataset;
  private readonly baseFingerprint: string;
  private readonly baseContent: string;
  private counters: Counters = { athlete: FIRST_MANUAL_ATHLETE, event: 0, achievement: 0, rank: 0 };
  private modified = false;
  dataset: Dataset;

  constructor(base: Dataset, private readonly stateFile: string | null = null) {
    this.base = base;
    this.baseFingerprint = fingerprint(base);
    this.baseContent = contentPrint(base);
    this.dataset = clone(base);
    const saved = this.readState();
    if (saved) {
      this.dataset = saved.dataset;
      this.counters = saved.counters;
      this.modified = saved.modified;
    }
    this.reindex();
    this.loadConsents();
  }

  static load(file: string, stateFile: string | null = null): Registry {
    const dataset = JSON.parse(readFileSync(file, 'utf8')) as Dataset;
    if (dataset.schema_version !== 1 || dataset.simulator !== true) throw new Error(`Неожиданный формат набора данных: ${file}`);
    return new Registry(dataset, stateFile);
  }

  private readState(): StateFile | null {
    if (!this.stateFile || !existsSync(this.stateFile)) return null;
    try {
      const saved = JSON.parse(readFileSync(this.stateFile, 'utf8')) as StateFile;
      return saved.state_version === 1 && saved.base_fingerprint === this.baseFingerprint ? saved : null;
    } catch {
      return null;
    }
  }

  private persist(): void {
    if (!this.stateFile) return;
    const state: StateFile = {
      state_version: 1,
      base_fingerprint: this.baseFingerprint,
      counters: this.counters,
      modified: this.modified,
      dataset: { ...this.dataset, consents: this.allConsents() },
    };
    mkdirSync(dirname(this.stateFile), { recursive: true });
    const tmp = `${this.stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, this.stateFile);
  }

  private reindex(): void {
    const d = this.dataset;
    for (const m of [this.athletesById, this.eventsById, this.teamsById, this.partnersById, this.resultsByEvent, this.achievementsById, this.achievementsByAthlete, this.ranksByAthlete]) m.clear();
    for (const a of d.athletes) this.athletesById.set(a.fsp_id, a);
    for (const e of d.events) this.eventsById.set(e.event_id, e);
    for (const t of d.teams) this.teamsById.set(t.team_id, t);
    for (const p of d.partners) this.partnersById.set(p.client_id, p);
    for (const r of d.results) this.resultsByEvent.set(r.event_id, [...(this.resultsByEvent.get(r.event_id) ?? []), r]);
    for (const a of d.achievements) {
      this.achievementsById.set(a.achievement_id, a);
      this.achievementsByAthlete.set(a.fsp_id, [...(this.achievementsByAthlete.get(a.fsp_id) ?? []), a]);
    }
    for (const r of d.ranks) this.ranksByAthlete.set(r.fsp_id, [...(this.ranksByAthlete.get(r.fsp_id) ?? []), r]);
  }

  private loadConsents(): void {
    this.consents.clear();
    for (const c of this.dataset.consents) this.setConsent(c);
  }

  private allConsents(): Consent[] {
    return [...this.consents.values()].flatMap((byClient) => [...byClient.values()]);
  }

  private commit(): void {
    // Создали и удалили — реестр снова равен исходному, пометка «изменён» не нужна.
    this.modified = contentPrint(this.dataset) !== this.baseContent;
    this.reindex();
    this.persist();
  }

  private setConsent(c: Consent) {
    const byClient = this.consents.get(c.fsp_id) ?? new Map<string, Consent>();
    byClient.set(c.client_id, c);
    this.consents.set(c.fsp_id, byClient);
  }

  consentsOf(fspId: string): Consent[] {
    return [...(this.consents.get(fspId)?.values() ?? [])];
  }

  hasConsent(fspId: string, clientId: string, scope: ConsentScope): boolean {
    const c = this.consents.get(fspId)?.get(clientId);
    return Boolean(c && c.scopes.includes(scope));
  }

  grantConsent(fspId: string, clientId: string, scopes: ConsentScope[], now: Date = new Date()): Consent {
    const unique = CONSENT_SCOPES.filter((s) => scopes.includes(s));
    const consent: Consent = { fsp_id: fspId, client_id: clientId, scopes: unique, granted_at: now.toISOString() };
    this.setConsent(consent);
    this.persist();
    return consent;
  }

  revokeConsent(fspId: string, clientId: string): boolean {
    const removed = this.consents.get(fspId)?.delete(clientId) ?? false;
    if (removed) this.persist();
    return removed;
  }

  /** Спортсмены, давшие клиенту согласие на профиль (для поиска партнёром). */
  athletesConsentedTo(clientId: string): Athlete[] {
    return this.dataset.athletes.filter((a) => this.hasConsent(a.fsp_id, clientId, 'profile'));
  }

  achievementsOf(fspId: string): Achievement[] {
    return [...(this.achievementsByAthlete.get(fspId) ?? [])].sort((a, b) => b.date.localeCompare(a.date) || a.achievement_id.localeCompare(b.achievement_id));
  }

  ranksOf(fspId: string): Rank[] {
    return [...(this.ranksByAthlete.get(fspId) ?? [])].sort((a, b) => b.assigned_on.localeCompare(a.assigned_on));
  }

  resultsOf(eventId: string): Result[] {
    return [...(this.resultsByEvent.get(eventId) ?? [])].sort((a, b) => (a.place ?? 1e9) - (b.place ?? 1e9) || a.result_id.localeCompare(b.result_id));
  }

  stats(): Record<string, number> {
    const d = this.dataset;
    return {
      athletes: d.athletes.length,
      events: d.events.length,
      teams: d.teams.length,
      results: d.results.length,
      achievements: d.achievements.length,
      ranks: d.ranks.length,
      partners: d.partners.length,
    };
  }

  // --- Песочница стенда: ручные правки ------------------------------------------------------

  /** Что изменено относительно исходного набора. */
  changes(): { modified: boolean; manual_athletes: number; removed_athletes: number; manual_achievements: number; manual_ranks: number } {
    const d = this.dataset;
    return {
      modified: this.modified,
      manual_athletes: d.athletes.filter((a) => a.manual).length,
      removed_athletes: this.base.athletes.filter((a) => !this.athletesById.has(a.fsp_id)).length,
      manual_achievements: d.achievements.filter((a) => a.manual).length,
      manual_ranks: d.ranks.filter((r) => r.manual).length,
    };
  }

  private requireAthlete(fspId: string): Athlete {
    const a = this.athletesById.get(fspId);
    if (!a) throw new ApiError(404, 'not_found', `Участника ${fspId} нет в реестре`);
    return a;
  }

  private requireRegion(code: string): void {
    if (!this.dataset.regions.some((r) => r.code === code)) throw new ApiError(400, 'validation', `region_code: региона ${code} нет в справочнике`);
  }

  /**
   * Готовит запись нового участника и резервирует номер ФСП ID, но в реестр не вносит: сначала для
   * него заводится пользователь ФСП ID, и только потом `insertAthlete`.
   */
  draftAthlete(input: AthleteInput, today: string): Athlete {
    if (this.dataset.athletes.filter((a) => a.manual).length >= SANDBOX_LIMITS.manual_athletes) {
      throw new ApiError(409, 'limit_reached', `На стенде не больше ${SANDBOX_LIMITS.manual_athletes} участников, добавленных вручную: удалите лишних или верните исходные данные`);
    }
    this.requireRegion(input.region_code);
    if (this.counters.athlete >= 99_999) throw new ApiError(409, 'limit_reached', 'Номера ФСП ID для ручных записей закончились');
    this.counters.athlete += 1;
    this.persist();
    const n = this.counters.athlete;
    return {
      fsp_id: `FSP-${n}`,
      ...input,
      disciplines: [...new Set(input.disciplines)],
      member_since: today,
      status: 'active',
      username: `fsp-${n}`,
      email: `fsp-${n}@example.com`,
      manual: true,
    };
  }

  insertAthlete(athlete: Athlete): Athlete {
    this.dataset.athletes.push(athlete);
    // Как и у остальных участников набора: согласие платформе команды дано сразу, партнёру — нет.
    this.setConsent({ fsp_id: athlete.fsp_id, client_id: 'fsp-career', scopes: [...CONSENT_SCOPES], granted_at: new Date().toISOString() });
    this.commit();
    return athlete;
  }

  /** Новая версия записи участника без записи в реестр (см. `draftAthlete`). */
  patchedAthlete(fspId: string, patch: Partial<AthleteInput>): Athlete {
    const current = this.requireAthlete(fspId);
    if (patch.region_code) this.requireRegion(patch.region_code);
    return { ...current, ...patch, disciplines: patch.disciplines ? [...new Set(patch.disciplines)] : current.disciplines };
  }

  replaceAthlete(next: Athlete): Athlete {
    const i = this.dataset.athletes.findIndex((a) => a.fsp_id === next.fsp_id);
    if (i < 0) throw new ApiError(404, 'not_found', `Участника ${next.fsp_id} нет в реестре`);
    this.dataset.athletes[i] = next;
    this.commit();
    return next;
  }

  /** Убирает участника, его достижения, разряды и согласия. Строки протоколов остаются: это история соревнования. */
  deleteAthlete(fspId: string): Athlete {
    const athlete = this.requireAthlete(fspId);
    const d = this.dataset;
    const events = new Set(d.achievements.filter((a) => a.fsp_id === fspId).map((a) => a.event_id));
    d.athletes = d.athletes.filter((a) => a.fsp_id !== fspId);
    d.achievements = d.achievements.filter((a) => a.fsp_id !== fspId);
    d.ranks = d.ranks.filter((r) => r.fsp_id !== fspId);
    this.consents.delete(fspId);
    for (const id of events) this.dropOrphanEvent(id);
    this.commit();
    return athlete;
  }

  /** Соревнование, заведённое вручную, живёт, пока на него ссылается хотя бы одна запись. */
  private dropOrphanEvent(eventId: string): void {
    const d = this.dataset;
    const ev = d.events.find((e) => e.event_id === eventId);
    if (ev?.manual && !d.achievements.some((a) => a.event_id === eventId)) d.events = d.events.filter((e) => e.event_id !== eventId);
  }

  private createEvent(input: NewEventInput): Event {
    const d = this.dataset;
    if (d.events.filter((e) => e.manual).length >= SANDBOX_LIMITS.manual_events) {
      throw new ApiError(409, 'limit_reached', 'На стенде слишком много соревнований, добавленных вручную: верните исходные данные');
    }
    const discipline = d.disciplines.find((x) => x.code === input.discipline)!;
    const season = Number(input.date.slice(0, 4));
    this.counters.event += 1;
    const event_id = `EV-${season}-M${pad(this.counters.event, 3)}`;
    const ev: Event = {
      event_id,
      name: input.name,
      discipline: input.discipline,
      kind: input.kind,
      level: input.kind === 'regional_championship' ? 'regional' : 'national',
      season,
      starts_on: input.date,
      ends_on: input.date,
      format: 'offline',
      region_code: null,
      city: null,
      organizer: 'Внесено вручную на стенде симулятора',
      regulation: { code: `РГ-${input.discipline.toUpperCase()}-${season}`, version: `${season}.1`, criteria: discipline.criteria },
      entrant_type: discipline.entrant_type,
      entrants_total: input.entrants_total,
      participants_total: input.entrants_total,
      protocol_url: `/api/v1/events/${event_id}/results`,
      manual: true,
    };
    d.events.push(ev);
    return ev;
  }

  addAchievement(fspId: string, input: AchievementInput, now: Date = new Date()): Achievement {
    const athlete = this.requireAthlete(fspId);
    const d = this.dataset;
    if (this.achievementsOf(fspId).length >= SANDBOX_LIMITS.achievements_per_athlete) {
      throw new ApiError(409, 'limit_reached', `У участника не больше ${SANDBOX_LIMITS.achievements_per_athlete} записей о достижениях`);
    }
    if (Boolean(input.event_id) === Boolean(input.event)) throw new ApiError(400, 'validation', 'Нужно одно из двух: event_id существующего соревнования или event с описанием нового');
    const existing = input.event_id ? this.eventsById.get(input.event_id) : undefined;
    if (input.event_id && !existing) throw new ApiError(404, 'not_found', `Соревнования ${input.event_id} нет в реестре`);
    const total = existing?.entrants_total ?? input.event!.entrants_total;
    const place = input.status === 'disqualified' ? null : input.place;
    if (place !== null && place > total) throw new ApiError(400, 'validation', `place: в соревновании ${total} участников, места ${place} нет`);
    if (existing && d.achievements.some((a) => a.fsp_id === fspId && a.event_id === existing.event_id)) {
      throw new ApiError(409, 'conflict', 'У участника уже есть запись об этом соревновании: удалите её, чтобы внести другую');
    }
    const ev = existing ?? this.createEvent(input.event!);
    // Баллы — как у строки протокола с тем же местом, если она есть: вручную их не вводят.
    const sameplace = place === null ? undefined : this.resultsOf(ev.event_id).find((r) => r.place === place);
    this.counters.achievement += 1;
    const team = ev.entrant_type === 'team';
    const base = {
      achievement_id: `ACH-${ev.season}-M${pad(this.counters.achievement, 3)}`,
      fsp_id: fspId,
      event_id: ev.event_id,
      place,
      points: sameplace?.points ?? 0,
    };
    const record: Achievement = {
      ...base,
      event_name: ev.name,
      discipline: ev.discipline,
      level: ev.level,
      kind: ev.kind,
      season: ev.season,
      date: ev.ends_on,
      entrant_type: ev.entrant_type,
      team_id: null,
      team_name: team ? input.team_name || `Команда ${athlete.last_name}` : null,
      status: input.status,
      entrants_total: ev.entrants_total,
      criteria_scores: sameplace?.criteria_scores ?? null,
      regulation: { code: ev.regulation.code, version: ev.regulation.version },
      verified: true,
      verified_at: now.toISOString(),
      protocol_url: ev.protocol_url,
      checksum: '',
      manual: true,
    };
    record.checksum = achievementChecksum(record);
    d.achievements.push(record);
    this.commit();
    return record;
  }

  deleteAchievement(id: string): Achievement {
    const a = this.achievementsById.get(id);
    if (!a) throw new ApiError(404, 'not_found', `Записи ${id} нет в реестре`);
    const d = this.dataset;
    d.achievements = d.achievements.filter((x) => x.achievement_id !== id);
    // Разряд, присвоенный по этой записи, остаётся, но основания у него больше нет.
    for (const r of d.ranks) if (r.basis_achievement_id === id) r.basis_achievement_id = null;
    this.dropOrphanEvent(a.event_id);
    this.commit();
    return a;
  }

  addRank(fspId: string, input: RankInput): Rank {
    this.requireAthlete(fspId);
    if (this.ranksOf(fspId).length >= SANDBOX_LIMITS.ranks_per_athlete) {
      throw new ApiError(409, 'limit_reached', `У участника не больше ${SANDBOX_LIMITS.ranks_per_athlete} записей о разрядах`);
    }
    const year = Number(input.assigned_on.slice(0, 4));
    // Срок действия — как в генераторе набора: МС бессрочно, КМС три года, остальные два.
    const years = input.rank === 'МС' ? null : input.rank === 'КМС' ? 3 : 2;
    this.counters.rank += 1;
    const rank: Rank = {
      rank_id: `RK-${year}-M${pad(this.counters.rank, 3)}`,
      fsp_id: fspId,
      discipline: input.discipline,
      rank: input.rank,
      order_no: `П-${year}-M${pad(this.counters.rank, 3)}`,
      assigned_on: input.assigned_on,
      valid_until: years ? `${year + years}${input.assigned_on.slice(4)}` : null,
      basis_achievement_id: null,
      manual: true,
    };
    this.dataset.ranks.push(rank);
    this.commit();
    return rank;
  }

  deleteRank(id: string): Rank {
    const r = this.dataset.ranks.find((x) => x.rank_id === id);
    if (!r) throw new ApiError(404, 'not_found', `Разряда ${id} нет в реестре`);
    this.dataset.ranks = this.dataset.ranks.filter((x) => x.rank_id !== id);
    this.commit();
    return r;
  }

  baseAthletes(): Athlete[] {
    return this.base.athletes;
  }

  /** Возврат к исходному набору. Счётчики номеров сохраняются. */
  reset(): void {
    this.dataset = clone(this.base);
    this.modified = false;
    this.reindex();
    this.loadConsents();
    this.persist();
  }
}
