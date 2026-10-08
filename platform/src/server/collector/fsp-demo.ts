import { buildDoc } from './doc';
import type { ExtractedDoc } from './types';

/**
 * ФСП — ДЕМОНСТРАЦИОННЫЙ источник: API и схемы реестра ФСП не даны (CLAUDE.md п. 4,
 * research/09), модель достижений — наше предложение. Четыре состояния:
 * `not_linked | no_achievements | unavailable | linked`. Без ФСП — без штрафа (R-FSP-03).
 * Каждая строка и meta явно помечены «демонстрационные».
 */
export type FspState = 'not_linked' | 'no_achievements' | 'unavailable' | 'linked';

export interface FspAchievement {
  event: string;
  year: number;
  result: string;
  role: string;
}

const DEMO_ACHIEVEMENTS: FspAchievement[] = [
  { event: 'Всероссийские соревнования по спортивному программированию (продуктовое программирование)', year: 2025, result: 'призёр, 2 место', role: 'backend' },
  { event: 'Кубок России по спортивному программированию (продуктовое программирование), отборочный этап', year: 2025, result: 'финалист', role: 'frontend' },
  { event: 'Чемпионат региона по спортивному программированию (алгоритмическое программирование)', year: 2024, result: 'участник, 37 место из 212', role: 'участник команды' },
  { event: 'Всероссийский хакатон ФСП', year: 2024, result: 'победитель трека', role: 'тимлид, backend' },
];

/** Демо-хэндлы без кандидата в БД (для тестов и показа состояний). */
export const FSP_DEMO_HANDLES: Record<string, FspState> = {
  'demo-linked': 'linked',
  'demo-no-achievements': 'no_achievements',
  'demo-unavailable': 'unavailable',
  'demo-not-linked': 'not_linked',
};

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** Детерминированный набор из 1–3 демо-достижений по ключу. */
export function demoAchievements(key: string): FspAchievement[] {
  const h = hash(key);
  const n = 1 + (h % 3);
  return Array.from({ length: n }, (_, i) => DEMO_ACHIEVEMENTS[(h + i) % DEMO_ACHIEVEMENTS.length]!);
}

const DEMO_MARK = '(демонстрационные данные)';

export function fspDemoDoc(key: string, state: FspState): ExtractedDoc {
  const p = `fsp:${key}`;
  const base = { sourceKind: 'fsp' as const, title: 'ФСП (демонстрационный источник)', origin: p };
  const meta = { demo: true, fspState: state, ownershipVerified: state === 'linked' || state === 'no_achievements' };
  switch (state) {
    case 'not_linked':
      return buildDoc({
        ...base,
        lines: [{ ref: `${p}#state:l1`, text: 'Аккаунт ФСП не привязан. На подбор это не влияет.' }],
        meta,
      });
    case 'no_achievements':
      return buildDoc({
        ...base,
        lines: [{ ref: `${p}#state:l1`, text: `Аккаунт ФСП привязан, достижений пока нет ${DEMO_MARK}. На подбор это не влияет.` }],
        meta,
      });
    case 'unavailable':
      return buildDoc({
        ...base,
        lines: [{ ref: `${p}#state:l1`, text: 'Реестр ФСП сейчас недоступен; профиль собран без него. На подбор это не влияет.' }],
        meta,
      });
    case 'linked': {
      const items = demoAchievements(key);
      return buildDoc({
        ...base,
        lines: [
          { ref: `${p}#state:l1`, text: `Аккаунт ФСП привязан ${DEMO_MARK}` },
          ...items.map((a, i) => ({
            ref: `${p}#achievements:l${i + 1}`,
            text: `${a.event}, ${a.year}: ${a.result}; роль: ${a.role} ${DEMO_MARK}`,
          })),
        ],
        meta: { ...meta, achievements: items },
      });
    }
  }
}
