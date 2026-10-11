<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: раннер миграций для учёта выдачи книг (Middle)

Python 3.12, только стандартная библиотека (`sqlite3`). Модуль `migrate.py` в корне репозитория.
Задача – довести схему библиотеки от пустой базы до версии 5 пошаговыми миграциями так, чтобы сбой на любом
шаге не оставлял базу в промежуточном состоянии, а данные и связи переживали пересборку таблицы.

## Раннер

```python
class MigrationError(Exception):
    version: int | None      # номер шага, на котором упали (None, если до шагов)
    # исходное исключение шага – в __cause__

MIGRATIONS: list             # MIGRATIONS[i] – функция step(conn), поднимающая схему с версии i до i+1

def connect(path=":memory:") -> sqlite3.Connection
def current_version(conn) -> int
def migrate(conn, target=None) -> list[int]
```

- `connect` открывает соединение с `PRAGMA foreign_keys = ON`, в режиме без неявных транзакций
  (`isolation_level=None`), ожиданием блокировки не меньше 10 секунд; доступ из нескольких потоков разрешён
  (`check_same_thread=False`). Миграции не применяет.
- Версия схемы хранится в `PRAGMA user_version`; у пустой базы 0. `current_version` её читает.
- `MIGRATIONS` – список из пяти шагов (описаны ниже). Раннер читает `migrate.MIGRATIONS` **в момент вызова**
  (тесты подменяют список и дописывают шаги). Шаг – функция `step(conn)`: выполняет SQL только через
  `conn.execute` (не `executescript` и не `commit`), транзакциями не управляет.
- `migrate(conn, target=None)` применяет шаги `текущая+1 … target` по порядку и возвращает список
  применённых версий. `target=None` – `len(MIGRATIONS)`. Уже достигнутая цель – `[]`, ничего не меняется.
- Каждый шаг выполняется в **своей** транзакции, в которую входит и сам шаг, и запись новой версии
  (`user_version`): сбой шага откатывает всё, что он успел сделать (таблицы, колонки, индексы, данные) и версию.
  Успешно применённые до него шаги остаются. Повторный `migrate` после исправления продолжает с упавшего шага.
- Пока шаг выполняется: транзакция открыта (`conn.in_transaction` истинно) и внешние ключи **выключены**
  (иначе нельзя пересобрать родительскую таблицу, не потеряв связанные строки). Перед фиксацией шага
  выполняется `PRAGMA foreign_key_check`: найденные нарушения – откат шага и `MigrationError`.
  После любого исхода (успех, сбой) `PRAGMA foreign_keys` снова `1`, а транзакция закрыта.
- Любое исключение шага оборачивается в `MigrationError(version=<номер шага>)` с исходным в `__cause__`.
- Нельзя понижать версию: `target < текущей` – `MigrationError`. `target` не `int` (в том числе `bool`),
  `< 0` или `> len(MIGRATIONS)` – `ValueError`. База новее кода (`user_version > len(MIGRATIONS)`) –
  `MigrationError`, база не меняется.
- Параллельный запуск: несколько потоков со своими соединениями к одному файлу вызывают `migrate`
  одновременно – каждая версия применяется ровно один раз (объединение их результатов – `[1, …, 5]` без
  повторов), исключений нет. Версию надо перечитывать уже под блокировкой записи.

## Схема по версиям

| Версия | Что делает шаг |
|---|---|
| 1 | `members(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL)`; `books(id INTEGER PRIMARY KEY, isbn TEXT NOT NULL UNIQUE, title TEXT NOT NULL)` |
| 2 | `loans(id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL → members(id), book_id INTEGER NOT NULL → books(id), loaned_at TEXT NOT NULL, returned_at TEXT)`; ограничение: `returned_at IS NULL OR returned_at >= loaned_at` |
| 3 | в `members` колонка `status TEXT NOT NULL DEFAULT 'active'` с ограничением `status IN ('active','blocked')`; существующие участники получают `'active'` |
| 4 | `members.name` заменяется колонками `first_name TEXT NOT NULL` и `last_name TEXT NOT NULL DEFAULT ''`; колонки `name` больше нет. Разбор имени: убрать пробелы по краям, `first_name` – до первого пробельного символа, `last_name` – остальное без пробелов по краям (`'Jean Claude Van Damme'` → `Jean` / `Claude Van Damme`; `'Madonna'` → `Madonna` / `''`; пустое имя → `''` / `''`). Все `id`, `email`, `status` и прежние ограничения (`UNIQUE(email)`, `CHECK` статуса, `NOT NULL`), а также строки и внешние ключи `loans` сохраняются: `loans.member_id` по-прежнему ссылается на `members`, `PRAGMA foreign_key_check` пуст |
| 5 | индексы под два запроса ниже |

Ограничения должны быть в самой БД: прямой `INSERT`, нарушающий любое, падает с `sqlite3.IntegrityError`.

## Запросы и индексы

Модуль содержит константы и функции:

```python
ACTIVE_LOANS_SQL = "SELECT id, book_id, loaned_at FROM loans WHERE member_id = ? AND returned_at IS NULL ORDER BY loaned_at, id"
BOOK_LOANS_SQL   = "SELECT id, member_id, loaned_at, returned_at FROM loans WHERE book_id = ? ORDER BY loaned_at DESC, id DESC"

def active_loans(conn, member_id) -> list[tuple]   # строки ACTIVE_LOANS_SQL
def book_loans(conn, book_id) -> list[tuple]       # строки BOOK_LOANS_SQL
```

(Константы менять нельзя: тест подставляет их в `EXPLAIN QUERY PLAN`.) После версии 5 план каждого из двух
запросов использует индекс (`USING INDEX` / `USING COVERING INDEX`) и не содержит полного обхода `SCAN loans`
(`USE TEMP B-TREE FOR ORDER BY` допустим). До версии 5 индексов под эти запросы нет.
