<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: очистка таблицы и сводка (ai.data-science, junior)

Модуль `eda.py` в корне репозитория. Окружение: Python 3.12, `pandas` 2.3.3, `numpy` 2.3.3, `pytest`; сеть недоступна.
Входной `DataFrame` функциям не изменяется (работайте с копией).

```python
def clean(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]: ...
def summarize(clean_df: pd.DataFrame) -> pd.DataFrame: ...
```

## Вход `clean`

Колонки (лишние игнорируются и в результат не попадают): `user_id`, `age`, `city`, `amount`, `signup_date`.
Значения «сырые»: числа могут быть строками, пропуски – `None`, `NaN`, пустая строка или строка из пробелов.
Нет обязательной колонки → `ValueError("missing column: <имя>")`.

## Шаги `clean` (строго по порядку)

1. **Идентификатор.** `user_id` приводится к строке и обрезается по краям. Пустой или пропущенный – строка удаляется
   (`dropped_no_id`).
2. **Типы.** `age` → число (`pd.to_numeric`, нечисловое = пропуск); значение вне `[0, 120]` тоже пропуск.
   `amount` → число; десятичная запятая допустима (`"1200,50"` = 1200.5), пробелы по краям обрезаются, нечисловое = пропуск.
   `signup_date` → `datetime64` (`YYYY-MM-DD`; нечитаемое = `NaT`).
   `city` → строка в нижнем регистре, обрезанная по краям; пустая = пропуск.
3. **Дубли по `user_id`.** Остаётся строка с самой поздней `signup_date` (`NaT` считается самой ранней);
   при равенстве – последняя в файле. Остальные удаляются (`duplicates_removed`).
4. **Пропуски.** Считаются после дублей и до заполнения: `missing = {"age", "city", "amount", "signup_date"}` (число пропусков
   в каждой колонке). Заполнение: `age` – медианой оставшихся известных значений (`age_median`; если известных нет – остаётся
   пропуск и `age_median = None`), `city` – строкой `"unknown"`. `amount` и `signup_date` не заполняются.
5. **Выбросы `amount`.** По непустым значениям (после дублей): `Q1`, `Q3` – `Series.quantile(0.25/0.75)` с линейной
   интерполяцией по умолчанию, `IQR = Q3 - Q1`, границы `[Q1 - 1.5·IQR, Q3 + 1.5·IQR]` (включительно – норма).
   Колонка `amount_outlier` (bool): `True` вне границ; для пропуска `amount` – `False`. Строки не удаляются.
   Если непустых значений нет: границ нет (`amount_bounds = None`), выбросов 0.

## Результат `clean`

`(cleaned, report)`.

- `cleaned` – колонки по порядку: `user_id` (str), `age` (float64), `city` (str), `amount` (float64),
  `signup_date` (datetime64[ns]), `amount_outlier` (bool). Строки отсортированы по `user_id` (как по строке),
  индекс – `0..n-1`.
- `report` – словарь с ключами `rows_in`, `dropped_no_id`, `duplicates_removed`, `rows_out`, `missing` (см. выше),
  `age_median`, `amount_bounds` (`[low, high]` или `None`), `outliers` (число `True`). `rows_in = len(df)`;
  `rows_in = dropped_no_id + duplicates_removed + rows_out`.

## `summarize(clean_df)`

Сводка по городам из результата `clean`: `DataFrame` с колонками `city`, `users` (число строк), `mean_age`
(среднее `age` без пропусков), `total_amount` (сумма `amount` без пропусков), `median_amount` (медиана `amount`
без пропусков), `outliers` (число `amount_outlier == True`). Числа округлены до 2 знаков; если значений нет –
`NaN` для средних/медианы и `0.0` для суммы. Порядок строк: по `total_amount` по убыванию, затем по `city`
по возрастанию; индекс `0..n-1`. Пустой вход – пустой `DataFrame` с теми же колонками.

Видимые тесты – `tests/visible/` (`python -m pytest tests/visible`).
