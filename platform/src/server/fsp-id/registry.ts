import { z } from 'zod';

import { fspRegistryLookup, type FspAchievement, type FspState } from '@/server/collector/fsp-demo';

/**
 * Достижения привязанного участника. Внешний провайдер – API реестра симулятора команды
 * (`GET <FSP_API_URL>/me/achievements` по токену участника, контракт – openapi.json симулятора);
 * мок – демо-реестр по `sub` (`fspRegistryLookup`). Сбой реестра – `unavailable`, без штрафа (R-FSP-03).
 */

export interface FspRegistryResult {
  state: Exclude<FspState, 'not_linked'>;
  achievements: FspAchievement[];
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_ITEMS = 50;

const DISCIPLINE: Record<string, string> = {
  product: 'продуктовое программирование',
  algorithmic: 'алгоритмическое программирование',
  infosec: 'информационная безопасность',
  robotics: 'программирование робототехники',
  drones: 'программирование беспилотных авиационных систем',
};

const Achievement = z.object({
  event_name: z.string().min(1).max(300),
  discipline: z.string().max(40).optional(),
  season: z.number().int().optional(),
  date: z.string().max(40).optional(),
  entrant_type: z.string().max(20).optional(),
  team_name: z.string().max(200).nullish(),
  place: z.number().int().nullish(),
  status: z.string().max(20).optional(),
  entrants_total: z.number().int().optional(),
});
const Page = z.object({ data: z.array(z.unknown()) });

type RawAchievement = z.infer<typeof Achievement>;

/** Запись реестра → форма `FspAchievement`, которую читают онбординг и ранжирование. Роль в команде реестр не знает. */
export function mapAchievement(a: RawAchievement): FspAchievement {
  const discipline = a.discipline ? DISCIPLINE[a.discipline] : undefined;
  const event = discipline && !a.event_name.toLowerCase().includes(discipline) ? `${a.event_name}, дисциплина «${discipline}»` : a.event_name;
  const year = a.season ?? (a.date ? Number(a.date.slice(0, 4)) || 0 : 0);
  const of = a.entrants_total ? ` из ${a.entrants_total}` : '';
  const result = a.status === 'disqualified' ? 'дисквалификация' : a.place ? `${a.place} место${of}` : 'участник';
  const role = a.entrant_type === 'individual' ? 'личный зачёт' : a.team_name ? `участник команды «${a.team_name}»` : 'участник команды';
  return { event, year, result, role };
}

export async function fetchRegistryAchievements(apiUrl: string, accessToken: string): Promise<FspRegistryResult> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/me/achievements?per_page=${MAX_ITEMS}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { state: 'unavailable', achievements: [] };
  }
  if (!res.ok) return { state: 'unavailable', achievements: [] };
  const page = Page.safeParse(await res.json().catch(() => null));
  if (!page.success) return { state: 'unavailable', achievements: [] };
  const achievements = page.data.data
    .slice(0, MAX_ITEMS)
    .flatMap((raw) => {
      const a = Achievement.safeParse(raw);
      return a.success ? [mapAchievement(a.data)] : [];
    });
  return achievements.length ? { state: 'linked', achievements } : { state: 'no_achievements', achievements: [] };
}

/** Внешний провайдер с API реестра – HTTP; иначе (мок или реестр не настроен) – демо-реестр по `sub`. */
export async function registryFor(sub: string, opts: { apiUrl: string | null; accessToken: string | null }): Promise<FspRegistryResult> {
  if (opts.apiUrl && opts.accessToken) return fetchRegistryAchievements(opts.apiUrl, opts.accessToken);
  return fspRegistryLookup(sub);
}
