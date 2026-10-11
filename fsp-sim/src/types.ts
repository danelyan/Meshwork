/**
 * Модель данных симулятора реестра ФСП. Это ПРЕДЛОЖЕНИЕ команды (docs/fsp-integration.md,
 * «Предлагаемый состав достижения»), а не описание существующего API ФСП: организатор API и схему
 * реестра не выдаёт намеренно. Все записи синтетические (generator/).
 */

export type DisciplineCode = 'product' | 'algorithmic' | 'infosec' | 'robotics' | 'drones';
export type EntrantType = 'team' | 'individual';
export type EventLevel = 'regional' | 'national';
export type EventKind =
  | 'championship'
  | 'cup_qualifier'
  | 'cup_final'
  | 'junior_championship'
  | 'regional_championship'
  | 'hackathon';
export type EventFormat = 'online' | 'offline' | 'hybrid';
export type ResultStatus = 'ranked' | 'disqualified';
export type RankName =
  | 'МС'
  | 'КМС'
  | 'I спортивный разряд'
  | 'II спортивный разряд'
  | 'III спортивный разряд'
  | 'I юношеский разряд'
  | 'II юношеский разряд';

export interface Discipline {
  code: DisciplineCode;
  name: string;
  short_name: string;
  entrant_type: EntrantType;
  description: string;
  /** Критерии протокола (есть у дисциплин с экспертной оценкой). */
  criteria: string[] | null;
}

export interface Region {
  code: string;
  name: string;
  city: string;
}

export interface Athlete {
  fsp_id: string;
  last_name: string;
  first_name: string;
  middle_name: string;
  sex: 'm' | 'f';
  birth_year: number;
  region_code: string;
  disciplines: DisciplineCode[];
  member_since: string;
  status: 'active';
  /** Логин и почта пользователя ФСП ID (Keycloak); почта – example.com, писем никто не получает. */
  username: string;
  email: string;
  /** Запись внесена вручную через песочницу стенда (а не генератором набора). */
  manual?: true;
}

export interface Team {
  team_id: string;
  name: string;
  event_id: string;
  region_code: string;
  captain_fsp_id: string;
  members: string[];
}

export interface Event {
  event_id: string;
  name: string;
  discipline: DisciplineCode;
  kind: EventKind;
  level: EventLevel;
  season: number;
  starts_on: string;
  ends_on: string;
  format: EventFormat;
  region_code: string | null;
  city: string | null;
  organizer: string;
  regulation: { code: string; version: string; criteria: string[] | null };
  entrant_type: EntrantType;
  entrants_total: number;
  participants_total: number;
  protocol_url: string;
  manual?: true;
}

export interface Result {
  result_id: string;
  event_id: string;
  place: number | null;
  status: ResultStatus;
  entrant_type: EntrantType;
  team_id: string | null;
  fsp_id: string | null;
  points: number;
  criteria_scores: number[] | null;
  tasks_solved: number | null;
  penalty: number | null;
}

export interface Achievement {
  achievement_id: string;
  fsp_id: string;
  event_id: string;
  event_name: string;
  discipline: DisciplineCode;
  level: EventLevel;
  kind: EventKind;
  season: number;
  date: string;
  entrant_type: EntrantType;
  team_id: string | null;
  team_name: string | null;
  place: number | null;
  status: ResultStatus;
  entrants_total: number;
  points: number;
  criteria_scores: number[] | null;
  regulation: { code: string; version: string };
  verified: true;
  verified_at: string;
  protocol_url: string;
  /** SHA-256 ключевых полей; контрольная сумма, не подпись. */
  checksum: string;
  manual?: true;
}

export interface Rank {
  rank_id: string;
  fsp_id: string;
  discipline: DisciplineCode;
  rank: RankName;
  order_no: string;
  assigned_on: string;
  valid_until: string | null;
  /** У разряда, внесённого вручную, основания в реестре нет. */
  basis_achievement_id: string | null;
  manual?: true;
}

export interface Partner {
  client_id: string;
  name: string;
  description: string;
}

export interface Consent {
  fsp_id: string;
  client_id: string;
  scopes: string[];
  granted_at: string;
}

export interface Dataset {
  schema_version: 1;
  simulator: true;
  generated_at: string;
  seed: number;
  disciplines: Discipline[];
  regions: Region[];
  partners: Partner[];
  athletes: Athlete[];
  teams: Team[];
  events: Event[];
  results: Result[];
  achievements: Achievement[];
  ranks: Rank[];
  consents: Consent[];
}

export const CONSENT_SCOPES = ['profile', 'achievements', 'ranks'] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export const DISCIPLINE_CODES = ['product', 'algorithmic', 'infosec', 'robotics', 'drones'] as const satisfies readonly DisciplineCode[];
export const EVENT_KINDS = ['championship', 'cup_qualifier', 'cup_final', 'junior_championship', 'regional_championship', 'hackathon'] as const satisfies readonly EventKind[];
export const RANK_NAMES = [
  'МС',
  'КМС',
  'I спортивный разряд',
  'II спортивный разряд',
  'III спортивный разряд',
  'I юношеский разряд',
  'II юношеский разряд',
] as const satisfies readonly RankName[];
