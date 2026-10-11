<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: виртуализация длинного списка (Middle)

React 19, TypeScript, без сторонних библиотек (react-window, react-virtual и т. п. использовать нельзя). Проверка — vitest и
Testing Library в jsdom. jsdom не считает layout, поэтому высоты и позиции никогда не измеряются: высота строки и высота окна
приходят пропсами, а прокрутка в тестах задаётся значением `scrollTop` контейнера и событием `scroll`.

## `src/windowing.ts`

```ts
export interface WindowInput { count: number; rowHeight: number; viewportHeight: number; scrollTop: number; overscan: number }
export interface WindowRange { start: number; end: number; totalHeight: number } // end — не включительно
export function computeWindow(input: WindowInput): WindowRange;
```

- `totalHeight = count * rowHeight`.
- `scrollTop` приводится к диапазону `[0, max(0, totalHeight - viewportHeight)]`.
- Видимые строки: от `first = floor(scrollTop / rowHeight)` до `lastExclusive = min(count, ceil((scrollTop + viewportHeight) / rowHeight))`.
- `start = max(0, first - overscan)`, `end = min(count, lastExclusive + overscan)`. При `count === 0` — `start = end = 0`, `totalHeight = 0`.
- `RangeError`, если `rowHeight <= 0`, `viewportHeight < 0`, `overscan < 0`, `count` не целое неотрицательное число.

## `src/VirtualList.tsx`

```ts
export interface VirtualListProps {
  count: number;
  rowHeight: number;          // px, > 0
  height: number;             // высота окна, px
  renderRow: (index: number) => ReactNode;
  overscan?: number;          // по умолчанию 3
  scrollToIndex?: number;
  label?: string;             // aria-label списка, по умолчанию «Список»
  onRangeChange?: (start: number, end: number) => void;
}
export function VirtualList(props: VirtualListProps): JSX.Element;
```

### Разметка
- Корень — прокручиваемый контейнер `role="list"` с `aria-label={label}`, инлайн-стили `height: {height}px`, `overflow: auto`.
- Первый (и единственный) дочерний элемент корня — распорка с инлайн `height: {totalHeight}px` и `position: relative`; в ней лежат строки.
- Строка: `role="listitem"`, `aria-posinset = index + 1`, `aria-setsize = count`, инлайн `position: absolute`, `top: {index * rowHeight}px`,
  `height: {rowHeight}px`. Содержимое строки — результат `renderRow(index)`.
- В DOM только строки окна `[start, end)` из `computeWindow` (по `scrollTop` контейнера, `height`, `rowHeight`, `overscan`); остальные
  индексы не создаются и `renderRow` для них не вызывается.

### Прокрутка и обновления
- Окно пересчитывается по событию `scroll` (значение `scrollTop` контейнера) и при смене `count`, `height`, `rowHeight`, `overscan`.
  Если после уменьшения `count` или `height` прокрутка вышла за допустимый предел, окно считается по приведённому значению.
- Строка с индексом, оставшимся в окне после прокрутки, не пересоздаётся: тот же DOM-элемент, локальное состояние сохраняется,
  `renderRow` для неё не вызывается заново. При сдвиге окна `renderRow` вызывается только для индексов, которых раньше в окне не было.
  Прокрутка внутри одного и того же окна `[start, end)` не вызывает ни `renderRow`, ни `onRangeChange`.
- Если родитель передал новую функцию `renderRow`, содержимое строк окна обновляется.
- `scrollToIndex`: при монтировании и при каждой **смене** значения контейнер прокручивается так, чтобы строка с этим индексом оказалась
  первой видимой (`scrollTop = index * rowHeight`, приведённый к допустимому диапазону; индекс вне `[0, count - 1]` приводится к нему)
  и окно пересчитывается. Повторный рендер с тем же значением не возвращает прокрутку назад.
- `onRangeChange(start, end)` вызывается после монтирования и далее — только когда изменился `start` или `end` отрисованного окна.

## Что не требуется
Строки переменной высоты, горизонтальная прокрутка, клавиатурная навигация и измерение размеров через `ResizeObserver`.
