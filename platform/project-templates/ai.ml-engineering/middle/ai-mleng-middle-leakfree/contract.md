<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: конвейер признаков без утечки и логистическая регрессия (ai.ml-engineering, middle)

Python 3.12, `numpy` и `pandas`, без сети. Проверка — pytest. Модуль `mlpipe.py` в корне репозитория.
Готовых ML-библиотек (scikit-learn и подобных) в окружении нет — всё на numpy/pandas.

```python
class FeaturePipeline:
    def __init__(self, numeric, categorical=()): ...
    def fit(self, df) -> "FeaturePipeline"
    def transform(self, df) -> numpy.ndarray
    def fit_transform(self, df) -> numpy.ndarray

class LogisticRegression:
    def __init__(self, lr=0.1, n_iter=500, l2=0.0): ...
    def fit(self, X, y) -> "LogisticRegression"
    def predict_proba(self, X) -> numpy.ndarray
    def predict(self, X, threshold=0.5) -> numpy.ndarray

def train_and_evaluate(df, target, numeric, categorical=(), test_size=0.25, seed=0, **model_params) -> dict
```

## FeaturePipeline

`numeric` и `categorical` — списки имён столбцов `pandas.DataFrame`. Пустые оба или пересечение — `ValueError`.

### `fit(df)`
Статистики считаются **только** по переданному `df` (это обучающая выборка) и сохраняются в атрибутах:
- `medians_` — `{столбец: float}`: медиана непропущенных значений числового столбца.
  Столбец, где все значения `NaN`, — `ValueError`.
- `mean_`, `scale_` — `{столбец: float}`: среднее и стандартное отклонение (`ddof=0`) **после** замены `NaN` медианой.
  Если после замены все значения столбца равны, `scale_` = `1.0`.
- `categories_` — `{столбец: [значения]}`: отсортированные уникальные непропущенные значения категориального столбца.
- `feature_names_` — список имён выходных признаков: сначала числовые (под своими именами, в порядке `numeric`),
  затем для каждого категориального столбца (в порядке `categorical`) по признаку `"<столбец>=<значение>"` в порядке `categories_`.
- `df` не `DataFrame`, пустой или без нужных столбцов — `ValueError`. Повторный `fit` полностью заменяет прежнее состояние.

### `transform(df)`
- `float64`-массив формы `(len(df), len(feature_names_))`. Числовой признак: `NaN` → `medians_`, затем `(x - mean_) / scale_`.
  Категориальные — one-hot (0.0/1.0); значение, которого не было при `fit`, и пропуск дают нули во всех признаках этого столбца.
- Использует **только** сохранённые при `fit` статистики; не меняет ни `df`, ни состояние конвейера.
- До `fit` — `RuntimeError`; `df` без нужных столбцов — `ValueError`. Пустой `df` (с нужными столбцами) даёт массив формы `(0, d)`.
- `fit_transform(df)` равен `fit(df).transform(df)`.

## LogisticRegression

Бинарная, обучение полным градиентным спуском. `X` — массив формы `(n, d)`, `y` — значения `0`/`1` (допустимы `bool`).
- Начальные `coef_` (форма `(d,)`) и `intercept_` — нули. Один шаг (`n_iter` раз):
  `p = sigmoid(X @ coef_ + intercept_)`, `g = X.T @ (p - y) / n + l2 * coef_`, `gb = mean(p - y)`,
  `coef_ -= lr * g`, `intercept_ -= lr * gb` (свободный член не регуляризуется).
- `predict_proba(X)` — вероятности класса 1, форма `(n,)`; сигмоида численно устойчива: при больших по модулю
  аргументах нет `nan` и предупреждений numpy (результат в `[0, 1]`). `predict(X, threshold=0.5)` — массив `int` из 0/1: `proba >= threshold`.
- `ValueError`: `X` не двумерный или пуст, длина `y` не равна `n`, `y` не из 0/1, в `y` только один класс,
  `lr <= 0`, `n_iter < 1`, `l2 < 0`, в `X` есть `nan`/`inf`; в `predict_proba` — число столбцов не равно `d`.
  `predict_proba`/`predict` до `fit` — `RuntimeError`.

## `train_and_evaluate`

Сквозной запуск без утечки: разбиение → обучение конвейера и модели на train → оценка на test.
- Строки `df` берутся **по позиции** (`iloc`), метки индекса `df.index` не важны. Значения `df[target]` — 0/1.
- Разбиение: `test_size` в `(0, 1)`; в тест идёт `n_test = int(n * test_size + 0.5)` строк, но не меньше 1 и не больше `n - 1`;
  какие именно — определяется `seed` (один и тот же `(df, test_size, seed)` всегда даёт одно и то же; другой `seed` обычно другое).
  Глобальный генератор `numpy.random` не трогать.
- Конвейер обучается (`fit`) только на строках train, к test применяется `transform`. Модель обучается на train с `model_params`
  (`lr`, `n_iter`, `l2`).
- Возвращает

```python
{"train_idx": [...], "test_idx": [...],        # позиции строк, по возрастанию, вместе покрывают все строки
 "feature_names": [...], "mean": {...}, "scale": {...},   # из конвейера
 "coef": [...], "intercept": float,             # из модели
 "y_pred": [...],                               # int, предсказания для test_idx в том же порядке
 "accuracy": float}                             # доля верных на test
```
- `ValueError`: `target` нет в `df`, значения не 0/1, `test_size` вне `(0, 1)`, в `df` меньше 4 строк, в train один класс.
- Исходный `df` не изменяется.

## Заготовка

В `starter/mlpipe.py` — сигнатуры с `NotImplementedError`. Видимые тесты — в `tests/visible/`; скрытые проверяют
остальные случаи из этого контракта.
