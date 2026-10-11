import { readFileSync } from 'node:fs';

import type { Achievement, Athlete, Consent, Dataset, Event, Partner, Rank, Result, Team } from './types.js';
import { CONSENT_SCOPES, type ConsentScope } from './types.js';

/** Реестр в памяти: индексы по набору данных и изменяемые согласия спортсменов (сбрасываются при рестарте). */
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

  constructor(readonly dataset: Dataset) {
    for (const a of dataset.athletes) this.athletesById.set(a.fsp_id, a);
    for (const e of dataset.events) this.eventsById.set(e.event_id, e);
    for (const t of dataset.teams) this.teamsById.set(t.team_id, t);
    for (const p of dataset.partners) this.partnersById.set(p.client_id, p);
    for (const r of dataset.results) this.resultsByEvent.set(r.event_id, [...(this.resultsByEvent.get(r.event_id) ?? []), r]);
    for (const a of dataset.achievements) {
      this.achievementsById.set(a.achievement_id, a);
      this.achievementsByAthlete.set(a.fsp_id, [...(this.achievementsByAthlete.get(a.fsp_id) ?? []), a]);
    }
    for (const r of dataset.ranks) this.ranksByAthlete.set(r.fsp_id, [...(this.ranksByAthlete.get(r.fsp_id) ?? []), r]);
    for (const c of dataset.consents) this.setConsent(c);
  }

  static load(file: string): Registry {
    const dataset = JSON.parse(readFileSync(file, 'utf8')) as Dataset;
    if (dataset.schema_version !== 1 || dataset.simulator !== true) throw new Error(`Неожиданный формат набора данных: ${file}`);
    return new Registry(dataset);
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
    return consent;
  }

  revokeConsent(fspId: string, clientId: string): boolean {
    return this.consents.get(fspId)?.delete(clientId) ?? false;
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
}
