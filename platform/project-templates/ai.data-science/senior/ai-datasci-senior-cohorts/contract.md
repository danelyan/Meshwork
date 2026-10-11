<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: когорты, LTV и CUPED (ai.data-science, senior)

Модуль `cohort.py` и файл `DESIGN.md` — в корне репозитория. Окружение: Python 3.12, `pandas` 2.3.3, `numpy` 2.3.3,
стандартная библиотека, `pytest`. `scipy` недоступен; сеть недоступна. Все формулы детерминированы. Входные
`DataFrame` не изменяются. Даты — строки `YYYY-MM-DD` (или `datetime64`); время суток не учитывается.

```python
def build_cohorts(users: pd.DataFrame, orders: pd.DataFrame, as_of: str, horizon: int = 3) -> pd.DataFrame
def cuped_adjust(y, x) -> dict
def ab_ltv(users: pd.DataFrame, orders: pd.DataFrame, exp_start: str,
           pre_days: int = 30, post_days: int = 30, alpha: float = 0.05) -> dict
```

Обозначения: `z(p) = NormalDist().inv_cdf(p)`; двустороннее p-value — `math.erfc(|z| / sqrt(2))`; дисперсия — выборочная
(`ddof=1`; при одном наблюдении — `0.0`). `users`: `user_id`, `signup_date`, `group` (`"control"`/`"treatment"`);
`orders`: `user_id`, `order_date`, `amount` (≥ 0). Заказы пользователей, которых нет в `users`, игнорируются.

## Проверка входа (`ValueError` с точным текстом, в этом порядке)
Нет колонки — `"missing column: <имя>"` (сначала `users`, затем `orders`, в порядке перечисления выше);
повтор `user_id` в `users` — `"duplicate user_id"`; дата не разбирается — `"bad date"`; `amount` пропущен или
отрицателен — `"bad amount"`; `group` вне допустимых — `"bad group"` (колонка `group` проверяется только в `ab_ltv`).
`horizon` не целое ≥ 0 — `"bad horizon"`; `pre_days`/`post_days` не целые ≥ 1 — `"bad window"`.

## `build_cohorts`
Когорта пользователя — месяц `signup_date` (`"YYYY-MM"`). Пользователи с `signup_date > as_of` не учитываются.
Учитываются только заказы с `signup_date <= order_date <= as_of`. Сдвиг заказа `k` = разность в календарных месяцах
между месяцем заказа и месяцем регистрации (`k = 0` — месяц регистрации).

Результат — `DataFrame` с `RangeIndex`, строки по возрастанию когорты, колонки по порядку:
`cohort`, `size`, `retention_0 … retention_<horizon>`, `ltv_0 … ltv_<horizon>`.

- `size` — число пользователей когорты.
- `retention_k` — доля пользователей когорты, сделавших хотя бы один заказ со сдвигом ровно `k`.
- `ltv_k` — накопленная выручка когорты по сдвигам `0..k`, делённая на `size`.
- Цензурирование справа: если `месяц(cohort) + k` позже месяца `as_of`, ячейки `retention_k` и `ltv_k` — `NaN`
  (данных за этот месяц ещё нет — это не ноль). Месяц `as_of` считается наблюдаемым.
- Нет пользователей — пустой `DataFrame` с теми же колонками.

## `cuped_adjust`
`y` — метрика, `x` — ковариата до эксперимента (последовательности одной длины ≥ 1, конечные числа; иначе
`ValueError("bad input")`). `theta = Σ(x - x̄)(y - ȳ) / Σ(x - x̄)²` (при нулевом знаменателе `theta = 0.0`),
скорректированная метрика `y_adj = y - theta · (x - x̄)`. Результат:
`{"theta": float, "adjusted": numpy.ndarray, "variance_reduction": float}`, где
`variance_reduction = 1 - var(y_adj) / var(y)` (`0.0`, если `var(y) == 0`).

## `ab_ltv`
Эксперимент стартует в `exp_start`. Для каждого пользователя из `users`:
`pre` — сумма заказов с датой в `[exp_start - pre_days, exp_start)`, `post` — сумма заказов в
`[exp_start, exp_start + post_days)` (границы по дням; пользователи без заказов дают `0.0`).
Метрика — `post`, ковариата — `pre`.

Результат: `{"n": {"control": int, "treatment": int}, "raw": R, "cuped": C, "theta": float, "variance_reduction": float}`.
`R` — сравнение групп по `post`, `C` — по `post`, скорректированному CUPED (`theta` оценивается по всем пользователям
обеих групп сразу, `x̄` — среднее `pre` по всем пользователям). Оба — словарь: `mean_control`, `mean_treatment`,
`diff = mean_treatment - mean_control`, `se = sqrt(vc/nc + vt/nt)`, `ci_low`/`ci_high = diff ∓ z(1 - alpha/2) · se`,
`z = diff / se` (при `se == 0` — `0.0` и `p_value = 1.0`), `p_value`, `significant = p_value < alpha`.
В какой-то группе нет пользователей — `ValueError("empty group")` (после проверки входа).

## `DESIGN.md`
Разделы `## Решения`, `## Компромиссы`, `## Границы применимости` — в каждом не меньше 200 символов: почему
ячейки без данных — `NaN`, а не 0; почему ковариата берётся строго до старта и что будет, если в неё попадёт
пост-период; когда CUPED не помогает или вредит (нет предпериода, новые пользователи, слабая корреляция);
как это считать на десятках миллионов заказов (SQL/Spark), и почему нельзя «подсматривать» в p-value до конца окна.

Видимые тесты — `tests/visible/` (`python -m pytest tests/visible`).
