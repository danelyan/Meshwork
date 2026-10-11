/**
 * Варианты вида головы компаньона – один GLB, разные материалы. Пять эскизов по ветке Данила
 * `codex/interactive-head` (HeadLab: «живой хром», «голограмма», «частицы», «волны», «нейросетка»)
 * перенесены на нашу сцену: наша сетка-металл по референсу брендбука остаётся основной, остальные –
 * для сравнения на `/design/avatar` и для питча. Челюсть по звуку работает во всех вариантах.
 */
export type HeadStyle = 'metal' | 'grid' | 'weave' | 'weave2' | 'weave3' | 'weave4' | 'weave5' | 'weave6' | 'weave7' | 'weave8' | 'weave9' | 'brand' | 'loops' | 'chrome' | 'hologram' | 'particles' | 'wire';

export interface HeadStyleInfo {
  id: HeadStyle;
  label: string;
  hint: string;
}

export const HEAD_STYLES: readonly HeadStyleInfo[] = [
  { id: 'metal', label: 'Металл', hint: 'Первый вариант: светлый металл в тёмную клетку' },
  { id: 'grid', label: 'Сетка', hint: 'Референс брендбука ФСП: тёмная голова в светлых нитях по параллелям и меридианам' },
  { id: 'weave', label: 'Плетение', hint: 'Основное: трипланарная клетка по нормали – серебристая ткань, нити обтекают нос, губы и глазницы' },
  {
    id: 'weave2',
    label: 'Плетение 2',
    hint: 'Кольца в ткани: нити по чертам, как на брендбуке (кольца у глаз, рта с носогубкой, носа и ушей, параллели на черепе), тонкие и частые, мягкий серый контраст, плавный переток в сетку',
  },
  {
    id: 'weave3',
    label: 'Плетение 3',
    hint: 'Обтекание: ровно «Плетение» по материалу, но клетка локально повёрнута по чертам и обтекает глаза, рот, нос и уши',
  },
  {
    id: 'weave4',
    label: 'Плетение 4',
    hint: 'Обтекание, тонкое: как «Плетение 3», но нити тоньше и чаще, основа светлее – мягкий контраст',
  },
  {
    id: 'weave5',
    label: 'Плетение 5',
    hint: 'Ретопология: нити – петли вокруг глаз, рта и ушей и спицы к ним, по расстоянию вдоль поверхности (как edge-loops на брендбуке); толстая серебристая нить, тёмные матовые ячейки, гладкие глаза',
  },
  {
    id: 'weave6',
    label: 'Плетение 6',
    hint: 'Проволока: топология «Плетения 3», но каждая нить – круглая проволока со своим бликом, между нитями тёмная матовая основа',
  },
  {
    id: 'weave7',
    label: 'Плетение 7',
    hint: 'Кубосфера: клетка из центра черепа с жёсткими швами-диагоналями (патчи черепа как на брендбуке), шея – цилиндр, лицо обтекает черты',
  },
  {
    id: 'weave8',
    label: 'Плетение 8',
    hint: 'Двойная нить: петли и спицы «Плетения 5», каждая 4-я нить – толстая проволока с бликом, между ними тонкая плоская ткань',
  },
  {
    id: 'weave9',
    label: 'Плетение 9',
    hint: 'Проволока на линиях ретопологии',
  },
  {
    id: 'brand',
    label: 'Кольца (черновик)',
    hint: 'Бывшее «Плетение 2»: нити по форме лица – кольцами вокруг глаз и рта, на черепе параллелями и меридианами; белое по чёрному',
  },
  { id: 'loops', label: 'Петли', hint: 'Как на оригинале: на черепе параллели, вокруг глаз и рта – кольца и спицы' },
  { id: 'chrome', label: 'Живой хром', hint: 'Полированный металл, блики бегут по лицу' },
  { id: 'hologram', label: 'Голограмма', hint: 'Сканирующая полоса и строчная развёртка в синем' },
  { id: 'particles', label: 'Частицы', hint: 'Облако светящихся точек по форме головы' },
  { id: 'wire', label: 'Нейросетка', hint: 'Треугольная сетка, загорается от речи' },
] as const;

/** Решение владельца 10.10: «Плетение 6» ближе всего к брендбуку. */
export const DEFAULT_HEAD_STYLE: HeadStyle = 'weave6';

/** Числовой код стиля для шейдера (`uStyle`), порядок – как в `HEAD_STYLES`. */
export function styleIndex(style: HeadStyle): number {
  return HEAD_STYLES.findIndex((s) => s.id === style);
}

export function isHeadStyle(value: unknown): value is HeadStyle {
  return typeof value === 'string' && HEAD_STYLES.some((s) => s.id === value);
}

/** Выбор пользователя (ПКМ по голове в чате) – в localStorage этого браузера. */
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
    // приватный режим – выбор живёт до перезагрузки
  }
}
