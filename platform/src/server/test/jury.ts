// Слой «только для жюри» над тестом: человеческий разбор индекса честности. Чистые функции без БД.
// Вызывается из service.ts только при JURY_INSIGHTS=true; без флага в ответах API этих данных нет.
import { integrityLabel, type PublicTestIntegrity } from '../employer/test-integrity-label';

import type { IntegrityCode, IntegrityIndex } from './integrity';
import type { JuryResult } from './types';

export const JURY_REASON_LABEL: Record<IntegrityCode, string> = {
  canary_hit: 'Попал в ловушку: ответ = ключ + сдвиг из скрытой строки (так отвечает нейросеть, получившая копию условия)',
  fast_correct_series: 'Серия верных ответов быстрее 10 % лимита времени',
  fast_correct_hard: 'Трудное задание решено верно слишком быстро',
  slow_correct_easy: 'Лёгкое задание решено верно, но дольше лимита',
  overtime: 'Превышен лимит времени (замечанием для работодателя не считается)',
  person_misfit: 'Рисунок ответов нетипичен для оценённого уровня (lz*)',
  tab_away: 'Много уходов со вкладки или долго вне её',
  paste: 'Вставка текста в поле ответа',
  copy: 'Копирование условия задания',
};

/** Разбор индекса для жюри. `employer` - метка, которую увидит работодатель; `issued` - категория выдана этой попыткой (иначе работодатель не видит ничего). */
export function juryResult(index: Pick<IntegrityIndex, 'level' | 'reasons' | 'flaggedItems' | 'lzStar' | 'notes'>, employer: PublicTestIntegrity | null, issued: boolean, candidateSees = 'ничего'): JuryResult {
  return {
    level: index.level,
    reasons: index.reasons.map((r) => ({
      code: r.code,
      label: JURY_REASON_LABEL[r.code] ?? r.code,
      detail: r.detail,
      ...(r.item !== undefined ? { item: r.item + 1 } : {}),
    })),
    flaggedItems: index.flaggedItems.map((i) => i + 1),
    lzStar: index.lzStar,
    notes: index.notes,
    candidateSees,
    employerSees: !issued ? 'ничего (категория этой попыткой не выдана)' : (integrityLabel(employer) ?? 'метки нет'),
  };
}
