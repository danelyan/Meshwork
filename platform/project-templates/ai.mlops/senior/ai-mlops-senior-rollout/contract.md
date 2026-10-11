<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: контроллер выкатки модели — теневой режим, канарейка, автооткат (Senior)

Python 3.12, только стандартная библиотека (`hashlib`, `json`, `statistics`, …). Модуль `rollout.py` в корне репозитория.
Контроллер решает одно: **продвигать новую версию модели дальше или откатить её** — по метрикам качества, которые
ему присылают. Он не поднимает серверы и не знает, как версии хранятся и раскладываются по хостам.
Реального времени и потоков нет: время приходит из инъектируемых часов `clock()` (возвращает секунды, `float`),
`time`/`datetime` модуль не использует. Все функции детерминированы.

## Функции

```python
def fingerprint(obj) -> str
def bucket(seed: int, request_id: str) -> int
```

- `fingerprint` — SHA-256 (hex, строчные) от UTF-8 байтов `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`.
  Порядок ключей на результат не влияет; `list` и `tuple` равны.
- `bucket` — `int(sha256(f"{seed}:{request_id}".encode()).hexdigest()[:8], 16) % 100`, число в `0..99`.

## Политика

```python
policy = {
    "stages": [5, 25, 50],        # доли трафика канарейки, %, целые, строго по возрастанию, каждая в 1..99
    "min_samples": 20,            # целое >= 1: наблюдений на каждую из двух версий в фазе, чтобы принять решение
    "hold_sec": 600,              # число >= 0: минимум секунд в фазе до продвижения
    "phase_timeout_sec": 3600,    # число > 0: сколько ждать недостающих наблюдений
    "rules": {
        "accuracy":   {"direction": "higher", "max_regression": 0.02, "limit": 0.80},
        "latency_ms": {"direction": "lower",  "max_regression": 15},
    },
}
```

Все ключи политики, кроме `limit` у правила, обязательны; лишний ключ (в политике или в правиле) — `ValueError`.
`direction` — `"higher"` (больше — лучше) или `"lower"` (меньше — лучше); `max_regression` — число `>= 0`;
`limit` (необязательный) — число. Пустые `stages` или `rules`, `bool` вместо числа, неверный тип — `ValueError`.
Политика копируется при создании: последующие изменения исходного словаря на контроллер не влияют.

## Класс `RolloutController`

```python
RolloutController(production: str, policy: dict, clock, seed: int = 0)
```

Состояния (`status()["state"]`): `"idle"` → `"shadow"` → `"canary"` → `"promoted"` или `"rolled_back"`.
`production` — версия, которая сейчас обслуживает трафик. Начальное состояние — `"idle"`.

### `start(candidate: str, data_hash: str | None = None) -> dict`
Допустим из `idle`, `promoted`, `rolled_back` (после завершения прошлой выкатки можно начать новую),
иначе `RuntimeError`. `candidate == production` — `ValueError`. Переводит в `"shadow"`, запоминает момент начала фазы
`clock()`, обнуляет наблюдения. Возвращает и сохраняет метаданные запуска:

```python
{"baseline": production, "candidate": candidate, "seed": seed,
 "config_hash": fingerprint(policy), "data_hash": data_hash,
 "run_id": fingerprint({"baseline": ..., "candidate": ..., "seed": ..., "config_hash": ..., "data_hash": ...})}
```

Одни и те же вход, политика и seed дают один и тот же `run_id`; любое отличие в этих полях — другой.

### `route(request_id: str) -> dict`
Результат `{"serve": версия, "shadow": версия | None}`:
- `shadow`: отвечает production, кандидат получает копию запроса — `{"serve": production, "shadow": candidate}`.
- `canary` со ступенью `pct`: `serve` = кандидат, если `bucket(seed, request_id) < pct`, иначе production; `shadow` = `None`.
  Один и тот же `request_id` в одной ступени всегда маршрутизируется одинаково; при росте ступени запрос,
  уже попавший к кандидату, остаётся у него.
- остальные состояния: `{"serve": production, "shadow": None}`.

### `observe(version: str, metrics: dict) -> None`
Записывает одно наблюдение в **текущую фазу**. Допустимо только в `shadow`/`canary` (иначе `RuntimeError`);
`version` — production или кандидат (иначе `ValueError`); `metrics` должен содержать все метрики из `rules`
(лишние допустимы и игнорируются), значения — конечные числа, не `bool` (иначе `ValueError`).
Наблюдения прошлой фазы в решении не участвуют.

### `evaluate() -> dict`
Допустим в `shadow`/`canary` (иначе `RuntimeError`). Применяет решение к состоянию и возвращает

```python
{"action": "wait" | "advance" | "promote" | "rollback", "reason": str, "state": str,
 "stage": int | None, "comparison": dict | None}
```

`stage` — текущая ступень канарейки (`None` в `shadow` и после завершения). Порядок проверок:

1. **Мало наблюдений.** Если у кандидата или у production в фазе меньше `min_samples` наблюдений:
   если `clock() - начало_фазы >= phase_timeout_sec` — откат (`"rollback"`, причина `"timeout"`), иначе
   `"wait"`, причина `"insufficient_samples"`. `comparison` — `None`.
2. **Метрики.** Для каждой метрики из `rules` (в алфавитном порядке) берутся средние по наблюдениям фазы.
   `regression` = `base − cand` при `direction == "higher"` и `cand − base` при `"lower"` (положительное число — кандидат хуже).
   Нарушение: `regression > max_regression + 1e-9`, либо задан `limit` и кандидат хуже предела: при `"higher"` среднее
   кандидата `< limit − 1e-9`, при `"lower"` — `> limit + 1e-9`. При первом нарушении — откат: причина
   `"regression:<метрика>"` (превышен `max_regression`) или `"limit:<метрика>"` (только предел). Откат срабатывает сразу,
   не дожидаясь `hold_sec`.
3. **Выдержка.** Нарушений нет, но `clock() - начало_фазы < hold_sec` — `"wait"`, причина `"hold"`.
4. **Продвижение.** Из `shadow` — на первую ступень канарейки; с ступени — на следующую (`"advance"`, причина `"ok"`,
   состояние `"canary"`, `stage` = новая ступень); с последней ступени — `"promote"`, причина `"ok"`, состояние `"promoted"`,
   кандидат становится production. Новая фаза начинается с `clock()` и с пустыми наблюдениями.

`comparison` (в пунктах 2–4) — `{метрика: {"candidate": среднее, "baseline": среднее, "regression": число, "breach": bool}}` по всем правилам.

### `rollback(reason: str = "manual") -> dict`
Допустим в `shadow`/`canary` (иначе `RuntimeError`). Состояние `"rolled_back"`, production прежний.
Возвращает `{"action": "rollback", "reason": f"manual:{reason}", "state": "rolled_back", "stage": None, "comparison": None}`.

### `status() -> dict`
`{"state", "production", "candidate" (None вне фаз shadow/canary и после завершения), "stage",
"samples": {"baseline": n, "candidate": n} (счётчики текущей фазы; нули вне фаз), "run": метаданные последнего start | None}`.
После `promoted` `production` — бывший кандидат; после `rolled_back` — прежний.

### `history() -> list[dict]`
Копия журнала событий по порядку, у каждого `"at": clock()` на момент события и `"event"`:
`"start"` (+ `candidate`, `run_id`), `"advance"` (+ `stage`), `"promote"` (+ `version`), `"rollback"` (+ `reason`).

## `DESIGN.md` (в корне репозитория)
Разделы `## Решения`, `## Компромиссы`, `## Границы применимости` — в каждом не меньше 200 символов:
почему сравнение по средним с порогами, а не статистический тест, и чем рискует малый `min_samples`; зачем теневой режим
перед канарейкой и что он не ловит; что откат по таймауту делает с редкими сегментами трафика; как воспроизвести запуск
по `run_id` и чего в него не попало; где контроллер перестанет работать (смещённые метрики, запаздывающие метки, много конкурирующих кандидатов).
