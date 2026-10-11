/** Страницы для жюри: один список для /demo и других мест (лендинг, подвал). Пути других лейнов (/mechanics, /simulator, /expert) - только ссылки. */
export interface JuryPage { href: string; title: string; text: string; criterion: string }

export const JURY_HOME = '/demo';

export const JURY_PAGES: JuryPage[] = [
  { href: '/validation', title: 'Валидация', text: 'Цифры теста и подбора с оговорками и командами, которыми их можно повторить.', criterion: 'Тест и валидация · 25 %' },
  { href: '/evaluate', title: 'Проверить подбор', text: 'Прогнать наше ранжирование на своём наборе вакансий и кандидатов: P@k, nDCG, MRR рядом с базовой линией.', criterion: 'Подбор · 35 %' },
  { href: '/mechanics', title: 'Лаборатория заданий', text: 'Варианты заданий теста и как они различают грейды.', criterion: 'Тест и валидация · 25 %' },
  { href: '/simulator', title: 'Симулятор теста', text: 'Адаптивный тест на заданных «кандидатах»: как выбираются задания и как сходится грейд.', criterion: 'Тест и валидация · 25 %' },
  { href: '/expert', title: 'Пройти тест самому', text: 'Настоящий тест без регистрации. Грейд нигде не сохраняется.', criterion: 'Тест и валидация · 25 %' },
];

/** Подсказка к оранжевому: этим цветом помечено всё, что есть только в демо-режиме (DEMO_LOGIN). */
export const JURY_HINT =
  'Оранжевым отмечено всё, что сделано только для демонстрации жюри: демо-входы, расчёты, симулятор, режим эксперта. Вне демо-режима это скрыто.';

/** Хаб жюри или одна из его страниц — подсветка кнопки «Для жюри» в шапке. */
export function isJuryPath(pathname: string): boolean {
  return [JURY_HOME, ...JURY_PAGES.map((p) => p.href)].some((h) => pathname === h || pathname.startsWith(`${h}/`));
}
