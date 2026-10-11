<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: retention и воронка с проверками качества (ai.bi-analytics, middle)

Модуль `retention.py` в корне репозитория. Окружение: Python 3.12, `pandas` 2.3.3, `numpy` 2.3.3, `pytest`; сеть недоступна.
Входной `DataFrame` функциям не изменяется. Время суток важно только для порядка событий внутри воронки.

```python
def check_events(events: pd.DataFrame, as_of: str) -> tuple[pd.DataFrame, dict]: ...
def weekly_retention(events: pd.DataFrame, as_of: str, weeks: int = 4) -> pd.DataFrame: ...
def funnel(events: pd.DataFrame, as_of: str, steps=("signup", "activate", "purchase"), window_days: int = 7) -> pd.DataFrame: ...
```

`events`: колонки `user_id`, `event`, `ts` (`YYYY-MM-DD` или `YYYY-MM-DD HH:MM:SS`). Лишние колонки игнорируются.
Нет колонки → `ValueError("missing column: <имя>")` (в порядке перечисления). `as_of` — дата `YYYY-MM-DD`
(иначе `ValueError("bad as_of")`); события строго позже конца дня `as_of` — «из будущего».

## `check_events` — очистка и отчёт о качестве

Шаги по порядку; строка попадает в первую подходящую категорию:

1. `no_user` — `user_id` пропущен или пуст после обрезки пробелов (идентификатор приводится к строке).
2. `bad_ts` — `ts` не разбирается (`pd.to_datetime(..., format="ISO8601", errors="coerce")`; даты и даты со временем могут быть в одном столбце).
3. `unknown_event` — `event` (приводится к нижнему регистру и обрезается) не из набора `signup`, `activate`, `purchase`, `visit`.
4. `future` — `ts` позже `as_of 23:59:59`.
5. `duplicates` — точный повтор тройки (`user_id`, `event`, `ts`) после нормализации; остаётся первая строка в файле.

Результат: `(clean, report)`. `clean` — колонки `user_id` (str), `event` (str), `ts` (`datetime64[ns]`), строки по
`ts`, затем `user_id`, затем `event`, индекс `0..n-1`. `report` — словарь: `rows_in`, `rows_out` и по одному целому на каждую
категорию выше (`no_user`, `bad_ts`, `unknown_event`, `future`, `duplicates`); `rows_in = rows_out + сумма категорий`.
Дополнительно `users_without_signup` — число пользователей в `clean`, у которых нет события `signup`, и
`signup_after_activity` — число пользователей, у которых самое раннее событие не `signup`, а `signup` позже
(порядок событий нарушен).

## `weekly_retention`

Сначала применяется `check_events`. Когорта пользователя — неделя (понедельник 00:00) его первого `signup`;
пользователи без `signup` в когорты не входят. Неделя `k` когорты — окно `[cohort_start + 7k дней, cohort_start + 7(k+1) дней)`.
Активность — любое событие из `clean` в окне.

Результат — `DataFrame` с колонками `cohort` (строка `YYYY-MM-DD` понедельника), `size`, `week_0 … week_<weeks>`; значения
`week_k` — доля пользователей когорты с активностью в неделе `k`, округлена до 4 знаков. Строки по возрастанию `cohort`,
индекс `0..n-1`.

Цензурирование справа: если начало окна `k` позже конца `as_of` (то есть `cohort_start + 7k дней > as_of`),
значение — `NaN` (данных ещё нет, это не ноль). Окно, в которое `as_of` попадает частично, считается наблюдаемым.
`week_0` содержит неделю регистрации (в ней есть `signup`), поэтому всегда `1.0`, если окно наблюдаемо.
`weeks` — целое ≥ 0, иначе `ValueError("bad weeks")`. Нет когорт — пустой `DataFrame` с теми же колонками.

## `funnel`

Сначала `check_events`. Для каждого пользователя цепочка строится жадно по самым ранним подходящим событиям:
`t0` — первый `steps[0]`; `t_i` — самое раннее событие `steps[i]` с `ts >= t_{i-1}`; все `t_i <= t0 + window_days` дней
(включительно). Пользователь «дошёл» до шага `i`, если цепочка до `i` построена. Пользователь без `steps[0]` в воронку не входит.

Результат — `DataFrame` с колонками `step`, `users`, `from_prev`, `from_start`: `users` — число дошедших;
`from_prev` — `users_i / users_{i-1}`, `from_start` — `users_i / users_0`, оба округлены до 4 знаков; для первого шага — `1.0`;
если делитель 0 — `0.0`. Строки в порядке `steps`, индекс `0..n-1`. `steps` — непустой набор из допустимых событий без повторов
(иначе `ValueError("bad steps")`), `window_days` — целое ≥ 0 (иначе `ValueError("bad window")`).

Видимые тесты — `tests/visible/` (`python -m pytest tests/visible`).
