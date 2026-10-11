<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: SLI/SLO и бюджет ошибок по журналу запросов (engineering.sre, junior)

Модуль `slo.py` в корне репозитория. Окружение: Python 3.12, только стандартная библиотека, без сети.
Проверка – pytest (тесты в стиле `unittest` тоже идут). Времени стены нет: все границы окон передаются аргументами.

## Событие

Запись журнала – словарь `{"ts": int, "status": int, "latency_ms": число}`: `ts` – секунды (целое), `status` – код ответа,
`latency_ms` – длительность (`int` или `float`, не меньше 0). Список событий может быть не отсортирован.
Событие без любого из трёх ключей, с нецелым `ts` или `status`, с отрицательной или нечисловой `latency_ms`
(`bool` числом не считается) → `ValueError`. Проверяются все события переданного списка, даже те, что вне диапазона.

Диапазон `[start, end)`: `start` включительно, `end` исключительно, `end > start`, иначе `ValueError`.
Событие учитывается, только если `start <= ts < end`.

## Функции

```python
def is_good(event: dict) -> bool
def availability(events: list[dict], start: int, end: int) -> float | None
def latency_sli(events: list[dict], start: int, end: int, threshold_ms: float) -> float | None
def percentile(values: list[float], p: float) -> float | None
def window_report(events: list[dict], start: int, end: int, window_s: int) -> list[dict]
def error_budget(events: list[dict], start: int, end: int, slo_target: float) -> dict
```

### `is_good`
Событие «хорошее», если `status < 500`. Ответы 4xx – ошибка клиента, бюджет не расходуют. 5xx – «плохое».

### `availability`
Доля хороших событий среди учтённых, число от 0 до 1. Нет учтённых событий → `None` (не 0 и не 1).

### `latency_sli`
Доля учтённых событий с `latency_ms <= threshold_ms` (граница входит). Считаются все учтённые события, независимо от
статуса. Нет учтённых → `None`. `threshold_ms <= 0` → `ValueError`.

### `percentile`
Метод ближайшего ранга: `n = len(values)`, `rank = ceil(p / 100 * n)`, результат – элемент отсортированного списка
с номером `rank` (нумерация с 1). Пустой список → `None`. `p` должно быть в `(0, 100]`, иначе `ValueError`.
Исходный список не меняется. Для `p = 95` и 20 значений результат – 19-е по возрастанию.

### `window_report`
Делит `[start, end)` на подряд идущие окна по `window_s` секунд (`window_s > 0`; если `(end - start)` не делится
на `window_s` нацело – `ValueError`). Возвращает список по числу окон, по порядку времени; каждый элемент:

```python
{"start": int, "end": int, "total": int, "good": int, "availability": float | None, "p95": float | None, "p99": float | None}
```

`p95` и `p99` – перцентили `latency_ms` событий окна (функция `percentile`). Пустое окно: `total = 0`, `good = 0`,
остальные три поля – `None`; окно в отчёте остаётся.

### `error_budget`
`slo_target` строго между 0 и 1 (например, `0.999`), иначе `ValueError`. Возвращает:

```python
{"total": int, "bad": int, "allowed_bad": float, "remaining": float, "consumed_ratio": float | None, "exhausted": bool}
```

- `total` – учтённых событий, `bad` – «плохих» среди них;
- `allowed_bad = round(total * (1 - slo_target), 9)` – сколько плохих допустимо;
- `remaining = round(allowed_bad - bad, 9)` – остаток бюджета в событиях, может быть отрицательным;
- `consumed_ratio = bad / allowed_bad`; при `total = 0` → `None`;
- `exhausted` – `True`, только если `bad > allowed_bad` (ровно на границе бюджет ещё не исчерпан); при `total = 0` → `False`.
