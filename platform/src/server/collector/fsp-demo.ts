import { buildDoc } from './doc';
import type { ExtractedDoc } from './types';

/**
 * ФСП – ДЕМОНСТРАЦИОННЫЙ источник: API и схемы реестра ФСП не даны (CLAUDE.md п. 4,
 *, модель достижений – наше предложение. Четыре состояния:
 * `not_linked | no_achievements | unavailable | linked`. Без ФСП – без штрафа (R-FSP-03).
 * Каждая строка и meta явно помечены «демонстрационные».
 */
export type FspState = 'not_linked' | 'no_achievements' | 'unavailable' | 'linked';

export interface FspAchievement {
  event: string;
  year: number;
  result: string;
  role: string;
}

/**
 * Демо-достижения. Форматы соревнований и дисциплины – общеизвестные (Кубок и чемпионаты России,
 * чемпионаты федеральных округов, региональные этапы; дисциплины спортивного программирования из ЕКП),
 * а места, роли и люди – выдуманные демо-данные, не выгрузка реестра ФСП.
 * Форма записи `FspAchievement` не меняется (её читают онбординг и ранжирование).
 */
const DEMO_ACHIEVEMENTS: FspAchievement[] = [
  { event: 'Кубок России по спортивному программированию, дисциплина «продуктовое программирование», финал', year: 2025, result: 'призёр, 2 место', role: 'backend' },
  { event: 'Чемпионат России по спортивному программированию, дисциплина «алгоритмическое программирование»', year: 2025, result: 'участник финала, 41 место', role: 'участник команды' },
  { event: 'Чемпионат Приволжского федерального округа по спортивному программированию, дисциплина «программирование систем искусственного интеллекта»', year: 2024, result: 'победитель', role: 'ML-инженер' },
  { event: 'Чемпионат Сибирского федерального округа по спортивному программированию, дисциплина «информационная безопасность»', year: 2024, result: 'призёр, 3 место', role: 'участник команды' },
  { event: 'Региональный этап Кубка России по спортивному программированию, дисциплина «программирование робототехники»', year: 2024, result: 'участник, 12 место из 58', role: 'embedded-разработчик' },
  { event: 'Чемпионат Северо-Западного федерального округа по спортивному программированию, дисциплина «программирование беспилотных авиационных систем»', year: 2025, result: 'финалист', role: 'тимлид' },
];

/**
 * Демо-участники мока ФСП ID (`server/fsp-id/provider.ts`): `sub` из ID-токена → что вернёт демо-реестр.
 * Три состояния привязки для показа жюри: с достижениями, без истории, реестр недоступен.
 * Имена – условные, это не реальные люди.
 */
export interface FspDemoParticipant {
  sub: string;
  name: string;
  /** Что отвечает демо-реестр достижений по этому участнику. */
  registry: Exclude<FspState, 'not_linked'>;
  /** Подпись на странице входа мока. */
  label: string;
  achievements: FspAchievement[];
}

export const FSP_DEMO_PARTICIPANTS: readonly FspDemoParticipant[] = [
  {
    sub: '5b1f6c2e-7a3d-4e1b-9c41-0f3a2d7e9a01',
    name: 'Участник А (демо)',
    registry: 'linked',
    label: 'С достижениями: Кубок России, чемпионат ПФО, региональный этап',
    achievements: [DEMO_ACHIEVEMENTS[0]!, DEMO_ACHIEVEMENTS[2]!, DEMO_ACHIEVEMENTS[4]!],
  },
  {
    sub: '8e4a0d93-2c6b-4f7e-a1d5-3b9c6e2f4a02',
    name: 'Участник Б (демо)',
    registry: 'no_achievements',
    label: 'ФСП ID есть, истории соревнований нет',
    achievements: [],
  },
  {
    sub: 'c7d29e14-5f8a-4b3c-8e6d-1a4f7b0c5a03',
    name: 'Участник В (демо)',
    registry: 'unavailable',
    label: 'Вход проходит, реестр достижений не отвечает',
    achievements: [],
  },
];

export function fspDemoParticipant(sub: string): FspDemoParticipant | null {
  return FSP_DEMO_PARTICIPANTS.find((p) => p.sub === sub) ?? null;
}

/**
 * Ответ демо-реестра по `sub` из проверенного ID-токена. Неизвестный участник – привязан, но без
 * записей (вход в ФСП ID есть, истории нет). В проде здесь будет HTTP-адаптер реестра.
 */
export function fspRegistryLookup(sub: string): { state: Exclude<FspState, 'not_linked'>; achievements: FspAchievement[] } {
  const p = fspDemoParticipant(sub);
  if (!p) return { state: 'no_achievements', achievements: [] };
  return { state: p.registry, achievements: p.registry === 'linked' ? p.achievements : [] };
}

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

/**
 * Снимок источника ФСП. `subject` – `sub` участника, привязанного через ФСП ID (OIDC): тогда ключ –
 * он, достижения – из демо-реестра этого участника, а в meta – `fspSubject`/`fspName`. Без `subject` –
 * прежнее поведение (детерминированный демо-набор по ключу, для демо-кандидатов из сида).
 * `subject.achievements` – уже полученные записи (из снимка привязки), иначе – демо-реестр по `sub`.
 */
export function fspDemoDoc(key: string, state: FspState, subject?: { sub: string; name?: string; achievements?: FspAchievement[]; via?: string }): ExtractedDoc {
  const p = `fsp:${subject?.sub ?? key}`;
  const base = { sourceKind: 'fsp' as const, title: 'ФСП (демонстрационный источник)', origin: p };
  const meta = {
    demo: true,
    fspState: state,
    ownershipVerified: state === 'linked' || state === 'no_achievements',
    ...(subject ? { fspSubject: subject.sub, fspName: subject.name ?? null, linkedVia: subject.via ?? 'fsp-id-oidc' } : {}),
  };
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
      const items = subject ? (subject.achievements ?? fspRegistryLookup(subject.sub).achievements) : demoAchievements(key);
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
