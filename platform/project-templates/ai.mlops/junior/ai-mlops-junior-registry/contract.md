<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: реестр моделей – версии, стадии, продвижение (Junior)

Python 3.12, только стандартная библиотека. Модуль `registry.py` в корне репозитория. Реестр хранит версии
моделей с метриками и параметрами обучения и следит за тем, какая версия сейчас в production.

## API

```python
class TransitionError(Exception): ...

class ModelRegistry:
    def __init__(self, path: str | None = None, clock=None) -> None
    def register(self, name: str, metrics: dict, params: dict | None = None) -> dict
    def get(self, name: str, version: int) -> dict
    def list_versions(self, name: str, stage: str | None = None) -> list[dict]
    def promote(self, name: str, version: int, stage: str) -> dict
    def production(self, name: str) -> dict | None
    def best(self, name: str, metric: str, higher_is_better: bool = True, stages: tuple[str, ...] | None = None) -> dict | None
```

## Запись версии

```python
{"name": "churn", "version": 1, "stage": "staging", "metrics": {"auc": 0.91}, "params": {"depth": 4}, "created_at": "2026-10-01T10:00:00+00:00"}
```

- Все методы возвращают **копии**: изменение возвращённого словаря не меняет реестр.
- `clock` – функция без аргументов, возвращает `datetime`; `created_at` – `clock().isoformat()`. Без `clock` –
  текущее время UTC. Тесты всегда передают свои часы.

## Методы

### `register(name, metrics, params=None)`
- Создаёт версию. Номера версий – по каждому `name` отдельно: 1, 2, 3, … без пропусков.
- Новая версия всегда в стадии `staging`. `params=None` превращается в `{}`.
- `ValueError`: `name` не непустая строка; `metrics` не непустой `dict` со строковыми ключами и значениями –
  конечными числами (`int`/`float`, но не `bool`, не `nan`/`inf`); `params` не `dict` и не `None`.
- Переданные `metrics`/`params` реестр копирует: последующие изменения оригинала на реестр не влияют.

### `get(name, version)` и `list_versions(name, stage=None)`
- `get` неизвестной модели или версии – `KeyError`.
- `list_versions` – все версии модели по возрастанию номера, при `stage` – только в этой стадии.
  Неизвестное имя – пустой список. Неизвестная `stage` – `ValueError`.

### `promote(name, version, stage)`
Стадии: `staging`, `production`, `archived`. Возвращает обновлённую запись.
- Неизвестная `stage` – `ValueError`; неизвестная модель/версия – `KeyError`.
- `archived` – конечная стадия: из неё выхода нет (`TransitionError`).
- Перевод в ту же стадию, в которой версия уже находится, – `TransitionError`.
- Остальные переходы разрешены (в том числе `production` → `staging`).
- **Одна production.** При переводе версии в `production` прежняя production-версия того же `name`
  (если есть) автоматически уходит в `archived`. У разных моделей production независимы.
- Ошибочный вызов не меняет состояние реестра.

### `production(name)`
Запись версии в стадии `production` или `None` (нет такой или неизвестное имя).

### `best(name, metric, higher_is_better=True, stages=None)`
- Среди версий модели, у которых есть метрика `metric`, возвращает версию с лучшим значением
  (`higher_is_better=False` – с наименьшим). Ничья – версия с **большим** номером.
- По умолчанию `archived` исключены; если задан `stages` – берутся версии только из этих стадий.
- Нет подходящих версий (неизвестная модель, метрики нет ни у кого, пустая выборка) – `None`.

## Сохранение

Если задан `path`, реестр хранится в JSON-файле: при создании читает файл, если он есть; после каждого успешного
`register` и `promote` записывает его целиком. Новый `ModelRegistry(path)` видит всё, что записал прежний.
Файл с невалидным JSON – `ValueError` при создании. Каталог файла уже существует.
