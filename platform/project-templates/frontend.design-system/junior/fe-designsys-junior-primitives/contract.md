<!-- PLATFORM-OWNED: файл платформы, правки кандидата при проверке игнорируются -->
# Контракт: базовые компоненты дизайн-системы (frontend.design-system, junior)

Модуль `src/ui.tsx` экспортирует компоненты `Button`, `Badge`, `TextField`. Окружение проверки: Node.js 20, jsdom,
React 19, Testing Library; без сети, свои зависимости не устанавливаются. Стили (CSS) не проверяются:
проверка идёт по ролям, доступным именам и атрибутам, как у скринридера и клавиатуры.

## `Button`

```ts
interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: 'primary' | 'secondary' | 'danger'; // по умолчанию 'primary'
  loading?: boolean;                             // по умолчанию false
  type?: 'button' | 'submit' | 'reset';          // по умолчанию 'button'
}
```

- Рендерит нативный `<button>` с `type` из пропса (по умолчанию `"button"`, чтобы не отправлять форму случайно).
  Доступное имя — `children`. Прочие атрибуты (`aria-label`, `id`, `onClick` …) передаются на `<button>`.
- Вариант выставляется атрибутом `data-variant="<variant>"`.
- `disabled`: у кнопки атрибут `disabled`, `onClick` не вызывается.
- `loading`: у кнопки `aria-busy="true"` и `aria-disabled="true"`, `onClick` **не вызывается**, но атрибута `disabled` нет
  (кнопка остаётся в порядке табуляции и не теряет фокус). Доступное имя не меняется. Индикатор загрузки, если он есть,
  скрыт от скринридера (`aria-hidden="true"`) и в доступное имя не попадает.
- Без `loading` атрибутов `aria-busy` и `aria-disabled` нет. Если заданы и `disabled`, и `loading` — работает `disabled`.

## `Badge`

```ts
interface BadgeProps {
  tone?: 'neutral' | 'success' | 'warning' | 'danger'; // по умолчанию 'neutral'
  count?: number;
  max?: number;        // по умолчанию 99
  hideZero?: boolean;  // по умолчанию false
  children?: React.ReactNode;
}
```

- Рендерит `<span>` с `data-tone="<tone>"`.
- Содержимое — `children`, если они переданы; иначе число из `count`. Если `count > max`, показывается `«<max>+»`
  (при `max=99` и `count=150` — `99+`). Отрицательное `count` показывается как `0`.
- `hideZero` вместе с `count`, равным нулю (или отрицательным), — компонент ничего не рендерит (`null`).
- Без `children` и `count` компонент ничего не рендерит.

## `TextField`

```ts
interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void; // получает строку, а не событие
  type?: 'text' | 'email' | 'password' | 'search'; // по умолчанию 'text'
  id?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}
```

- Контролируемое поле: `<label>` связан с `<input>` через `for`/`id` (если `id` не передан — генерируется уникальный,
  два поля на странице не конфликтуют). Доступное имя поля — `label`.
- `type` попадает в `<input type>`; `required` и `disabled` — в атрибуты `required` и `disabled`.
- `onChange` вызывается со значением поля при каждом вводе.
- `hint` — поясняющий текст под полем; `error` — текст ошибки в элементе с `role="alert"`. Оба элемента существуют, только
  если соответствующая строка непустая.
- Если есть `error`: у поля `aria-invalid="true"`; без `error` атрибута `aria-invalid` нет.
- `aria-describedby` поля содержит id существующих `hint` и `error` (в этом порядке, через пробел); если ни одного
  нет — атрибута нет. Описание поля для скринридера собирается из их текстов.

Видимые тесты — `tests/visible/` (`npx vitest run tests/visible`).
