/**
 * Варианты вида головы компаньона — один GLB, разные материалы. Пять эскизов по ветке Данила
 * `codex/interactive-head` (HeadLab: «живой хром», «голограмма», «частицы», «волны», «нейросетка»)
 * перенесены на нашу сцену: наша сетка-металл по референсу брендбука остаётся основной, остальные —
 * для сравнения на `/design/avatar` и для питча. Челюсть по звуку работает во всех вариантах.
 */
export type HeadStyle = 'metal' | 'grid' | 'weave' | 'brand' | 'loops' | 'chrome' | 'hologram' | 'particles' | 'wire';

export interface HeadStyleInfo {
  id: HeadStyle;
  label: string;
  hint: string;
}

export const HEAD_STYLES: readonly HeadStyleInfo[] = [
  { id: 'metal', label: 'Металл', hint: 'Первый вариант: светлый металл в тёмную клетку' },
  { id: 'grid', label: 'Сетка', hint: 'Референс брендбука ФСП: тёмная голова в светлых нитях по параллелям и меридианам' },
  { id: 'weave', label: 'Плетение', hint: 'Те же нити, но проекция по нормали — линии обтекают нос, губы и глазницы' },
  {
    id: 'brand',
    label: 'Плетение 2',
    hint: 'Ближе к брендбуку: нити идут по форме лица — кольцами вокруг глаз и рта, на черепе параллелями и меридианами',
  },
  { id: 'loops', label: 'Петли', hint: 'Как на оригинале: на черепе параллели, вокруг глаз и рта — кольца и спицы' },
  { id: 'chrome', label: 'Живой хром', hint: 'Полированный металл, блики бегут по лицу' },
  { id: 'hologram', label: 'Голограмма', hint: 'Сканирующая полоса и строчная развёртка в синем' },
  { id: 'particles', label: 'Частицы', hint: 'Облако светящихся точек по форме головы' },
  { id: 'wire', label: 'Нейросетка', hint: 'Треугольная сетка, загорается от речи' },
] as const;

export const DEFAULT_HEAD_STYLE: HeadStyle = 'weave';

/** Числовой код стиля для шейдера (`uStyle`), порядок — как в `HEAD_STYLES`. */
export function styleIndex(style: HeadStyle): number {
  return HEAD_STYLES.findIndex((s) => s.id === style);
}

export function isHeadStyle(value: unknown): value is HeadStyle {
  return typeof value === 'string' && HEAD_STYLES.some((s) => s.id === value);
}

/** Выбор пользователя (ПКМ по голове в чате) — в localStorage этого браузера. */
export const HEAD_STYLE_KEY = 'fsp.avatar.style';

export function loadHeadStyle(): HeadStyle {
  try {
    const v = window.localStorage.getItem(HEAD_STYLE_KEY);
    return isHeadStyle(v) ? v : DEFAULT_HEAD_STYLE;
  } catch {
    return DEFAULT_HEAD_STYLE;
  }
}

export function saveHeadStyle(style: HeadStyle): void {
  try {
    window.localStorage.setItem(HEAD_STYLE_KEY, style);
  } catch {
    // приватный режим — выбор живёт до перезагрузки
  }
}
