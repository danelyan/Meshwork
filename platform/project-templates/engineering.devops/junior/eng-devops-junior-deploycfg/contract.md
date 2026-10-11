<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: валидатор конфигурации деплоя (engineering.devops, junior)

Модуль `deploycheck.py` в корне репозитория. Python 3.12, только стандартная библиотека, без сети.
Проверка – pytest (тесты в стиле `unittest` тоже идут). Конфигурация – JSON.

```python
def validate(config) -> list[dict]        # [{"path": str, "code": str, "message": str}, ...]
def validate_file(path: str) -> list[dict]
```

`python deploycheck.py config.json` печатает результат `validate_file` одной строкой JSON; код выхода 0, если
ошибок нет, и 1, если есть.

## Формат конфигурации

```json
{
  "name": "billing-api",
  "image": "registry.local/billing/api:1.4.2",
  "replicas": 3,
  "port": 8080,
  "env": {"LOG_LEVEL": "info", "DB_PASSWORD": {"secretRef": "billing-db/password"}},
  "resources": {
    "cpu":    {"request": "250m",  "limit": "500m"},
    "memory": {"request": "128Mi", "limit": "256Mi"}
  }
}
```

Обязательные поля верхнего уровня: `name`, `image`, `replicas`, `port`, `resources`. `env` необязателен.

## Правила и коды ошибок

`path` – путь к месту ошибки через точку (`resources.cpu.limit`, `env.DB_PASSWORD`; корень – `$`).
Для одного `path` и `code` ошибка выдаётся не больше одного раза. Ошибки собираются все, не только первая.
Если у поля неверный тип (`wrong_type`), остальные правила для этого поля не применяются.

| Где | Правило | `code` |
| --- | --- | --- |
| `$` | конфигурация не объект JSON | `not_object` (других ошибок нет) |
| верхний уровень | нет обязательного поля (`path` – имя поля; для вложенных – полный путь, например `resources.memory`, `resources.cpu.limit`) | `missing` |
| верхний уровень | лишний ключ (`path` – имя ключа) | `unknown_field` |
| `name` | строка (иначе `wrong_type`); формат `^[a-z][a-z0-9-]{0,39}$` | `invalid_name` |
| `image` | строка; вид `<репозиторий>:<тег>`, где тег – последний сегмент после `:` и без `/`, не пустой | `invalid_image` |
| `image` | тег `latest` | `latest_tag` |
| `replicas` | целое (`bool` – не целое), от 1 до 20 включительно | `wrong_type`, `out_of_range` |
| `port` | целое (не `bool`), от 1 до 65535 | `wrong_type`, `out_of_range` |
| `env` | объект (иначе `wrong_type`) | |
| `env.<ИМЯ>` | имя `^[A-Z][A-Z0-9_]*$` | `invalid_env_name` |
| `env.<ИМЯ>` | значение – строка или объект; иное – `wrong_type` | `wrong_type` |
| `env.<ИМЯ>` | если имя содержит `PASSWORD`, `TOKEN`, `SECRET` или `KEY` и значение – строка (даже пустая): секрет в открытом виде | `plaintext_secret` |
| `env.<ИМЯ>` | значение-объект должен быть ровно `{"secretRef": "<хранилище>/<ключ>"}`, строка по `^[a-z0-9-]+/[A-Za-z0-9_.-]+$` | `invalid_secret_ref` |
| `resources` | объект (иначе `wrong_type`), в нём объекты `cpu` и `memory`, в каждом строки `request` и `limit` | `missing`, `wrong_type` |

Объект `secretRef` разрешён для любого имени переменной.

### Ресурсы

- CPU: целое число millicores с суффиксом `m` (`250m`) или десятичное число ядер (`0.5`, `2`) – `0.5` это `500m`.
- Память: целое число с суффиксом `Mi` или `Gi` (`1Gi` = `1024Mi`).
- Значение вне этих форм, нулевое или отрицательное – `invalid_quantity` (`path` – `resources.cpu.request` и т. п.).
- `request` больше `limit` – `request_exceeds_limit` (`path` – `resources.cpu` или `resources.memory`); проверяется, только если оба значения разобраны.
- Предельные `limit`: CPU не больше 4000m, память не больше 8Gi – иначе `limit_too_high` (`path` – `resources.cpu.limit` / `resources.memory.limit`).

## Порядок результата

Список отсортирован по `(path, code)` (по возрастанию строк). Пустой список – конфигурация корректна.

## `validate_file`

Читает файл как UTF-8 (допускается BOM). Не JSON – одна ошибка `{"path": "$", "code": "invalid_json", ...}`.
Файла нет – исключение `FileNotFoundError` не перехватывается.
